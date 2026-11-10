import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { LineStore } from '../lib/store.js'
import { registerToolsForAgent } from '../lib/tools.js'
import { PROTOCOL_VERSION } from '../lib/protocol.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-snap-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: true, dbPath,
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
  const service = {
    tryMembership: () => ({ role: 'lead' }),
    listMembers: () => [{ name: 'lead', role: 'lead', status: 'active' }],
    listTasks: () => [{ id: 'task-1', subject: 'demo', status: 'pending', blockedBy: [], writeScopeWarnings: [] }],
  }
  const workerAgent = { session: { id: defs.worker.sessionId }, ctx: { get: (name) => (name === 'agentTeams' ? service : undefined) } }
  const ctx = {
    tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } },
    agents: { get: (sid) => (sid === defs.worker.sessionId ? workerAgent : undefined) },
    get: (name) => (name === 'agentTeams' ? service : undefined),
    agentTeams: service,
  }
  const agent = { ctx, session: { id: defs.manager.sessionId } }
  registerToolsForAgent(agent, defs.manager, {
    config, store, lineDefs,
    createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
  })
  return { dir, dbPath, store, registered, agent, defs, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('team-board snapshot carries protocolVersion', async () => {
  const h = harness()
  try {
    const payload = await h.registered.get('line_team_board').execute({}, { agent: h.agent })
    assert.equal(payload.protocolVersion, PROTOCOL_VERSION)
    assert.equal(payload.schemaVersion, 1)
    const file = readFileSync(join(dirname(h.dbPath), 'team-board.json'), 'utf8')
    const snap = JSON.parse(file)
    assert.equal(snap.protocolVersion, PROTOCOL_VERSION)
  } finally { h.cleanup() }
})

test('per-line team-board snapshot carries protocolVersion', async () => {
  const h = harness()
  try {
    const payload = await h.registered.get('line_department_board').execute({ line: 'worker' }, { agent: h.agent })
    assert.equal(payload.protocolVersion, PROTOCOL_VERSION)
    const file = readFileSync(join(dirname(h.dbPath), 'team-board.worker.json'), 'utf8')
    const snap = JSON.parse(file)
    assert.equal(snap.protocolVersion, PROTOCOL_VERSION)
  } finally { h.cleanup() }
})

test('team-metrics snapshot carries protocolVersion', async () => {
  const h = harness()
  try {
    const payload = await h.registered.get('line_metrics').execute({ days: 7 }, { agent: h.agent })
    assert.equal(payload.protocolVersion, PROTOCOL_VERSION)
    const file = readFileSync(join(dirname(h.dbPath), 'team-metrics.json'), 'utf8')
    const snap = JSON.parse(file)
    assert.equal(snap.protocolVersion, PROTOCOL_VERSION)
  } finally { h.cleanup() }
})
