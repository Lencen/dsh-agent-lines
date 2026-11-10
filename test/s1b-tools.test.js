import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { registerToolsForAgent } from '../lib/tools.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-s1b-tools-'))
  const store = new LineStore(join(dir, 'lines.db'))
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: false,
    dedupeWindowMs: 5000, maxReplyDepth: 8, allowSelfSend: true, bootstrapOnCreate: false,
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
  const ctx = {
    tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } },
    agents: { get: () => undefined },
    agentTeams: { listTasks: () => [], listMembers: () => [] },
  }
  const agent = { ctx, session: { id: defs.manager.sessionId } }
  registerToolsForAgent(agent, defs.manager, {
    config, store, lineDefs,
    createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
  })
  const exec = (label) => ({ agent: { session: { id: defs[label].sessionId } } })
  return { store, registered, exec, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function failOne(store) {
  const sent = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'boom' })
  store.claim({ agentId: 'agent-demo', line: 'worker', instanceId: 'i-worker', limit: 10 })
  store.markError(sent.id, 'i-worker', 'session/error', { maxAttempts: 1 })
  return sent
}

test('line_messages lists failed messages for the manager', async () => {
  const h = harness()
  try {
    const sent = failOne(h.store)
    const out = await h.registered.get('line_messages').execute({ line: 'worker', states: ['failed'] }, h.exec('manager'))
    assert.equal(out.counts.failed, 1)
    assert.equal(out.messages[0].id, sent.id)
  } finally { h.cleanup() }
})

test('line_trace returns the lifecycle timeline', async () => {
  const h = harness()
  try {
    const sent = failOne(h.store)
    const out = await h.registered.get('line_trace').execute({ messageId: sent.id }, h.exec('manager'))
    assert.deepEqual(out.events.map(e => e.state), ['queued', 'claimed', 'failed'])
  } finally { h.cleanup() }
})

test('line_redeliver requeues failed message and rejects non-involved caller', async () => {
  const h = harness()
  try {
    const sent = failOne(h.store)
    const out = await h.registered.get('line_redeliver').execute({ messageId: sent.id }, h.exec('manager'))
    assert.equal(out.state, 'queued')
    await assert.rejects(() => h.registered.get('line_redeliver').execute({ messageId: sent.id }, h.exec('worker')), /Only/)
  } finally { h.cleanup() }
})

test('line_purge defaults to dryRun', async () => {
  const h = harness()
  try {
    failOne(h.store)
    const out = await h.registered.get('line_purge').execute({ before: Date.now() + 1000 }, h.exec('manager'))
    assert.equal(out.dryRun, true)
    assert.equal(out.deleted, 0)
    assert.equal(out.wouldDelete, 1)
  } finally { h.cleanup() }
})
