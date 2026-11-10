import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-s1b-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}
function acquire(store, line, instanceId) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId: 'session-' + line, instanceId, ttlMs: 30000 })
}
function failOne(store, to = 'backend') {
  acquire(store, 'frontend', 'i-a')
  acquire(store, to, 'i-b')
  const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to, text: 'boom' })
  store.claim({ agentId: 'agent-demo', line: to, instanceId: 'i-b', limit: 10 })
  store.markError(sent.id, 'i-b', 'session/error', { maxAttempts: 1 })
  return sent
}

test('redeliver requeues failed message and keeps audit trail', () => {
  const { store, cleanup } = tempStore()
  try {
    const sent = failOne(store)
    const out = store.redeliver({ agentId: 'agent-demo', messageId: sent.id, actor: 'manager' })
    assert.equal(out.state, 'queued')
    assert.equal(out.attempts, 0)
    const states = store.eventsForMessage(sent.id).map(e => e.state)
    assert.deepEqual(states, ['queued', 'claimed', 'failed', 'redelivered'])
    assert.equal(store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] }).length, 0)
  } finally { cleanup() }
})

test('redeliver rejects non-failed messages and unknown target line', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a'); acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' })
    assert.throws(() => store.redeliver({ agentId: 'agent-demo', messageId: sent.id }), /only failed\/expired/)
    const failed = failOne(store)
    assert.throws(() => store.redeliver({ agentId: 'agent-demo', messageId: failed.id, to: 'nope' }), /Unknown line/)
  } finally { cleanup() }
})

test('purge defaults to dryRun and only removes terminal old messages', () => {
  const { store, cleanup } = tempStore()
  try {
    const sent = failOne(store)
    const dry = store.purge({ agentId: 'agent-demo', before: Date.now() + 1000 })
    assert.deepEqual(dry, { wouldDelete: 1, deleted: 0, dryRun: true })
    assert.equal(store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] }).length, 1)
    const real = store.purge({ agentId: 'agent-demo', before: Date.now() + 1000, dryRun: false, actor: 'manager' })
    assert.deepEqual(real, { wouldDelete: 1, deleted: 1, dryRun: false })
    assert.equal(store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] }).length, 0)
    // querying the deleted message yields an empty timeline only if row is gone; events remain for audit
    assert.equal(store.eventsForMessage(sent.id).length > 0, true)
  } finally { cleanup() }
})

test('ackOverdue reports delivered-but-unacked messages without retrying', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a'); acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'wait' })
    store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    store.markDelivered(sent.id, 'i-b', Date.now() - 60_000)
    const overdue = store.ackOverdue({ agentId: 'agent-demo', line: 'backend', timeoutMs: 30_000 })
    assert.equal(overdue.length, 1)
    assert.equal(store.inbox({ agentId: 'agent-demo', line: 'backend' })[0].state, 'delivered')
    const fresh = store.ackOverdue({ agentId: 'agent-demo', line: 'backend', timeoutMs: 120_000 })
    assert.equal(fresh.length, 0)
  } finally { cleanup() }
})
