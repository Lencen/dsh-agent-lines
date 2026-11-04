import test from 'node:test'
import assert from 'node:assert/strict'
import { DeliveryLoop } from '../lib/delivery.js'

function config(overrides = {}) {
  return {
    agentId: 'agent-demo', line: 'backend', sessionId: 'session-backend', instanceId: 'i-b',
    pollMs: 100000, leaseTtlMs: 30000, claimBatch: 10, claimTimeoutMs: 60000,
    deliveryTimeoutMs: 5000, maxAttempts: 3, maxMessageBytes: 65536, ...overrides,
  }
}

function fakeStore(row) {
  const calls = { delivered: [], errors: [], heartbeat: 0 }
  return {
    calls,
    heartbeat() { calls.heartbeat += 1 },
    claim() { return row ? [row] : [] },
    markDelivered(id, instance) { calls.delivered.push([id, instance]) },
    markError(id, instance, error, options) { calls.errors.push({ id, instance, error, options }) },
    release() {},
  }
}

test('delivery uses the message id as requestId and the bound session', async () => {
  const seen = []
  const row = { id: 'msg_1', from_agent: 'agent-demo', from_line: 'frontend', body: 'hi', reply_to: null, attempts: 1 }
  const loop = new DeliveryLoop({
    ctx: { sessionController: { prompt: async (request) => { seen.push(request) } }, logger: { info() {}, warn() {} } },
    config: config(), store: fakeStore(row),
  })
  await loop.tick()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].requestId, 'msg_1')
  assert.equal(seen[0].sessionId, 'session-backend')
  assert.equal(seen[0].mode, 'steer')
  assert.match(seen[0].content[0].text, /from agent-demo#frontend/)
})

test('session/not-found is terminal', async () => {
  const row = { id: 'msg_2', from_agent: 'agent-demo', from_line: 'frontend', body: 'hi', reply_to: null, attempts: 1 }
  const store = fakeStore(row)
  const loop = new DeliveryLoop({
    ctx: { sessionController: { prompt: async () => { const error = new Error('missing'); error.code = 'session/not-found'; throw error } }, logger: { info() {}, warn() {} } },
    config: config(), store,
  })
  await loop.tick()
  assert.equal(store.calls.errors.length, 1)
  assert.equal(store.calls.errors[0].options.nextAttemptAt, undefined)
})
