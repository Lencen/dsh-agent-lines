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
  LineError, STATES, assertMessageSize, lineId, makeIdempotencyKey, newMessageId, parseTarget,
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
  created_by TEXT,
  session_id TEXT NOT NULL,
  instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
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

PRAGMA user_version = 6;
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
    this.dbPath = expandHome(dbPath)
    assertLocalPath(this.dbPath)
    const fresh = !existsSync(this.dbPath)
    this.db = new DatabaseSync(this.dbPath)
    try { chmodSync(this.dbPath, 0o600) } catch { /* best effort on platforms without POSIX modes */ }
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(lines)').all().map(column => column.name)
    if (!columns.includes('role')) this.db.exec('ALTER TABLE lines ADD COLUMN role TEXT')
    if (!columns.includes('created_by')) this.db.exec('ALTER TABLE lines ADD COLUMN created_by TEXT')
    const messageColumns = this.db.prepare('PRAGMA table_info(messages)').all().map(column => column.name)
    if (!messageColumns.includes('root_message_id')) this.db.exec('ALTER TABLE messages ADD COLUMN root_message_id TEXT')
    if (!messageColumns.includes('hop')) this.db.exec('ALTER TABLE messages ADD COLUMN hop INTEGER NOT NULL DEFAULT 0')
    if (!messageColumns.includes('no_reply')) this.db.exec('ALTER TABLE messages ADD COLUMN no_reply INTEGER NOT NULL DEFAULT 0')
    this.db.exec('PRAGMA user_version = 6')
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
  send({ agentId, fromLine, to, text, idempotencyKey, replyTo, noReply = false, maxReplyDepth = 8, maxMessageBytes = 65536, ttlMs, now = Date.now() }) {
    const from = this.#stmt('SELECT * FROM lines WHERE agent_id = ? AND label = ?').get(agentId, fromLine)
    if (from === undefined) throw new LineError('LINE_NOT_FOUND', `Sender line is not registered: ${agentId}#${fromLine}`)
    const target = this.resolveTarget(agentId, to)
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
      created_at, expires_at, reply_to, root_message_id, hop, no_reply, state, attempts, next_attempt_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`)
      .run(id, key, from.agent_id, from.label, from.session_id, target.agentId, target.line, body, now, expiresAt, replyTo ?? null, rootMessageId, hop, noReply === true ? 1 : 0, now)
    return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(id), deduplicated: false }
  }

  /** Requeue messages whose claim outlived its claim timeout. */
  #requeueStale(toAgent, toLine, now, claimTimeoutMs) {
    this.#stmt(`UPDATE messages SET state = 'queued', claimed_by = NULL, claimed_at = NULL, next_attempt_at = ?
      WHERE to_agent = ? AND to_line = ? AND state = 'claimed' AND claimed_at < ?`)
      .run(now, toAgent, toLine, now - claimTimeoutMs)
    this.#stmt(`UPDATE messages SET state = 'expired'
      WHERE to_agent = ? AND to_line = ? AND state IN ('queued', 'claimed') AND expires_at IS NOT NULL AND expires_at <= ?`)
      .run(toAgent, toLine, now)
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
      for (const row of rows) {
        this.#stmt(`UPDATE messages SET state = 'claimed', claimed_by = ?, claimed_at = ?, attempts = attempts + 1
          WHERE id = ? AND state = 'queued'`).run(instanceId, now, row.id)
      }
      return rows.map(row => ({ ...row, state: 'claimed', claimed_by: instanceId, claimed_at: now, attempts: row.attempts + 1 }))
    })
  }

  markDelivered(id, instanceId, now = Date.now()) {
    const result = this.#stmt(`UPDATE messages SET state = 'delivered', delivered_at = ?, last_error = NULL
      WHERE id = ? AND state = 'claimed' AND claimed_by = ?`).run(now, id, instanceId)
    if (result.changes !== 1) throw new LineError('LINE_DELIVERY_STATE', `Message ${id} is not claimed by this instance`)
  }

  markError(id, instanceId, error, { nextAttemptAt, maxAttempts = 8, now = Date.now() } = {}) {
    return this.#tx(() => {
      const row = this.#stmt('SELECT * FROM messages WHERE id = ? AND claimed_by = ?').get(id, instanceId)
      if (row === undefined) return undefined
      const terminal = row.attempts >= maxAttempts
      this.#stmt(`UPDATE messages SET state = ?, claimed_by = NULL, claimed_at = NULL, next_attempt_at = ?, last_error = ?
        WHERE id = ?`).run(terminal ? 'failed' : 'queued', terminal ? now : (nextAttemptAt ?? now), String(error).slice(0, 2000), id)
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
    return { ...this.#stmt('SELECT * FROM messages WHERE id = ?').get(messageId), alreadyAcked: false }
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
        WHERE m.to_agent = l.agent_id AND m.to_line = l.label AND m.state IN ('queued', 'claimed', 'delivered')) AS unread
      FROM lines l ORDER BY l.agent_id, l.label`).all()
    return rows.map(row => {
      const lease = this.#stmt('SELECT * FROM leases WHERE line_id = ?').get(row.line_id)
      return {
        ...row,
        unread: Number(row.unread),
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
    return {
      ...row,
      unread: Number(unread.n),
      lease: lease === undefined ? null : { instanceId: lease.instance_id, expiresAt: lease.expires_at, live: lease.expires_at > now },
    }
  }

  counts(now = Date.now()) {
    const states = this.#stmt('SELECT state, COUNT(*) AS n FROM messages GROUP BY state ORDER BY state').all()
    const leases = this.#stmt('SELECT COUNT(*) AS n FROM leases WHERE expires_at > ?').get(now)
    const claims = this.#stmt("SELECT COUNT(*) AS n FROM claim_requests WHERE state = 'pending'").get()
    return { states, liveLeases: Number(leases.n), pendingClaims: Number(claims.n) }
  }
}

export { expandHome }
