import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransport, TRANSPORTS } from '../lib/transport.js'
import { LineError } from '../lib/protocol.js'

function acquire(store, line, instanceId) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId: 'session-' + line, instanceId, ttlMs: 30000 })
}

test('memory transport is registered and creates an in-memory store', () => {
  assert.ok(TRANSPORTS.includes('memory'))
  const store = createTransport({ transport: 'memory', dbPath: ':memory:' })
  try {
    assert.equal(store.dbPath, ':memory:')
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' })
    const claimed = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    assert.equal(claimed.length, 1)
    store.markDelivered(sent.id, 'i-b')
    const acked = store.markAck({ agentId: 'agent-demo', line: 'backend', messageId: sent.id })
    assert.equal(acked.state, 'acked')
    assert.equal(store.eventsForMessage(sent.id).length >= 4, true)
  } finally { store.close() }
})

test('memory transports are isolated from each other', () => {
  const a = createTransport({ transport: 'memory', dbPath: ':memory:' })
  const b = createTransport({ transport: 'memory', dbPath: ':memory:' })
  try {
    acquire(a, 'frontend', 'i-a')
    acquire(b, 'frontend', 'i-a')
    a.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'frontend', text: 'note', allowSelfSend: true })
    assert.equal(a.messagesForLine({ agentId: 'agent-demo', line: 'frontend', limit: 10 }).length, 1)
    assert.equal(b.messagesForLine({ agentId: 'agent-demo', line: 'frontend', limit: 10 }).length, 0)
  } finally { a.close(); b.close() }
})

test('unknown transport is rejected', () => {
  assert.throws(() => createTransport({ transport: 'postgres', dbPath: ':memory:' }), (error) => {
    assert.ok(error instanceof LineError)
    assert.equal(error.code, 'LINE_INVALID_CONFIG')
    return true
  })
})
