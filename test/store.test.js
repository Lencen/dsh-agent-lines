import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function acquire(store, line, instanceId, sessionId = 'session-' + line) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId, instanceId, ttlMs: 30000 })
}

test('send, claim, deliver, ack', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hello' })
    assert.equal(sent.state, 'queued')

    const claimed = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].id, sent.id)
    assert.equal(claimed[0].attempts, 1)

    store.markDelivered(sent.id, 'i-b')
    const inbox = store.inbox({ agentId: 'agent-demo', line: 'backend' })
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].state, 'delivered')

    const acked = store.markAck({ agentId: 'agent-demo', line: 'backend', messageId: sent.id })
    assert.equal(acked.state, 'acked')
    assert.equal(store.inbox({ agentId: 'agent-demo', line: 'backend' }).length, 0)
    assert.equal(store.inbox({ agentId: 'agent-demo', line: 'backend', includeAcked: true }).length, 1)
  } finally { cleanup() }
})

test('caller idempotency key collapses retries', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const one = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi', idempotencyKey: 'retry-1' })
    const two = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi', idempotencyKey: 'retry-1' })
    assert.equal(one.id, two.id)
    assert.equal(two.deduplicated, true)
    assert.equal(store.counts().states.find(s => s.state === 'queued').n, 1)
  } finally { cleanup() }
})

test('role is stored and listed', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 'session-frontend', instanceId: 'i-a', ttlMs: 30000, role: 'UI', createdBy: 'agent-demo#manager' })
    const row = store.listLines().find(line => line.label === 'frontend')
    assert.equal(row.role, 'UI')
    assert.equal(row.created_by, 'agent-demo#manager')
    assert.equal(store.countLines('agent-demo'), 1)
  } finally { cleanup() }
})

test('manager binding is durable', () => {
  const { store, cleanup } = tempStore()
  try {
    store.setManagerBinding({ agentId: 'agent-demo', lineId: 'agent-demo#manager', sessionId: 'session-a' })
    assert.equal(store.getManagerBinding('agent-demo').session_id, 'session-a')
    store.setManagerBinding({ agentId: 'agent-demo', lineId: 'agent-demo#manager', sessionId: 'session-b' })
    assert.equal(store.getManagerBinding('agent-demo').session_id, 'session-b')
  } finally { cleanup() }
})

test('manager claim requests are durable and resolvable', () => {
  const { store, cleanup } = tempStore()
  try {
    const claim = store.requestClaim({ agentId: 'agent-demo', lineId: 'agent-demo#manager', sessionId: 'session-current' })
    assert.equal(claim.state, 'pending')
    const pending = store.pendingClaims('agent-demo')
    assert.equal(pending.length, 1)
    assert.equal(store.counts().pendingClaims, 1)
    const reused = store.requestClaim({ agentId: 'agent-demo', lineId: 'agent-demo#manager', sessionId: 'session-current' })
    assert.equal(reused.id, claim.id)
    store.resolveClaim(claim.id, 'claimed')
    assert.equal(store.pendingClaims('agent-demo').length, 0)
  } finally { cleanup() }
})

test('noReply and maxReplyDepth stop echo chains', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'manager', 'i-m')
    acquire(store, 'frontend', 'i-f')
    const note = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'frontend', text: 'note', noReply: true })
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'manager', text: 'reply', replyTo: note.id }), /noReply/)
    const root = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'frontend', text: 'root' })
    const reply = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'manager', text: 'r1', replyTo: root.id, maxReplyDepth: 1 })
    assert.equal(reply.hop, 1)
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'frontend', text: 'r2', replyTo: reply.id, maxReplyDepth: 1 }), /maxReplyDepth/)
  } finally { cleanup() }
})

test('lease conflict is explicit', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    assert.throws(() => acquire(store, 'frontend', 'i-b'), error => error.code === 'LINE_LEASE_HELD')
    store.release({ agentId: 'agent-demo', line: 'frontend', instanceId: 'i-a' })
    acquire(store, 'frontend', 'i-b')
  } finally { cleanup() }
})

test('stale claims are requeued', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hello' })
    const t0 = Date.now()
    const first = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10, claimTimeoutMs: 1, now: t0 })
    assert.equal(first.length, 1)
    // A second claim inside the timeout sees nothing.
    assert.equal(store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10, claimTimeoutMs: 60000, now: t0 }).length, 0)
    // A claim after the timeout requeues and claims it again.
    const again = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10, claimTimeoutMs: 1, now: t0 + 10 })
    assert.equal(again.length, 1)
    assert.equal(again[0].id, sent.id)
    assert.equal(again[0].attempts, 2)
  } finally { cleanup() }
})