import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-gov-'))
  const store = new LineStore(join(dir, 'lines.db'))
  for (const [line, session] of [['manager', 'session-m'], ['frontend', 'session-f'], ['backend', 'session-b']]) {
    store.acquire({ agentId: 'agent-demo', line, sessionId: session, instanceId: 'i-' + line, ttlMs: 30000 })
  }
  return { store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('non-manager task waits for approval; approve queues it', () => {
  const { store, cleanup } = setup()
  try {
    const task = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'do it', kind: 'task', ccManager: true, requireApproval: true })
    assert.equal(task.state, 'pending_approval')
    assert.equal(task.approval_state, 'pending')
    assert.equal(store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-backend', limit: 10 }).length, 0)
    const feed = store.observe({ agentId: 'agent-demo', limit: 10 })
    assert.equal(feed.messages[0].kind, 'task')
    assert.equal(feed.messages[0].approvalState, 'pending')
    const approved = store.approveMessage({ messageId: task.id, decision: 'approve', actor: 'manager' })
    assert.equal(approved.state, 'queued')
    assert.equal(approved.approval_state, 'approved')
    assert.equal(store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-backend', limit: 10 }).length, 1)
  } finally { cleanup() }
})

test('reject closes a pending task without delivery', () => {
  const { store, cleanup } = setup()
  try {
    const task = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'do it', kind: 'task', requireApproval: true })
    const rejected = store.approveMessage({ messageId: task.id, decision: 'reject', actor: 'manager' })
    assert.equal(rejected.state, 'rejected')
    assert.equal(store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-backend', limit: 10 }).length, 0)
  } finally { cleanup() }
})

test('manager task and non-task messages do not require approval', () => {
  const { store, cleanup } = setup()
  try {
    const a = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'backend', text: 'manager task', kind: 'task' })
    const b = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'info', kind: 'info' })
    assert.equal(a.state, 'queued')
    assert.equal(b.state, 'queued')
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'x', kind: 'nope' }), error => error.code === 'LINE_INVALID_KIND')
  } finally { cleanup() }
})
