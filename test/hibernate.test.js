import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { registerStatusTool, registerToolsForAgent } from '../lib/tools.js'
import { LineError } from '../lib/protocol.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-hib-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('lifecycle accepts hibernating and marks the line offline', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    const row = store.setLifecycle({ agentId: 'agent-demo', line: 'frontend', lifecycle: 'hibernating', reason: 'test' })
    assert.equal(row.lifecycle, 'hibernating')
    assert.equal(row.status, 'offline')
    assert.equal(store.lastLineEvent({ agentId: 'agent-demo', line: 'frontend', action: 'hibernating' }).action, 'hibernating')
  } finally { cleanup() }
})

test('sending to a hibernating line fails with LINE_HIBERNATING', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    store.acquire({ agentId: 'agent-demo', line: 'backend', sessionId: 's-b', instanceId: 'i-b', ttlMs: 60000 })
    store.setLifecycle({ agentId: 'agent-demo', line: 'backend', lifecycle: 'hibernating' })
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' }), (error) => {
      assert.ok(error instanceof LineError)
      assert.equal(error.code, 'LINE_HIBERNATING')
      return true
    })
  } finally { cleanup() }
})

test('a hibernating line can be retired but not delivered to', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    store.setLifecycle({ agentId: 'agent-demo', line: 'frontend', lifecycle: 'hibernating' })
    const row = store.retire({ agentId: 'agent-demo', line: 'frontend', reason: 'done' })
    assert.equal(row.lifecycle, 'retired')
  } finally { cleanup() }
})

test('invalid lifecycle values are rejected', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    assert.throws(() => store.setLifecycle({ agentId: 'agent-demo', line: 'frontend', lifecycle: 'sleeping' }), (error) => error.code === 'LINE_INVALID_LIFECYCLE')
  } finally { cleanup() }
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-hib-tools-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: true, dbPath,
    dedupeWindowMs: 5000, maxReplyDepth: 8, allowSelfSend: true, bootstrapOnCreate: false,
    maxMessageBytes: 65536, ackTimeoutMs: 60000, lines: [{ label: 'manager', sessionId: 'session-manager' }],
  }
  const lineDefs = new Map()
  const registered = new Map()
  const calls = []
  const sessions = {}
  for (const label of ['manager', 'worker']) {
    const sessionId = 'session-' + label
    sessions[label] = sessionId
    store.acquire({ agentId: 'agent-demo', line: label, sessionId, instanceId: 'i-' + label, ttlMs: 60000 })
    const def = { label, agentId: 'agent-demo', sessionId, lineId: 'agent-demo#' + label }
    lineDefs.set(sessionId, def)
  }
  store.setLifecycle({ agentId: 'agent-demo', line: 'worker', lifecycle: 'hibernating' })
  const makeAgent = (label) => ({
    session: { id: sessions[label] },
    ctx: {
      tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } },
      agents: { get: () => undefined, list: () => [] },
      get: () => undefined,
    },
  })
  const deps = {
    config, store, lineDefs,
    createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
    hibernateLine: async (args) => { calls.push(['hibernate', args]); return { line: args.label, lifecycle: 'hibernating', already: false } },
    wakeLine: async (args) => { calls.push(['wake', args]); return { line: args.label, lifecycle: 'active', already: false } },
  }
  const managerAgent = makeAgent('manager')
  registerToolsForAgent(managerAgent, lineDefs.get(sessions.manager), deps)
  registerStatusTool(managerAgent.ctx, { config, store, lineDefs })
  const workerAgent = makeAgent('worker')
  registerToolsForAgent(workerAgent, lineDefs.get(sessions.worker), deps)
  return { store, registered, managerAgent, workerAgent, calls, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('line_hibernate and line_wake are registered and dispatch to the manager callbacks', async () => {
  const h = harness()
  try {
    assert.ok(h.registered.get('line_hibernate'))
    assert.ok(h.registered.get('line_wake'))
    const hib = await h.registered.get('line_hibernate').execute({ line: 'worker' }, { agent: h.managerAgent })
    assert.equal(hib.lifecycle, 'hibernating')
    const wake = await h.registered.get('line_wake').execute({ line: 'worker', reason: 'morning' }, { agent: h.managerAgent })
    assert.equal(wake.lifecycle, 'active')
    assert.deepEqual(h.calls.map(c => c[0]), ['hibernate', 'wake'])
    assert.equal(h.calls[1][1].reason, 'morning')
  } finally { h.cleanup() }
})

test('worker lines may not hibernate or wake lines', async () => {
  const h = harness()
  try {
    const tool = h.registered.get('line_hibernate')
    await assert.rejects(tool.execute({ line: 'manager' }, { agent: h.workerAgent }), (error) => error.code === 'LINE_CREATE_FORBIDDEN')
  } finally { h.cleanup() }
})

test('line_status exposes the hibernating lifecycle', async () => {
  const h = harness()
  try {
    const status = await h.registered.get('line_status').execute({}, { agent: h.managerAgent })
    const worker = status.lines.find(line => line.label === 'worker')
    assert.equal(worker.lifecycle, 'hibernating')
  } finally { h.cleanup() }
})

test('a hibernating line cannot send outbound either', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    store.acquire({ agentId: 'agent-demo', line: 'backend', sessionId: 's-b', instanceId: 'i-b', ttlMs: 60000 })
    store.setLifecycle({ agentId: 'agent-demo', line: 'frontend', lifecycle: 'hibernating' })
    assert.throws(() => store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' }), (error) => {
      assert.ok(error instanceof LineError)
      assert.equal(error.code, 'LINE_HIBERNATING')
      return true
    })
    const counts = store.messageCounts({ agentId: 'agent-demo', line: 'backend' })
    assert.equal(counts.queued, 0, 'outbound from a hibernating line must not queue')
  } finally { cleanup() }
})
