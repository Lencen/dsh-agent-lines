import assert from 'node:assert/strict'
import test from 'node:test'
import { registerToolsForAgent } from '../lib/tools.js'

function harness({ roots = [], managerBound = true, allowCreate = false } = {}) {
  const tools = new Map()
  const calls = []
  const managerSession = { session: { id: 'session-manager' } }
  const newRoot = { session: { id: 'session-new-root' } }
  const lineDefs = new Map()
  if (managerBound) lineDefs.set(managerSession.session.id, { label: 'manager', sessionId: managerSession.session.id, role: '负责人' })
  const ctx = {
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => {} } },
    agents: { get: (id) => (id === newRoot.session.id ? newRoot : undefined), roots: () => (roots.length > 0 ? [newRoot] : []) },
  }
  const agent = Object.assign(managerSession, { ctx })
  const handoverManager = async (target, opts) => { calls.push({ target, opts }); return { line: 'manager', oldSessionId: 'session-old', newSessionId: target.session.id, already: false, retiredTitleTagged: true, retiredTitleTag: '【退役261112】' } }
  registerToolsForAgent(agent, lineDefs.get(managerSession.session.id), {
    config: { createFrom: 'manager', allowCreate, allowClaim: true },
    store: {}, lineDefs, createLine: async () => {}, moveLineWorkspace: async () => {}, retireLine: async () => {}, rebindLine: async () => {}, renameLine: async () => {}, hibernateLine: async () => {}, wakeLine: async () => {}, setRoleLine: async () => {}, initTeam: async () => {}, handoverManager,
  })
  return { tool: tools.get('line_handover_manager'), calls, managerAgent: agent, newRoot }
}

test('handover tool is registered for the manager and calls the handover callback', async () => {
  const h = harness({ roots: [{ session: { id: 'session-new-root' } }] })
  assert.ok(h.tool, 'line_handover_manager should be registered for the manager even when allowCreate=false')
  const result = await h.tool.execute({ sessionId: 'session-new-root', confirm: 'handover-manager', reason: 'test' }, { agent: h.managerAgent })
  assert.equal(result.retiredTitleTagged, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].target.session.id, 'session-new-root')
})

test('handover tool requires the exact confirmation', async () => {
  const h = harness({ roots: [{ session: { id: 'session-new-root' } }] })
  await assert.rejects(() => h.tool.execute({ sessionId: 'session-new-root', confirm: 'yes' }, { agent: h.managerAgent }), /handover-manager/)
  assert.equal(h.calls.length, 0)
})

test('handover tool rejects non-root and non-live targets', async () => {
  const h = harness({ roots: [] })
  await assert.rejects(() => h.tool.execute({ sessionId: 'missing', confirm: 'handover-manager' }, { agent: h.managerAgent }), /not live/)
  await assert.rejects(() => h.tool.execute({ sessionId: 'session-new-root', confirm: 'handover-manager' }, { agent: h.managerAgent }), /not live|root/)
})
