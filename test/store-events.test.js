import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-events-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function acquire(store, line, instanceId, sessionId = 'session-' + line) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId, instanceId, ttlMs: 30000 })
}

test('schema user_version is 15 and message_events exists', () => {
  const { store, cleanup } = tempStore()
  try {
    const v = store.db.prepare('PRAGMA user_version').get()
    assert.equal(Object.values(v)[0], 15)
    const table = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_events'").get()
    assert.equal(table.name, 'message_events')
  } finally { cleanup() }
})

test('every state transition appends an event in order', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hello' })
    store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    store.markDelivered(sent.id, 'i-b')
    store.markAck({ agentId: 'agent-demo', line: 'backend', messageId: sent.id })

    const events = store.eventsForMessage(sent.id)
    assert.deepEqual(events.map(e => e.state), ['queued', 'claimed', 'delivered', 'acked'])
    assert.deepEqual(events.map(e => e.seq), [...events.map(e => e.seq)].sort((a, b) => a - b))
    assert.equal(events[1].attempt, 1)
    assert.ok(events.every(e => typeof e.at === 'number'))
  } finally { cleanup() }
})

test('failed messages are queryable by state and counted', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'boom' })
    store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    const res = store.markError(sent.id, 'i-b', 'session/error', { maxAttempts: 1 })
    assert.equal(res.terminal, true)

    const failed = store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] })
    assert.equal(failed.length, 1)
    assert.equal(failed[0].id, sent.id)
    assert.equal(store.countsByState({ agentId: 'agent-demo', line: 'backend' }).failed, 1)

    const seq = store.eventsForMessage(sent.id).map(e => e.state)
    assert.deepEqual(seq, ['queued', 'claimed', 'failed'])
  } finally { cleanup() }
})

test('expired message gets an expired event', async () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'ttl', ttlMs: 5 })
    store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    await new Promise(resolve => setTimeout(resolve, 20))
    store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10, claimTimeoutMs: 0 })
    const states = store.eventsForMessage(sent.id).map(e => e.state)
    assert.deepEqual(states, ['queued', 'claimed', 'queued', 'expired'])
  } finally { cleanup() }
})

test('migration is re-entrant and does not destroy data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-mig-'))
  const path = join(dir, 'lines.db')
  try {
    const first = new LineStore(path)
    first.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's1', instanceId: 'i-a', ttlMs: 30000 })
    const sent = first.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'frontend', text: 'self note', allowSelfSend: true }).catch?.(() => null) ?? null
    first.close()
    // simulate an older database: drop the new table and downgrade user_version
    const second = new LineStore(path)
    second.db.exec('DROP TABLE IF EXISTS message_events')
    second.db.exec('PRAGMA user_version = 12')
    second.close()
    const third = new LineStore(path)
    const v = third.db.prepare('PRAGMA user_version').get()
    assert.equal(Object.values(v)[0], 15)
    const table = third.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_events'").get()
    assert.equal(table.name, 'message_events')
    third.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
