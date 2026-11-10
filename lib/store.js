/**
 * SQLite-backed line registry, message queue, and lease store.
 *
 * All methods are synchronous: node:sqlite's DatabaseSync is synchronous and
 * every critical section is short. Callers in the DSH Host must not hold a
 * transaction across an await.
 */
import { chmodSync, existsSync, mkdirSync, statfsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  LEGACY_PROTOCOL_VERSION, LineError, PROTOCOL_VERSION, STATES, assertMessageSize, isProtocolCompatible,
  lineId, makeIdempotencyKey, newMessageId, parseTarget,
} from './protocol.js'

const NETWORK_FS = new Map([
  [0x6969, 'NFS'],
  [0xff534d42, 'CIFS'],
  [0x517b, 'SMB'],
  [0xfe534d42, 'SMB2'],
  [0x65735546, 'FUSE'],
])

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lines (
  line_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  role TEXT,
  title TEXT,
  created_by TEXT,
  session_id TEXT NOT NULL,
  instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  lifecycle TEXT NOT NULL DEFAULT 'active',
  generation INTEGER NOT NULL DEFAULT 1,
  rebind_at INTEGER,
  rebind_from TEXT,
  last_seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, label)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_agent TEXT NOT NULL,
  from_line TEXT NOT NULL,
  from_session TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  to_line TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  reply_to TEXT,
  root_message_id TEXT,
  hop INTEGER NOT NULL DEFAULT 0,
  no_reply INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'info',
  cc_manager INTEGER NOT NULL DEFAULT 0,
  approval_state TEXT,
  task_ref TEXT,
  parent_task_ref TEXT,
  task_scope TEXT,
  subteam_policy TEXT,
  max_members INTEGER,
  approved_by TEXT,
  approved_at INTEGER,
  protocol_version TEXT NOT NULL DEFAULT '0.3',
  state TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at INTEGER,
  delivered_at INTEGER,
  acked_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS messages_to_state ON messages(to_agent, to_line, state, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS messages_from ON messages(from_line, created_at);

CREATE TABLE IF NOT EXISTS leases (
  line_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  resolved_at INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS claim_requests_pending ON claim_requests(agent_id, state, requested_at);

CREATE TABLE IF NOT EXISTS manager_bindings (
  agent_id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS line_events (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_session_id TEXT,
  new_session_id TEXT,
  actor TEXT,
  reason TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS line_events_line ON line_events(line_id, created_at);

CREATE TABLE IF NOT EXISTS message_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  state      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  attempt    INTEGER NOT NULL DEFAULT 0,
  actor      TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_events ON message_events(message_id, seq);

PRAGMA user_version = 14;
`

export function defaultDbPath() {
  const home = process.env.DSH_HOME === undefined || process.env.DSH_HOME.trim() === ''
    ? resolve(homedir(), '.dsh')
    : resolve(process.env.DSH_HOME)
  return resolve(home, 'agent-lines', 'lines.db')
}

function expandHome(path) {
  const text = String(path ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return resolve(text)
}

/** Reject known network filesystems: SQLite locking is not reliable over them. */
export function assertLocalPath(dbPath) {
  const dir = dirname(resolve(dbPath))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    const { type } = statfsSync(dir)
    const name = NETWORK_FS.get(type)
    if (name !== undefined) {
      throw new LineError('LINE_NETWORK_FILESYSTEM', `dbPath is on ${name}; use a local filesystem`, { dbPath, fs: name })
    }
  } catch (error) {
    if (error instanceof LineError) throw error
    // statfs is unavailable on some platforms; the local-only default still applies.
  }
}

export class LineStore {
  constructor(dbPath = defaultDbPath()) {
    this.dbPath = dbPath === ':memory:' ? ':memory:' : expandHome(dbPath)
    if (this.dbPath !== ':memory:') assertLocalPath(this.dbPath)
    const fresh = !existsSync(this.dbPath)
    this.db = new DatabaseSync(this.dbPath)
    if (this.dbPath !== ':memory:') { try { chmodSync(this.dbPath, 0o600) } catch { /* best effort on platforms without POSIX modes */ } }
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(lines)').all().map(column => column.name)
    if (!columns.includes('role')) this.db.exec('ALTER TABLE lines ADD COLUMN role TEXT')
    if (!columns.includes('title')) this.db.exec('ALTER TABLE lines ADD COLUMN title TEXT')
    if (!columns.includes('created_by')) this.db.exec('ALTER TABLE lines ADD COLUMN created_by TEXT')
    if (!columns.includes('lifecycle')) this.db.exec("ALTER TABLE lines ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
    if (!columns.includes('generation')) this.db.exec('ALTER TABLE lines ADD COLUMN generation INTEGER NOT NULL DEFAULT 1')
    if (!columns.includes('rebind_at')) this.db.exec('ALTER TABLE lines ADD COLUMN rebind_at INTEGER')
    if (!columns.includes('rebind_from')) this.db.exec('ALTER TABLE lines ADD COLUMN rebind_from TEXT')
    const messageColumns = this.db.prepare('PRAGMA table_info(messages)').all().map(column => column.name)
    if (!messageColumns.includes('root_message_id')) this.db.exec('ALTER TABLE messages ADD COLUMN root_message_id TEXT')
    if (!messageColumns.includes('hop')) this.db.exec('ALTER TABLE messages ADD COLUMN hop INTEGER NOT NULL DEFAULT 0')
    if (!messageColumns.includes('no_reply')) this.db.exec('ALTER TABLE messages ADD COLUMN no_reply INTEGER NOT NULL DEFAULT 0')
    if (!messageColumns.includes('kind')) this.db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'info'")
    if (!messageColumns.includes('cc_manager')) this.db.exec('ALTER TABLE messages ADD COLUMN cc_manager INTEGER NOT NULL DEFAULT 0')
    if (!messageColumns.includes('approval_state')) this.db.exec('ALTER TABLE messages ADD COLUMN approval_state TEXT')
    if (!messageColumns.includes('task_ref')) this.db.exec('ALTER TABLE messages ADD COLUMN task_ref TEXT')
    if (!messageColumns.includes('parent_task_ref')) this.db.exec('ALTER TABLE messages ADD COLUMN parent_task_ref TEXT')
    if (!messageColumns.includes('task_scope')) this.db.exec('ALTER TABLE messages ADD COLUMN task_scope TEXT')
    if (!messageColumns.includes('subteam_policy')) this.db.exec('ALTER TABLE messages ADD COLUMN subteam_policy TEXT')
    if (!messageColumns.includes('max_members')) this.db.exec('ALTER TABLE messages ADD COLUMN max_members INTEGER')
    if (!messageColumns.includes('approved_by')) this.db.exec('ALTER TABLE messages ADD COLUMN approved_by TEXT')
    if (!messageColumns.includes('approved_at')) this.db.exec('ALTER TABLE messages ADD COLUMN approved_at INTEGER')
    this.db.exec('CREATE TABLE IF NOT EXISTS line_events (id TEXT PRIMARY KEY, line_id TEXT NOT NULL, action TEXT NOT NULL, old_session_id TEXT, new_session_id TEXT, actor TEXT, reason TEXT, detail TEXT, created_at INTEGER NOT NULL)')
    this.db.exec('CREATE INDEX IF NOT EXISTS line_events_line ON line_events(line_id, created_at)')
    // 0.8.0 S1：消息级 append-only 事件流（additive，旧库自动建表；回滚时忽略该表即可）
    this.db.exec(`CREATE TABLE IF NOT EXISTS message_events (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      state      TEXT NOT NULL,
      at         INTEGER NOT NULL,
      attempt    INTEGER NOT NULL DEFAULT 0,
      actor      TEXT,
      detail     TEXT
    )`)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_msg_events ON message_events(message_id, seq)')
    if (!messageColumns.includes('protocol_version')) {
      this.db.exec("ALTER TABLE messages ADD COLUMN protocol_version TEXT NOT NULL DEFAULT '0.3'")
    }
    this.db.exec('PRAGMA user_version = 14')
    this.prepared = new Map()
    this.closed = false
    this.fresh = fresh
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  #stmt(sql) {
    let stmt = this.prepared.get(sql)
    if (stmt === undefined) {
      stmt = this.db.prepare(sql)
      this.prepared.set(sql, stmt)
    }
    return stmt
  }

  #tx(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* transaction already gone */ }
      throw error
    }
  }

  /** Read a line row by exact address, or undefined. */
  getLineRow(agentId, line) {
    return this.#stmt('SELECT * FROM lines WHERE agent_id = ? AND label = ?').get(agentId, line)
  }

  /** Register a line and acquire its lease. Throws LINE_LEASE_HELD when another live instance owns it. */
  acquire({ agentId, line, sessionId, instanceId, ttlMs, role = null, createdBy = null, now = Date.now() }) {
    const id = lineId(agentId, line)
    return this.#tx(() => {
      const existing = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
      const lease = this.#stmt('SELECT * FROM leases WHERE line_id = ?').get(id)
      if (lease !== undefined && lease.expires_at > now && lease.instance_id !== instanceId) {
        throw new LineError('LINE_LEASE_HELD', `Line ${id} is held by another process`, {
          line: id, holder: lease.instance_id, expiresAt: lease.expires_at,
        })
      }
      if (existing === undefined) {
        this.#stmt(`INSERT INTO lines(line_id, agent_id, label, role, created_by, session_id, instance_id, status, last_seen, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)`).run(id, agentId, line, role, createdBy, sessionId, instanceId, now, now)
      } else {
        this.#stmt(`UPDATE lines SET role = ?, created_by = ?, session_id = ?, instance_id = ?, status = 'online', last_seen = ? WHERE line_id = ?`)
          .run(role, createdBy, sessionId, instanceId, now, id)
      }
      this.#stmt(`INSERT INTO leases(line_id, instance_id, expires_at, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(line_id) DO UPDATE SET instance_id = excluded.instance_id, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
        .run(id, instanceId, now + ttlMs, now)
      return { lineId: id, instanceId, expiresAt: now + ttlMs }
    })
  }

  /** Extend the lease. Throws LINE_LEASE_LOST when this instance no longer owns the line. */
  heartbeat({ agentId, line, instanceId, ttlMs, now = Date.now() }) {
    const id = lineId(agentId, line)
    return this.#tx(() => {
      const result = this.#stmt('UPDATE leases SET expires_at = ?, updated_at = ? WHERE line_id = ? AND instance_id = ?')
        .run(now + ttlMs, now, id, instanceId)
      if (result.changes !== 1) throw new LineError('LINE_LEASE_LOST', `Lease for ${id} is no longer held by this process`, { line: id })
      this.#stmt(`UPDATE lines SET status = 'online', last_seen = ? WHERE line_id = ?`).run(now, id)
      return now + ttlMs
    })
  }

  /** Release a lease if this instance owns it; safe to call during shutdown. */
  release({ agentId, line, instanceId, now = Date.now() }) {
    const id = lineId(agentId, line)
    this.#tx(() => {
      this.#stmt('DELETE FROM leases WHERE line_id = ? AND instance_id = ?').run(id, instanceId)
      this.#stmt(`UPDATE lines SET status = 'offline', last_seen = ?
        WHERE line_id = ? AND NOT EXISTS (SELECT 1 FROM leases WHERE line_id = ? AND expires_at > ?)`)
        .run(now, id, id, now)
    })
  }

  /** Resolve a target to an existing line, or throw LINE_NOT_FOUND. */
  resolveTarget(agentId, target) {
    const parsed = parseTarget(target, agentId)
    const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(parsed.lineId)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${parsed.lineId}`, { line: parsed.lineId })
    return { ...parsed, row }
  }

  /** Enqueue a message from one registered line to another. */
  send({ agentId, fromLine, to, text, idempotencyKey, replyTo, noReply = false, kind = 'info', ccManager = false, requireApproval = false, taskRef = null, parentTaskRef = null, taskScope = null, subteamPolicy = null, maxMembers = null, maxReplyDepth = 8, maxMessageBytes = 65536, ttlMs, now = Date.now() }) {
    if (!['info', 'request', 'task', 'alert'].includes(String(kind))) {
      throw new LineError('LINE_INVALID_KIND', `kind must be info/request/task/alert: ${kind}`)
    }
    const from = this.#stmt('SELECT * FROM lines WHERE agent_id = ? AND label = ?').get(agentId, fromLine)
    if (from === undefined) throw new LineError('LINE_NOT_FOUND', `Sender line is not registered: ${agentId}#${fromLine}`)
    const target = this.resolveTarget(agentId, to)
    if (target.row.lifecycle === 'retired') throw new LineError('LINE_RETIRED', `Line ${target.lineId} is retired`, { line: target.lineId })
    if (target.row.lifecycle === 'rebinding') throw new LineError('LINE_REBINDING', `Line ${target.lineId} is rebinding`, { line: target.lineId })
    const body = assertMessageSize(text, maxMessageBytes)
    let parent
    if (replyTo !== undefined && replyTo !== null && String(replyTo).trim() !== '') {
      parent = this.#stmt('SELECT * FROM messages WHERE id = ?').get(String(replyTo).trim())
      if (parent === undefined) throw new LineError('LINE_REPLY_TARGET_NOT_FOUND', `No message to reply to: ${replyTo}`)
      if (Number(parent.no_reply) === 1) throw new LineError('LINE_NO_REPLY', `Message ${parent.id} is marked noReply`)
    }
    const rootMessageId = parent === undefined ? null : (parent.root_message_id ?? parent.id)
    const hop = parent === undefined ? 0 : Number(parent.hop) + 1
    if (hop > maxReplyDepth) {
      throw new LineError('LINE_REPLY_DEPTH_EXCEEDED', `Reply depth ${hop} exceeds maxReplyDepth ${maxReplyDepth}`, { hop, maxReplyDepth, rootMessageId })
    }
    const key = makeIdempotencyKey({ fromLine, to: target.lineId, text: body, replyTo, key: idempotencyKey })
    const existing = this.#stmt('SELECT * FROM messages WHERE idempotency_key = ?').get(key)
    if (existing !== undefined) return { ...existing, deduplicated: true }
    const id = newMessageId()
    const expiresAt = ttlMs === undefined || ttlMs === null || ttlMs <= 0 ? null : now + ttlMs
    this.#stmt(`INSERT INTO messages(
      id, idempotency_key, from_agent, from_line, from_session, to_agent, to_line, body,
      created_at, expires_at, reply_to, root_message_id, hop, no_reply, kind, cc_manager, approval_state, task_ref, parent_task_ref, task_scope, subteam_policy, max_members, protocol_version, state, attempts, next_attempt_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(id, key, from.agent_id, from.label, from.session_id, target.agentId, target.line, body, now, expiresAt, replyTo ?? null, rootMessageId, hop, noReply === true ? 1 : 0, String(kind), ccManager === true ? 1 : 0, requireApproval ? 'pending' : null, taskRef === null ? null : String(taskRef), parentTaskRef === null ? null : String(parentTaskRef), taskScope === null ? null : String(taskScope), subteamPolicy === null ? null : String(subteamPolicy), maxMembers === null ? null : Number(maxMembers), PROTOCOL_VERSION, requireApproval ? 'pending_approval' : 'queued', now)
    this.#msgEvent(id, requireApproval ? 'pending_approval' : 'queued', { detail: 'send', now })
    return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(id), deduplicated: false }
  }

  /** Append one message-lifecycle event (0.8.0 S1, additive; never throws into callers). */
  #msgEvent(messageId, state, { attempt = 0, actor = null, detail = null, now = Date.now() } = {}) {
    try {
      this.#stmt('INSERT INTO message_events(message_id, state, at, attempt, actor, detail) VALUES(?, ?, ?, ?, ?, ?)')
        .run(String(messageId), String(state), now, Number(attempt) || 0, actor === null ? null : String(actor), detail === null ? null : String(detail).slice(0, 2000))
    } catch { /* event stream must never break delivery */ }
  }

  /** Message-level timeline (0.8.0 S1). */
  eventsForMessage(messageId) {
    return this.#stmt('SELECT * FROM message_events WHERE message_id = ? ORDER BY seq ASC').all(String(messageId))
  }

  /** Query messages by state(s), optionally since a timestamp (0.8.0 S1). */
  messagesByStates({ agentId, line, states = [], since = null, limit = 50 }) {
    const wanted = (Array.isArray(states) ? states : []).map(String).filter(Boolean)
    const filter = wanted.length > 0 ? ` AND state IN (${wanted.map(() => '?').join(', ')})` : ''
    const sinceFilter = since === null ? '' : ' AND created_at >= ?'
    const params = [agentId, line, ...wanted]
    if (since !== null) params.push(Number(since))
    params.push(Math.min(Math.max(Number(limit) || 50, 1), 500))
    return this.#stmt(`SELECT * FROM messages WHERE to_agent = ? AND to_line = ?${filter}${sinceFilter} ORDER BY created_at ASC LIMIT ?`).all(...params)
  }

  /** Counts by state for one line (0.8.0 S1). */
  countsByState({ agentId, line }) {
    const rows = this.#stmt('SELECT state, COUNT(*) AS n FROM messages WHERE to_agent = ? AND to_line = ? GROUP BY state').all(agentId, line)
    const counts = {}
    for (const row of rows) counts[row.state] = Number(row.n)
    return counts
  }

  /** Requeue messages whose claim outlived its claim timeout. */
  #requeueStale(toAgent, toLine, now, claimTimeoutMs) {
    const stale = this.#stmt(`SELECT id, attempts FROM messages
      WHERE to_agent = ? AND to_line = ? AND state = 'claimed' AND claimed_at < ?`).all(toAgent, toLine, now - claimTimeoutMs)
    for (const row of stale) {
      this.#stmt(`UPDATE messages SET state = 'queued', claimed_by = NULL, claimed_at = NULL, next_attempt_at = ?
        WHERE id = ? AND state = 'claimed'`).run(now, row.id)
      this.#msgEvent(row.id, 'queued', { attempt: Number(row.attempts) || 0, actor: 'system', detail: 'claim timeout', now })
    }
    const expired = this.#stmt(`SELECT id, attempts FROM messages
      WHERE to_agent = ? AND to_line = ? AND state IN ('queued', 'claimed') AND expires_at IS NOT NULL AND expires_at <= ?`).all(toAgent, toLine, now)
    for (const row of expired) {
      this.#stmt(`UPDATE messages SET state = 'expired' WHERE id = ? AND state IN ('queued', 'claimed')`).run(row.id)
      this.#msgEvent(row.id, 'expired', { attempt: Number(row.attempts) || 0, actor: 'system', detail: 'ttl', now })
    }
  }

  /** Atomically claim up to `limit` queued messages for a line owned by `instanceId`. */
  claim({ agentId, line, instanceId, limit = 20, claimTimeoutMs = 60000, now = Date.now() }) {
    const from = lineId(agentId, line)
    return this.#tx(() => {
      const lease = this.#stmt('SELECT * FROM leases WHERE line_id = ?').get(from)
      if (lease === undefined || lease.instance_id !== instanceId || lease.expires_at <= now) {
        throw new LineError('LINE_LEASE_LOST', `Lease for ${from} is not held by this process`, { line: from })
      }
      this.#requeueStale(agentId, line, now, claimTimeoutMs)
      const rows = this.#stmt(`SELECT * FROM messages
        WHERE to_agent = ? AND to_line = ? AND state = 'queued' AND next_attempt_at <= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at ASC LIMIT ?`).all(agentId, line, now, now, limit)
      const claimed = []
      for (const row of rows) {
        const peerVersion = row.protocol_version === undefined || row.protocol_version === null ? LEGACY_PROTOCOL_VERSION : row.protocol_version
        let compatible = false
        try { compatible = isProtocolCompatible(peerVersion) } catch { compatible = false }
        if (!compatible) {
          // 0.9.0 S2: major mismatch => do not deliver; mark failed with audit event
          this.#stmt(`UPDATE messages SET state = 'failed', claimed_by = NULL, claimed_at = NULL, last_error = ?
            WHERE id = ? AND state = 'queued'`).run('LINE_PROTOCOL_MISMATCH: peer ' + peerVersion, row.id)
          this.#msgEvent(row.id, 'failed', { attempt: Number(row.attempts) || 0, actor: instanceId, detail: 'LINE_PROTOCOL_MISMATCH peer=' + peerVersion, now })
          continue
        }
        this.#stmt(`UPDATE messages SET state = 'claimed', claimed_by = ?, claimed_at = ?, attempts = attempts + 1
          WHERE id = ? AND state = 'queued'`).run(instanceId, now, row.id)
        this.#msgEvent(row.id, 'claimed', { attempt: Number(row.attempts) + 1, actor: instanceId, now })
        claimed.push({ ...row, state: 'claimed', claimed_by: instanceId, claimed_at: now, attempts: row.attempts + 1 })
      }
      return claimed
    })
  }

  markDelivered(id, instanceId, now = Date.now()) {
    const result = this.#stmt(`UPDATE messages SET state = 'delivered', delivered_at = ?, last_error = NULL
      WHERE id = ? AND state = 'claimed' AND claimed_by = ?`).run(now, id, instanceId)
    if (result.changes !== 1) throw new LineError('LINE_DELIVERY_STATE', `Message ${id} is not claimed by this instance`)
    this.#msgEvent(id, 'delivered', { actor: instanceId, now })
  }

  markError(id, instanceId, error, { nextAttemptAt, maxAttempts = 8, now = Date.now() } = {}) {
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM messages WHERE id = ? AND claimed_by = ?').get(id, instanceId)
      if (row === undefined) return undefined
      const terminal = row.attempts >= maxAttempts
      this.#stmt(`UPDATE messages SET state = ?, claimed_by = NULL, claimed_at = NULL, next_attempt_at = ?, last_error = ?
        WHERE id = ?`).run(terminal ? 'failed' : 'queued', terminal ? now : (nextAttemptAt ?? now), String(error).slice(0, 2000), id)
      this.#msgEvent(id, terminal ? 'failed' : 'queued', { attempt: Number(row.attempts) || 0, actor: instanceId, detail: String(error), now })
      return { terminal, attempts: row.attempts }
    })
  }

  markAck({ agentId, line, messageId, now = Date.now() }) {
    const to = lineId(agentId, line)
    const row = this.#stmt('SELECT * FROM messages WHERE id = ? AND to_agent = ? AND to_line = ?').get(messageId, agentId, line)
    if (row === undefined) throw new LineError('LINE_MESSAGE_NOT_FOUND', `No message ${messageId} for ${to}`)
    if (row.state === 'acked') return { ...row, alreadyAcked: true }
    if (row.state !== 'delivered') throw new LineError('LINE_NOT_DELIVERED', `Message ${messageId} is ${row.state}; only delivered messages can be acked`)
    this.#stmt(`UPDATE messages SET state = 'acked', acked_at = ? WHERE id = ?`).run(now, messageId)
    this.#msgEvent(messageId, 'acked', { actor: lineId(agentId, line), now })
    return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(messageId), alreadyAcked: false }
  }

  /** Requeue a failed/expired message for another delivery attempt (0.8.0 S1). Manager-only enforced at tool layer. */
  redeliver({ agentId, messageId, to = null, resetAttempts = true, actor = null, now = Date.now() }) {
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM messages WHERE id = ? AND to_agent = ?').get(String(messageId), agentId)
      if (row === undefined) throw new LineError('LINE_MESSAGE_NOT_FOUND', `No message ${messageId} for agent ${agentId}`)
      if (row.state !== 'failed' && row.state !== 'expired') {
        throw new LineError('LINE_DELIVERY_STATE', `Message ${messageId} is ${row.state}; only failed/expired can be redelivered`, { state: row.state })
      }
      let targetLine = row.to_line
      if (to !== null && String(to).trim() !== '') {
        const target = parseTarget(String(to), agentId)
        if (target.agentId !== agentId) {
          throw new LineError('LINE_INVALID_TARGET', 'Cross-agent redelivery is not supported', { target: String(to) })
        }
        const exists = this.#stmt('SELECT 1 AS ok FROM lines WHERE line_id = ?').get(target.lineId)
        if (exists === undefined) throw new LineError('LINE_INVALID_LINE', `Unknown line: ${target.line}`, { line: target.line })
        targetLine = target.line
      }
      const attempts = resetAttempts === false ? Number(row.attempts) || 0 : 0
      this.#stmt(`UPDATE messages SET state = 'queued', claimed_by = NULL, claimed_at = NULL, delivered_at = NULL, acked_at = NULL,
        next_attempt_at = ?, attempts = ?, last_error = NULL, to_line = ? WHERE id = ?`).run(now, attempts, targetLine, row.id)
      this.#msgEvent(row.id, 'redelivered', { attempt: attempts, actor, detail: JSON.stringify({ to: targetLine, resetAttempts }), now })
      return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(row.id), redelivered: true }
    })
  }

  /** Delete terminal messages older than `before` (0.8.0 S1). dryRun defaults to true. */
  purge({ agentId, before, states = ['failed', 'expired', 'acked'], dryRun = true, actor = null, now = Date.now() }) {
    const wanted = (Array.isArray(states) ? states : []).map(String).filter(Boolean)
    if (wanted.length === 0) throw new LineError('LINE_INVALID_ARGUMENT', 'states must not be empty')
    const cutoff = Number(before)
    if (!Number.isFinite(cutoff)) throw new LineError('LINE_INVALID_ARGUMENT', 'before is required (epoch ms)')
    return this.#tx(() => {
      const filter = wanted.map(() => '?').join(', ')
      const rows = this.#stmt(`SELECT id FROM messages WHERE to_agent = ? AND state IN (${filter}) AND created_at < ?`).all(agentId, ...wanted, cutoff)
      if (dryRun !== false) return { wouldDelete: rows.length, deleted: 0, dryRun: true }
      for (const row of rows) {
        this.#msgEvent(row.id, 'purged', { actor, detail: 'purge', now })
        this.#stmt('DELETE FROM messages WHERE id = ?').run(row.id)
      }
      return { wouldDelete: rows.length, deleted: rows.length, dryRun: false }
    })
  }

  /** Delivered-but-not-acked messages older than timeoutMs (0.8.0 S1: report only, never auto-retry). */
  ackOverdue({ agentId, line, timeoutMs = 600000, now = Date.now() }) {
    return this.#stmt(`SELECT id, delivered_at, attempts FROM messages
      WHERE to_agent = ? AND to_line = ? AND state = 'delivered' AND delivered_at IS NOT NULL AND delivered_at < ?`)
      .all(agentId, line, now - Number(timeoutMs))
  }

  /** Fetch one message by id (0.8.0 S1, for line_trace). */
  messageById(id) {
    return this.#stmt('SELECT * FROM messages WHERE id = ?').get(String(id))
  }

  /** List every message addressed to a line, regardless of state (for CLI tail/doctor). */
  messagesForLine({ agentId, line, limit = 100 }) {
    return this.#stmt(`SELECT * FROM messages WHERE to_agent = ? AND to_line = ? ORDER BY created_at ASC LIMIT ?`).all(agentId, line, limit)
  }

  /** List delivered/acked messages addressed to a line. */
  inbox({ agentId, line, limit = 20, includeAcked = false }) {
    const states = includeAcked ? `state IN ('delivered', 'acked')` : `state = 'delivered'`
    return this.#stmt(`SELECT * FROM messages WHERE to_agent = ? AND to_line = ? AND ${states} ORDER BY created_at ASC LIMIT ?`).all(agentId, line, limit)
  }

  /** Persist the manager Session chosen by a successful claim. */
  setManagerBinding({ agentId, lineId: targetLine, sessionId, now = Date.now() }) {
    this.#stmt(`INSERT INTO manager_bindings(agent_id, line_id, session_id, updated_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET line_id = excluded.line_id, session_id = excluded.session_id, updated_at = excluded.updated_at`)
      .run(agentId, targetLine, sessionId, now)
  }

  /** Read the persisted manager Session, if any. */
  getManagerBinding(agentId) {
    return this.#stmt('SELECT * FROM manager_bindings WHERE agent_id = ?').get(agentId)
  }

  /** Enqueue a manager claim request. A pending request for the same session/line is reused. */
  requestClaim({ agentId, lineId: targetLine, sessionId, now = Date.now() }) {
    const existing = this.#stmt(`SELECT * FROM claim_requests
      WHERE agent_id = ? AND line_id = ? AND session_id = ? AND state = 'pending'
      ORDER BY requested_at DESC LIMIT 1`).get(agentId, targetLine, sessionId)
    if (existing !== undefined) return { ...existing, reused: true }
    const id = 'claim_' + randomUUID().replaceAll('-', '')
    this.#stmt(`INSERT INTO claim_requests(id, agent_id, line_id, session_id, state, requested_at)
      VALUES(?, ?, ?, ?, 'pending', ?)`).run(id, agentId, targetLine, sessionId, now)
    return { ...this.#stmt('SELECT * FROM claim_requests WHERE id = ?').get(id), reused: false }
  }

  /** Pending manager claims for one agent. */
  pendingClaims(agentId, limit = 20) {
    return this.#stmt(`SELECT * FROM claim_requests WHERE agent_id = ? AND state = 'pending'
      ORDER BY requested_at ASC LIMIT ?`).all(agentId, limit)
  }

  /** Resolve a claim request. */
  resolveClaim(id, state, error = null, now = Date.now()) {
    this.#stmt('UPDATE claim_requests SET state = ?, resolved_at = ?, error = ? WHERE id = ?')
      .run(state, now, error, id)
  }

  /** Number of registered lines for an agent (used by maxLines). */
  countLines(agentId) {
    const row = this.#stmt('SELECT COUNT(*) AS n FROM lines WHERE agent_id = ?').get(agentId)
    return Number(row.n)
  }

  /** All lines with unread counts and live lease state. */
  listLines(now = Date.now()) {
    const rows = this.#stmt(`SELECT l.*, (SELECT COUNT(*) FROM messages m
        WHERE m.to_agent = l.agent_id AND m.to_line = l.label AND m.state IN ('queued', 'claimed', 'delivered')) AS unread,
        (SELECT COUNT(*) FROM messages m
          WHERE m.to_agent = l.agent_id AND m.to_line = l.label AND m.state IN ('queued', 'claimed')) AS pending,
        (SELECT MAX(m.created_at) FROM messages m
          WHERE m.to_agent = l.agent_id AND m.to_line = l.label) AS last_activity_at
      FROM lines l ORDER BY l.agent_id, l.label`).all()
    return rows.map(row => {
      const lease = this.#stmt('SELECT * FROM leases WHERE line_id = ?').get(row.line_id)
      return {
        ...row,
        unread: Number(row.unread),
        pending: Number(row.pending ?? 0),
        lastActivityAt: row.last_activity_at === null ? null : Number(row.last_activity_at),
        lease: lease === undefined ? null : {
          instanceId: lease.instance_id,
          expiresAt: lease.expires_at,
          live: lease.expires_at > now,
        },
      }
    })
  }

  /** One line with unread count. */
  getLine(agentId, line, now = Date.now()) {
    const id = lineId(agentId, line)
    const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
    if (row === undefined) return undefined
    const lease = this.#stmt('SELECT * FROM leases WHERE line_id = ?').get(id)
    const unread = this.#stmt(`SELECT COUNT(*) AS n FROM messages WHERE to_agent = ? AND to_line = ? AND state IN ('queued', 'claimed', 'delivered')`).get(agentId, line)
    const pending = this.#stmt(`SELECT COUNT(*) AS n FROM messages WHERE to_agent = ? AND to_line = ? AND state IN ('queued', 'claimed')`).get(agentId, line)
    const activity = this.#stmt('SELECT MAX(created_at) AS n FROM messages WHERE to_agent = ? AND to_line = ?').get(agentId, line)
    return {
      ...row,
      unread: Number(unread.n),
      pending: Number(pending.n),
      lastActivityAt: activity.n === null ? null : Number(activity.n),
      lease: lease === undefined ? null : { instanceId: lease.instance_id, expiresAt: lease.expires_at, live: lease.expires_at > now },
    }
  }

  /** Update the display title of a line. Persisted so restarts keep it. */
  setTitle({ agentId, line, title, actor = null, now = Date.now() }) {
    const id = lineId(agentId, line)
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
      if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${id}`, { line: id })
      const value = title === null || title === undefined ? null : String(title).trim().slice(0, 120) || null
      this.#stmt('UPDATE lines SET title = ? WHERE line_id = ?').run(value, id)
      this.#event({ lineId: id, action: 'title', actor, detail: { title: value }, now })
      return { ...this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id) }
    })
  }

  /** Set lifecycle without a Session rebind (used to lock a rebind in progress). */
  setLifecycle({ agentId, line, lifecycle, actor = null, reason = null, now = Date.now() }) {
    const id = lineId(agentId, line)
    if (!['active', 'retired', 'rebinding'].includes(String(lifecycle))) {
      throw new LineError('LINE_INVALID_LIFECYCLE', `Invalid lifecycle: ${lifecycle}`)
    }
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
      if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${id}`, { line: id })
      this.#stmt("UPDATE lines SET lifecycle = ?, status = CASE WHEN ? = 'active' THEN status ELSE 'offline' END WHERE line_id = ?")
        .run(String(lifecycle), String(lifecycle), id)
      this.#event({ lineId: id, action: lifecycle, actor, reason, now })
      return { ...this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id) }
    })
  }

  /** Queue/claimed/delivered counts for one line. */
  messageCounts({ agentId, line }) {
    const rows = this.#stmt(`SELECT state, COUNT(*) AS n FROM messages
      WHERE to_agent = ? AND to_line = ? GROUP BY state`).all(agentId, line)
    const out = { queued: 0, claimed: 0, delivered: 0, acked: 0, failed: 0, expired: 0, dead: 0 }
    for (const row of rows) out[row.state] = Number(row.n)
    return out
  }

  /** Retire a line: no new sends, keep Session/queue/history. */
  retire({ agentId, line, actor = null, reason = null, now = Date.now() }) {
    const id = lineId(agentId, line)
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
      if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${id}`, { line: id })
      if (row.lifecycle !== 'retired') {
        this.#stmt("UPDATE lines SET lifecycle = 'retired', status = 'offline' WHERE line_id = ?").run(id)
        this.#event({ lineId: id, action: 'retire', actor, reason, detail: this.messageCounts({ agentId, line }), now })
      }
      return { ...this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id), counts: this.messageCounts({ agentId, line }) }
    })
  }

  /**
   * Atomically switch a line to a new Session.
   * migrate=queued: requeue claimed messages; queued/claimed will be delivered by the new loop.
   * migrate=none: fail-closed if queued+claimed > 0 (manager must drain first).
   * delivered/acked/failed/expired are never re-delivered.
   */
  rebind({ agentId, line, sessionId, actor = null, reason = null, migrate = 'queued', locked = false, now = Date.now() }) {
    const id = lineId(agentId, line)
    if (!['queued', 'none'].includes(String(migrate))) {
      throw new LineError('LINE_INVALID_ARGUMENT', `migrate must be queued or none: ${migrate}`)
    }
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id)
      if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${id}`, { line: id })
      if (row.lifecycle === 'rebinding' && locked !== true) throw new LineError('LINE_REBIND_BUSY', `Line ${id} is already rebinding`, { line: id })
      const counts = this.messageCounts({ agentId, line })
      if (String(migrate) === 'none' && counts.queued + counts.claimed > 0) {
        throw new LineError('LINE_BACKLOG_NOT_EMPTY', `Line ${id} has ${counts.queued + counts.claimed} queued/claimed messages; drain or use migrate=queued`, { line: id, counts })
      }
      if (String(migrate) === 'queued') {
        this.#stmt(`UPDATE messages SET state = 'queued', claimed_by = NULL, claimed_at = NULL, next_attempt_at = ?
          WHERE to_agent = ? AND to_line = ? AND state = 'claimed'`).run(now, agentId, line)
      }
      this.#stmt('DELETE FROM leases WHERE line_id = ?').run(id)
      const generation = Number(row.generation ?? 1) + 1
      this.#stmt(`UPDATE lines SET session_id = ?, lifecycle = 'active', generation = ?, rebind_at = ?, rebind_from = ?,
        instance_id = NULL, status = 'offline', last_seen = ? WHERE line_id = ?`)
        .run(String(sessionId), generation, now, row.session_id, now, id)
      const detail = { migrate: String(migrate), before: counts, after: this.messageCounts({ agentId, line }), generation }
      this.#event({ lineId: id, action: 'rebind', oldSessionId: row.session_id, newSessionId: String(sessionId), actor, reason, detail, now })
      return { ...this.#stmt('SELECT * FROM lines WHERE line_id = ?').get(id), oldSessionId: row.session_id, counts: detail.after }
    })
  }

  /** Last rebind event for a line (used to show oldSessionId without overwriting the row). */
  lastLineEvent({ agentId, line, action = 'rebind' }) {
    const id = lineId(agentId, line)
    return this.#stmt('SELECT * FROM line_events WHERE line_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1').get(id, action)
  }

  /** Manager decision on a pending task message: approve queues it, reject closes it. */
  approveMessage({ messageId, decision = 'approve', actor = null, now = Date.now() }) {
    if (!['approve', 'reject'].includes(String(decision))) throw new LineError('LINE_INVALID_ARGUMENT', 'decision must be approve or reject')
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM messages WHERE id = ?').get(String(messageId))
      if (row === undefined) throw new LineError('LINE_MESSAGE_NOT_FOUND', `No message: ${messageId}`)
      if (row.state !== 'pending_approval') throw new LineError('LINE_NOT_PENDING_APPROVAL', `Message ${messageId} is ${row.state}`)
      const approved = String(decision) === 'approve'
      this.#stmt(`UPDATE messages SET state = ?, approval_state = ?, approved_by = ?, approved_at = ?
        WHERE id = ? AND state = 'pending_approval'`).run(
        approved ? 'queued' : 'rejected', approved ? 'approved' : 'rejected', actor, now, row.id,
      )
      return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(row.id), approved }
    })
  }

  /** Recent cross-line messages for the board; read-only. */
  recentMessages({ agentId, limit = 20 } = {}) {
    const n = Math.max(1, Math.min(100, Number(limit) || 20))
    return this.#stmt(`SELECT id, from_agent, from_line, to_agent, to_line, body, kind, state, task_ref, created_at, delivered_at, acked_at
      FROM messages WHERE from_agent = ? OR to_agent = ? ORDER BY created_at DESC LIMIT ?`).all(agentId, agentId, n)
  }

  /** Read-only communication search across lines; manager feed. */
  searchMessages({ agentId, line = null, taskRef = null, kind = null, state = null, limit = 50 } = {}) {
    const n = Math.max(1, Math.min(200, Number(limit) || 50))
    const clauses = ['(from_agent = ? OR to_agent = ?)']
    const args = [agentId, agentId]
    if (line !== null) { clauses.push('(from_line = ? OR to_line = ?)'); args.push(String(line), String(line)) }
    if (taskRef !== null) { clauses.push('task_ref = ?'); args.push(String(taskRef)) }
    if (kind !== null) { clauses.push('kind = ?'); args.push(String(kind)) }
    if (state !== null) { clauses.push('state = ?'); args.push(String(state)) }
    args.push(n)
    return this.#stmt(`SELECT id, from_line, to_line, body, kind, state, task_ref, task_scope, parent_task_ref, created_at, delivered_at, acked_at
      FROM messages WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...args)
  }
  /** Latest subteam policy declared to one line; read-only. */
  latestPolicyForLine({ agentId, line } = {}) {
    const row = this.#stmt('SELECT subteam_policy, max_members FROM messages WHERE to_agent = ? AND to_line = ? AND (subteam_policy IS NOT NULL OR max_members IS NOT NULL) ORDER BY created_at DESC LIMIT 1').get(agentId, String(line))
    return row === undefined ? null : { policy: row.subteam_policy ?? null, maxMembers: row.max_members ?? null }
  }

  /** Latest subteam policy declared for one task; read-only. */
  policyForTask({ agentId, taskRef, line = null, scope = null } = {}) {
    if (line === null) {
      return this.#stmt('SELECT subteam_policy, max_members FROM messages WHERE to_agent = ? AND task_ref = ? AND (subteam_policy IS NOT NULL OR max_members IS NOT NULL) ORDER BY created_at DESC LIMIT 1').get(agentId, String(taskRef)) ?? null
    }
    return scope === null
      ? this.#stmt('SELECT subteam_policy, max_members FROM messages WHERE to_agent = ? AND to_line = ? AND task_ref = ? AND (subteam_policy IS NOT NULL OR max_members IS NOT NULL) ORDER BY created_at DESC LIMIT 1').get(agentId, String(line), String(taskRef)) ?? null
      : this.#stmt('SELECT subteam_policy, max_members FROM messages WHERE to_agent = ? AND to_line = ? AND task_scope = ? AND task_ref = ? AND (subteam_policy IS NOT NULL OR max_members IS NOT NULL) ORDER BY created_at DESC LIMIT 1').get(agentId, String(line), String(scope), String(taskRef)) ?? null
  }

  /** Latest parent reference declared for one task; read-only. */
  parentTaskFor({ agentId, taskRef, line = null, scope = null } = {}) {
    if (line === null) {
      const row = this.#stmt('SELECT parent_task_ref FROM messages WHERE to_agent = ? AND task_ref = ? AND parent_task_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(agentId, String(taskRef))
      return row?.parent_task_ref ?? null
    }
    const row = scope === null
      ? this.#stmt('SELECT parent_task_ref FROM messages WHERE to_agent = ? AND to_line = ? AND task_ref = ? AND parent_task_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(agentId, String(line), String(taskRef))
      : this.#stmt('SELECT parent_task_ref FROM messages WHERE to_agent = ? AND to_line = ? AND task_scope = ? AND task_ref = ? AND parent_task_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(agentId, String(line), String(scope), String(taskRef))
    return row?.parent_task_ref ?? null
  }

  /** Recent messages linked to one Agent Teams task; read-only. */
  messagesForTask({ agentId, taskRef, line = null, scope = null, limit = 5 } = {}) {
    const n = Math.max(1, Math.min(100, Number(limit) || 5))
    if (line === null) return this.#stmt('SELECT * FROM messages WHERE to_agent = ? AND task_ref = ? ORDER BY created_at DESC LIMIT ?').all(agentId, String(taskRef), n)
    return scope === null
      ? this.#stmt('SELECT * FROM messages WHERE to_agent = ? AND to_line = ? AND task_ref = ? ORDER BY created_at DESC LIMIT ?').all(agentId, String(line), String(taskRef), n)
      : this.#stmt('SELECT * FROM messages WHERE to_agent = ? AND to_line = ? AND task_scope = ? AND task_ref = ? ORDER BY created_at DESC LIMIT ?').all(agentId, String(line), String(scope), String(taskRef), n)
  }

  /** Pending task approvals addressed by a line; manager-only read. */
  pendingApprovals({ agentId, line = null, limit = 50 } = {}) {
    const n = Math.max(1, Math.min(100, Number(limit) || 50))
    return line === null
      ? this.#stmt("SELECT * FROM messages WHERE to_agent = ? AND state = 'pending_approval' ORDER BY created_at LIMIT ?").all(agentId, n)
      : this.#stmt("SELECT * FROM messages WHERE to_agent = ? AND to_line = ? AND state = 'pending_approval' ORDER BY created_at LIMIT ?").all(agentId, line, n)
  }

  /** Read-only cross-line feed for the manager; no state changes. */
  observe({ agentId, line = null, since = 0, limit = 100 } = {}) {
    const n = Math.min(200, Math.max(1, Number(limit) || 100))
    const from = Math.max(0, Number(since) || 0)
    const params = [agentId, agentId]
    let sql = `SELECT id, from_agent, from_line, to_agent, to_line, body, state, kind, cc_manager, approval_state, task_ref, parent_task_ref, task_scope, subteam_policy, max_members, reply_to, root_message_id,
      hop, no_reply, created_at, delivered_at, acked_at
      FROM messages WHERE (from_agent = ? OR to_agent = ?) AND from_line != to_line AND created_at > ?`
    params.push(from)
    if (line !== null && String(line).trim() !== '') {
      sql += ' AND (from_line = ? OR to_line = ?)'
      params.push(String(line), String(line))
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(n)
    const rows = this.#stmt(sql).all(...params)
    return {
      agentId, line: line === null ? null : String(line), since: from, count: rows.length,
      messages: rows.map(row => ({
        id: row.id,
        from: row.from_agent + '#' + row.from_line,
        to: row.to_agent + '#' + row.to_line,
        state: row.state,
        kind: row.kind,
        ccManager: Number(row.cc_manager) === 1,
        approvalState: row.approval_state,
        taskRef: row.task_ref ?? null,
        parentTaskRef: row.parent_task_ref ?? null,
        taskScope: row.task_scope ?? null,
        subteamPolicy: row.subteam_policy ?? null,
        maxMembers: row.max_members ?? null,
        noReply: Number(row.no_reply) === 1,
        replyTo: row.reply_to,
        hop: row.hop,
        createdAt: row.created_at,
        summary: String(row.body || '').replace(/\s+/g, ' ').slice(0, 240),
      })),
    }
  }

  /** Structured handoff snapshot: counts + recent messages + lifecycle events. */
  handoff({ agentId, line, limit = 20, now = Date.now() }) {
    const row = this.getLine(agentId, line, now)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${lineId(agentId, line)}`)
    const recent = this.#stmt(`SELECT * FROM messages WHERE to_agent = ? AND to_line = ? ORDER BY created_at DESC LIMIT ?`).all(agentId, line, limit).reverse()
    const events = this.lineEvents({ agentId, line, limit: 10, excludeActions: ['token_sample'] })
    const lastEvent = events.length ? events[0] : null
    const lastRebind = this.lastLineEvent({ agentId, line, action: 'rebind' })
    return {
      line: line, label: line, role: row.role, title: row.title ?? row.role ?? row.label,
      sessionId: row.session_id, lifecycle: row.lifecycle ?? 'active', generation: row.generation ?? 1,
      createdBy: row.created_by, createdAt: row.created_at, counts: this.messageCounts({ agentId, line }),
      lastActivityAt: row.lastActivityAt, oldSessionId: lastRebind?.old_session_id ?? null,
      lastEvent, events, messages: recent,
    }
  }

  /** Recent lifecycle events for diagnostics. */
  lineEvents({ agentId, line, limit = 20, excludeActions = [] }) {
    const id = lineId(agentId, line)
    if (excludeActions.length === 0) {
      return this.#stmt('SELECT * FROM line_events WHERE line_id = ? ORDER BY created_at DESC LIMIT ?').all(id, limit)
    }
    const placeholders = excludeActions.map(() => '?').join(',')
    return this.#stmt('SELECT * FROM line_events WHERE line_id = ? AND action NOT IN (' + placeholders + ') ORDER BY created_at DESC LIMIT ?')
      .all(id, ...excludeActions, limit)
  }

  #event({ lineId: target, action, oldSessionId = null, newSessionId = null, actor = null, reason = null, detail = null, now = Date.now() }) {
    const id = 'lineev_' + randomUUID().replaceAll('-', '')
    this.#stmt(`INSERT INTO line_events(id, line_id, action, old_session_id, new_session_id, actor, reason, detail, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, target, action, oldSessionId, newSessionId, actor, reason, detail === null ? null : JSON.stringify(detail), now)
    return id
  }

  /** Read-only message statistics for the data board. */
  messageStats({ agentId } = {}) {
    const total = this.#stmt('SELECT COUNT(*) AS n FROM messages WHERE from_agent = ? OR to_agent = ?').get(agentId, agentId)
    const byKind = this.#stmt('SELECT kind, COUNT(*) AS n FROM messages WHERE from_agent = ? OR to_agent = ? GROUP BY kind ORDER BY n DESC').all(agentId, agentId)
    const byState = this.#stmt('SELECT state, COUNT(*) AS n FROM messages WHERE from_agent = ? OR to_agent = ? GROUP BY state ORDER BY n DESC').all(agentId, agentId)
    return { total: Number(total.n), byKind, byState }
  }

  /** Read-only daily message trend (UTC day, last N days). */
  messageTrend({ agentId, days = 7, now = Date.now() } = {}) {
    const n = Math.max(1, Math.min(90, Number(days) || 7))
    const since = now - n * 86400000
    return this.#stmt(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
      FROM messages WHERE (from_agent = ? OR to_agent = ?) AND created_at >= ?
      GROUP BY day ORDER BY day`).all(agentId, agentId, since)
  }

  /** 0.10.0 S3a: record one cumulative token sample (line_events action=token_sample; no schema change). */
  recordTokenSample({ agentId, line, decodeTokens, turns = null, steps = null, sessionId = null, now = Date.now() }) {
    const id = randomUUID()
    this.#stmt('INSERT INTO line_events(id, line_id, action, old_session_id, new_session_id, actor, reason, detail, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, lineId(agentId, line), 'token_sample', sessionId, sessionId, null, null, JSON.stringify({ decodeTokens: Number(decodeTokens) || 0, turns, steps }), now)
    return id
  }

  /** Read token samples for one line inside [since, until]. */
  tokenSamples({ agentId, line, since = 0, until = Date.now() } = {}) {
    return this.#stmt("SELECT * FROM line_events WHERE line_id = ? AND action = 'token_sample' AND created_at >= ? AND created_at <= ? ORDER BY created_at")
      .all(lineId(agentId, line), since, until)
  }

  /**
   * Per-local-day token increments from cumulative samples (0.10.0 S3a).
   * Estimates only: a negative delta means the Session counter reset (rebind/replace) and counts as 0.
   */
  tokenTrend({ agentId, lines = [], days = 7, now = Date.now(), tzOffsetMinutes = -new Date().getTimezoneOffset() } = {}) {
    const n = Math.max(1, Math.min(90, Number(days) || 7))
    const since = now - n * 86400000
    const dayKey = (ts) => new Date(ts + tzOffsetMinutes * 60000).toISOString().slice(0, 10)
    const perDay = new Map()
    const detail = []
    let samplesTotal = 0
    for (const line of lines) {
      const rows = this.tokenSamples({ agentId, line, since })
      samplesTotal += rows.length
      let previous = null
      let latest = null
      let today = 0
      let windowIncrement = 0
      for (const row of rows) {
        let value = 0
        try { value = Number(JSON.parse(row.detail ?? '{}').decodeTokens ?? 0) } catch { value = 0 }
        latest = value
        if (previous !== null) {
          const delta = Math.max(0, value - previous)
          if (delta > 0) {
            const key = dayKey(row.created_at)
            perDay.set(key, (perDay.get(key) ?? 0) + delta)
            windowIncrement += delta
            if (key === dayKey(now)) today += delta
          }
        }
        previous = value
      }
      detail.push({
        line, latest, today, windowIncrement, samples: rows.length,
        firstAt: rows.length === 0 ? null : rows[0].created_at,
        lastAt: rows.length === 0 ? null : rows[rows.length - 1].created_at,
      })
    }
    const todayKey = dayKey(now)
    return {
      samples: samplesTotal,
      today: [...perDay.entries()].filter(([day]) => day === todayKey).reduce((sum, [, value]) => sum + value, 0),
      perDay: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, tokens]) => ({ date, tokens })),
      lines: detail,
      tzOffsetMinutes,
      basis: 'cumulative session decodeTokens sampled periodically; increments are estimates, not billing',
    }
  }

  /** Latest token sample for a line (0.10.0 S3a; sampling optimization / diagnostics). */
  lastTokenSample({ agentId, line } = {}) {
    return this.#stmt("SELECT * FROM line_events WHERE line_id = ? AND action = 'token_sample' ORDER BY created_at DESC LIMIT 1")
      .get(lineId(agentId, line))
  }

  /** Delete token samples older than a cutoff (0.10.0 S3a retention; keeps line_events bounded). */
  pruneTokenSamples({ agentId, before }) {
    if (before === undefined || before === null) throw new LineError('LINE_INVALID_ARGUMENT', 'pruneTokenSamples requires before')
    const rows = this.#stmt("SELECT id FROM line_events WHERE action = 'token_sample' AND line_id LIKE ? AND created_at < ?")
      .all(agentId + '#%', before)
    const del = this.#stmt("DELETE FROM line_events WHERE id = ?")
    for (const row of rows) del.run(row.id)
    return rows.length
  }

  counts(now = Date.now()) {
    const states = this.#stmt('SELECT state, COUNT(*) AS n FROM messages GROUP BY state ORDER BY state').all()
    const leases = this.#stmt('SELECT COUNT(*) AS n FROM leases WHERE expires_at > ?').get(now)
    const claims = this.#stmt("SELECT COUNT(*) AS n FROM claim_requests WHERE state = 'pending'").get()
    return { states, liveLeases: Number(leases.n), pendingClaims: Number(claims.n) }
  }
}

export { expandHome }