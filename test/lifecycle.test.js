import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-life-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function acquire(store, line, instanceId, sessionId = 'session-' + line) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId, instanceId, ttlMs: 30000 })
}

test('schema v9 has lifecycle/title/line_events', () => {
  const { store, cleanup } = tempStore()
  try {
    const columns = store.db.prepare('PRAGMA table_info(lines)').all().map(c => c.name)
    for (const name of ['title', 'lifecycle', 'generation', 'rebind_at', 'rebind_from']) assert.ok(columns.includes(name), name)
    const msgCols = store.db.prepare('PRAGMA table_info(messages)').all().map(c => c.name)
    for (const name of ['kind', 'cc_manager', 'approval_state', 'task_ref', 'approved_by', 'approved_at']) assert.ok(msgCols.includes(name), name)
    const eventCols = store.db.prepare('PRAGMA table_info(line_events)').all().map(c => c.name)
    for (const name of ['id', 'line_id', 'action', 'old_session_id', 'new_session_id', 'reason', 'created_at']) assert.ok(eventCols.includes(name), name)
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 9)
  } finally { cleanup() }
})

test('title persists and is listed', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'writer', 'i-w')
    store.setTitle({ agentId: 'agent-demo', line: 'writer', title: '写手 · 正文', actor: 'manager' })
    assert.equal(store.listLines().find(row => row.label === 'writer').title, '写手 · 正文')
    assert.equal(store.lastLineEvent({ agentId: 'agent-demo', line: 'writer', action: 'title' }).action, 'title')
  } finally { cleanup() }
})

test('retire rejects new sends but keeps history', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'manager', 'i-m')
    acquire(store, 'writer', 'i-w')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'hello' })
    store.retire({ agentId: 'agent-demo', line: 'writer', actor: 'manager', reason: 'context full' })
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'again' }), error => error.code === 'LINE_RETIRED')
    assert.equal(store.messagesForLine({ agentId: 'agent-demo', line: 'writer' }).some(row => row.id === sent.id), true)
    assert.equal(store.getLineRow('agent-demo', 'writer').lifecycle, 'retired')
  } finally { cleanup() }
})

test('rebind requeues claimed, keeps delivered, bumps generation', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'manager', 'i-m')
    acquire(store, 'writer', 'i-old')
    const a = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'a' })
    const b = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'b' })
    const c = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'c' })
    const claimed = store.claim({ agentId: 'agent-demo', line: 'writer', instanceId: 'i-old', limit: 2 })
    assert.equal(claimed.length, 2)
    assert.equal(claimed[0].id, a.id)
    store.markDelivered(a.id, 'i-old')
    // b remains claimed; c queued
    const rebound = store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 'session-new', actor: 'manager', reason: 'context full' })
    assert.equal(rebound.oldSessionId, 'session-writer')
    assert.equal(rebound.generation, 2)
    assert.equal(store.getLineRow('agent-demo', 'writer').session_id, 'session-new')
    assert.equal(store.messageCounts({ agentId: 'agent-demo', line: 'writer' }).delivered, 1)
    assert.equal(store.messageCounts({ agentId: 'agent-demo', line: 'writer' }).queued, 2)
    assert.equal(store.lastLineEvent({ agentId: 'agent-demo', line: 'writer' }).new_session_id, 'session-new')
    acquire(store, 'writer', 'i-new', 'session-new')
    const again = store.claim({ agentId: 'agent-demo', line: 'writer', instanceId: 'i-new', limit: 10 })
    assert.deepEqual(again.map(row => row.id).sort(), [b.id, c.id].sort())
  } finally { cleanup() }
})

test('rebind migrate=none fails closed when backlog is non-empty', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'manager', 'i-m')
    acquire(store, 'writer', 'i-w')
    store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'pending' })
    assert.throws(() => store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 'session-new', migrate: 'none' }), error => error.code === 'LINE_BACKLOG_NOT_EMPTY')
    assert.equal(store.getLineRow('agent-demo', 'writer').session_id, 'session-writer')
  } finally { cleanup() }
})

test('retired line can be rebound to a clean session', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'manager', 'i-m')
    acquire(store, 'writer', 'i-w')
    store.retire({ agentId: 'agent-demo', line: 'writer' })
    const rebound = store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 'session-new', migrate: 'queued' })
    assert.equal(rebound.lifecycle, 'active')
    assert.equal(store.getLineRow('agent-demo', 'writer').lifecycle, 'active')
  } finally { cleanup() }
})
test('v6 database migrates additively to v9', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-v6-'))
  const dbPath = join(dir, 'lines.db')
  try {
    const old = new DatabaseSync(dbPath)
    old.exec("CREATE TABLE lines (line_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, label TEXT NOT NULL, role TEXT, created_by TEXT, session_id TEXT NOT NULL, instance_id TEXT, status TEXT NOT NULL DEFAULT 'offline', last_seen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(agent_id, label)); PRAGMA user_version = 6")
    old.exec("INSERT INTO lines(line_id, agent_id, label, session_id, status, created_at) VALUES('agent-demo#writer','agent-demo','writer','session-old','offline',1)")
    old.close()
    const store = new LineStore(dbPath)
    try {
      const columns = store.db.prepare('PRAGMA table_info(lines)').all().map(c => c.name)
      for (const name of ['title', 'lifecycle', 'generation', 'rebind_at', 'rebind_from']) assert.ok(columns.includes(name), name)
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 9)
      assert.equal(store.getLineRow('agent-demo', 'writer').lifecycle, 'active')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})