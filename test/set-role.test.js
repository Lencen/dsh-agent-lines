import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { registerToolsForAgent } from '../lib/tools.js'
import { LineError } from '../lib/protocol.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-role-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('setRole updates the role and writes an audit event', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w', instanceId: 'i-a', ttlMs: 60000 })
    const row = store.setRole({ agentId: 'agent-demo', line: 'writer', role: ' 主笔 ', actor: 'session-m' })
    assert.equal(row.role, '主笔')
    assert.equal(store.lastLineEvent({ agentId: 'agent-demo', line: 'writer', action: 'role' }).action, 'role')
  } finally { cleanup() }
})

test('setRole on an unknown line throws LINE_NOT_FOUND', () => {
  const { store, cleanup } = tempStore()
  try {
    assert.throws(() => store.setRole({ agentId: 'agent-demo', line: 'ghost', role: 'x' }), (error) => {
      assert.ok(error instanceof LineError)
      assert.equal(error.code, 'LINE_NOT_FOUND')
      return true
    })
  } finally { cleanup() }
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-role-tools-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: true, dbPath,
    dedupeWindowMs: 5000, maxReplyDepth: 8, allowSelfSend: true, bootstrapOnCreate: false,
    maxMessageBytes: 65536, ackTimeoutMs: 60000, lines: [],
  }
  const lineDefs = new Map()
  const registered = new Map()
  const calls = []
  const sessions = {}
  for (const label of ['manager', 'writer']) {
    const sessionId = 'session-' + label
    sessions[label] = sessionId
    store.acquire({ agentId: 'agent-demo', line: label, sessionId, instanceId: 'i-' + label, ttlMs: 60000 })
    lineDefs.set(sessionId, { label, agentId: 'agent-demo', sessionId, lineId: 'agent-demo#' + label })
  }
  const deps = {
    config, store, lineDefs,
    createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
    hibernateLine: async () => ({}), wakeLine: async () => ({}),
    setRoleLine: async (args) => { calls.push(args); return { line: args.label, role: args.role } },
  }
  const agentFor = (label) => ({
    session: { id: sessions[label] },
    ctx: { tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } }, agents: { get: () => undefined, list: () => [] }, get: () => undefined },
  })
  const manager = agentFor('manager')
  registerToolsForAgent(manager, lineDefs.get(sessions.manager), deps)
  const worker = agentFor('writer')
  registerToolsForAgent(worker, lineDefs.get(sessions.writer), deps)
  return { registered, manager, worker, calls, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('line_set_role is registered and dispatches to the manager callback', async () => {
  const h = harness()
  try {
    assert.ok(h.registered.get('line_set_role'))
    const result = await h.registered.get('line_set_role').execute({ line: 'writer', role: '主笔' }, { agent: h.manager })
    assert.equal(result.role, '主笔')
    assert.deepEqual(h.calls[0], { label: 'writer', role: '主笔', actor: 'session-manager' })
  } finally { h.cleanup() }
})

test('worker lines may not set roles', async () => {
  const h = harness()
  try {
    await assert.rejects(h.registered.get('line_set_role').execute({ line: 'writer', role: 'x' }, { agent: h.worker }), (error) => error.code === 'LINE_CREATE_FORBIDDEN')
  } finally { h.cleanup() }
})
