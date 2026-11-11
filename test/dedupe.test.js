import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { LineStore } from '../lib/store.js'
import { dedupeDigest } from '../lib/protocol.js'
import { registerToolsForAgent } from '../lib/tools.js'

function storeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-dedupe-'))
  const store = new LineStore(join(dir, 'lines.db'))
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'worker', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function send(store, now, extra = {}) {
  return store.send({
    agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'same task',
    dedupeDigest: dedupeDigest({ from: 'agent-demo#manager', to: 'agent-demo#worker', text: 'same task' }),
    dedupeWindowMs: 5000, now, ...extra,
  })
}

test('sliding dedupe collapses sends across the old bucket boundary', () => {
  const h = storeHarness()
  try {
    const first = send(h.store, 4999)
    const second = send(h.store, 5001)
    assert.equal(second.id, first.id)
    assert.equal(second.deduplicated, true)
    assert.equal(h.store.messagesForLine({ agentId: 'agent-demo', line: 'worker', limit: 10 }).length, 1)
  } finally { h.cleanup() }
})

test('sliding dedupe allows a send outside the window', () => {
  const h = storeHarness()
  try {
    const first = send(h.store, 1000)
    const second = send(h.store, 6001)
    assert.notEqual(second.id, first.id)
    assert.equal(second.deduplicated, false)
    assert.equal(h.store.messagesForLine({ agentId: 'agent-demo', line: 'worker', limit: 10 }).length, 2)
  } finally { h.cleanup() }
})

test('explicit idempotencyKey remains exact-once', () => {
  const h = storeHarness()
  try {
    const first = h.store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'k', idempotencyKey: 'fixed-1' })
    const second = h.store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'k', idempotencyKey: 'fixed-1' })
    assert.equal(second.id, first.id)
    assert.equal(second.deduplicated, true)
  } finally { h.cleanup() }
})

function toolHarness({ allowSelfSend = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-dedupe-tool-'))
  const store = new LineStore(join(dir, 'lines.db'))
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: false,
    dedupeWindowMs: 5000, maxReplyDepth: 8, allowSelfSend, bootstrapOnCreate: false,
    maxMessageBytes: 65536, ackTimeoutMs: 60000, lines: [],
  }
  const lineDefs = new Map()
  const defs = {}
  const registered = new Map()
  for (const label of ['manager', 'worker']) {
    const sessionId = 'session-' + label
    store.acquire({ agentId: 'agent-demo', line: label, sessionId, instanceId: 'i-' + label, ttlMs: 60000 })
    const def = { label, agentId: 'agent-demo', sessionId, lineId: 'agent-demo#' + label }
    lineDefs.set(sessionId, def)
    defs[label] = def
  }
  const ctx = { tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } }, agents: { get: () => undefined }, agentTeams: { listTasks: () => [], listMembers: () => [] } }
  registerToolsForAgent({ ctx, session: { id: defs.manager.sessionId } }, defs.manager, {
    config, store, lineDefs, createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
  })
  const exec = (label) => ({ agent: { session: { id: defs[label].sessionId } } })
  return { store, registered, exec, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('line_send dedupes by default and forceDistinct bypasses it', async () => {
  const h = toolHarness()
  try {
    const send = h.registered.get('line_send')
    const a = await send.execute({ to: 'worker', text: 'same tool task' }, h.exec('manager'))
    const b = await send.execute({ to: 'worker', text: 'same tool task' }, h.exec('manager'))
    assert.equal(b.id, a.id)
    assert.equal(b.deduplicated, true)
    const c = await send.execute({ to: 'worker', text: 'same tool task', forceDistinct: true }, h.exec('manager'))
    const d = await send.execute({ to: 'worker', text: 'same tool task', forceDistinct: true }, h.exec('manager'))
    assert.equal(c.deduplicated, false)
    assert.equal(d.deduplicated, false)
    assert.notEqual(c.id, d.id)
  } finally { h.cleanup() }
})

test('line_send rejects self-send when allowSelfSend is false', async () => {
  const h = toolHarness({ allowSelfSend: false })
  try {
    await assert.rejects(() => h.registered.get('line_send').execute({ to: 'manager', text: 'self' }, h.exec('manager')), /Self-send/) 
  } finally { h.cleanup() }
})

test('CLI send uses the same sliding window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-dedupe-cli-'))
  try {
    const db = join(dir, 'lines.db')
    const store = new LineStore(db)
    store.acquire({ agentId: 'agent-deepseek', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
    store.acquire({ agentId: 'agent-deepseek', line: 'worker', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
    store.close()
    const args = ['bin/dsh-agent-lines.js', '--db', db, '--json', 'send', '--from', 'manager', '--to', 'worker', '--text', 'cli same']
    const first = JSON.parse(execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' }))
    const second = JSON.parse(execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' }))
    assert.equal(first.deduplicated, false)
    assert.equal(second.deduplicated, true)
    assert.equal(second.id, first.id)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI task send shares the tool digest and dedupes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-dedupe-cli-task-'))
  try {
    const db = join(dir, 'lines.db')
    const setup = new LineStore(db)
    setup.acquire({ agentId: 'agent-deepseek', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
    setup.acquire({ agentId: 'agent-deepseek', line: 'worker', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
    setup.close()
    const args = ['bin/dsh-agent-lines.js', '--db', db, '--json', 'send', '--from', 'manager', '--to', 'worker', '--text', 'task same', '--kind', 'task', '--task-ref', 'T-1']
    const first = JSON.parse(execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' }))
    assert.equal(first.kind, 'task')
    assert.equal(first.deduplicated, false)
    const store = new LineStore(db)
    const digest = dedupeDigest({ from: 'agent-deepseek#manager', to: 'agent-deepseek#worker', text: 'task same', replyTo: undefined, kind: 'task', ccManager: true, taskRef: 'T-1' })
    const second = store.send({ agentId: 'agent-deepseek', fromLine: 'manager', to: 'worker', text: 'task same', kind: 'task', ccManager: true, taskRef: 'T-1', dedupeDigest: digest, dedupeWindowMs: 5000 })
    assert.equal(second.deduplicated, true)
    assert.equal(second.id, first.id)
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schema v15 backfills dedupe_digest and uses the dedupe index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-dedupe-backfill-'))
  try {
    const db = join(dir, 'lines.db')
    const setup = new LineStore(db)
    setup.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
    setup.acquire({ agentId: 'agent-demo', line: 'worker', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
    const digest = dedupeDigest({ from: 'agent-demo#manager', to: 'agent-demo#worker', text: 'legacy' })
    const row = setup.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'legacy', dedupeDigest: digest, dedupeWindowMs: 5000 })
    setup.db.prepare('UPDATE messages SET idempotency_key = ?, dedupe_digest = NULL WHERE id = ?').run('window:123:' + digest, row.id)
    setup.db.exec('PRAGMA user_version = 14')
    setup.close()
    const reopened = new LineStore(db)
    assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 15)
    assert.equal(reopened.db.prepare('SELECT dedupe_digest FROM messages WHERE id = ?').get(row.id).dedupe_digest, digest)
    const plan = reopened.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM messages WHERE dedupe_digest = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1').all(digest, 0).map(r => r.detail).join(' ')
    assert.match(plan, /USING INDEX messages_dedupe/)
    reopened.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
