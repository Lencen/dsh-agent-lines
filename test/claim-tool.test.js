import assert from 'node:assert/strict'
import test from 'node:test'
import { registerClaimTool } from '../lib/tools.js'

function harness({ allowClaim = true, roots = [], lineDefs = new Map() } = {}) {
  let registered
  const ctx = {
    tools: { register: (tool) => { registered = tool; return () => {} } },
    agents: { roots: () => roots },
  }
  const rebinds = []
  const rebindManager = async (agent) => {
    rebinds.push(agent.session.id)
    return { label: 'manager', sessionId: agent.session.id, oldSessionId: 'session-old', retiredTitleTagged: true, retiredTitleTag: '【退役261112】' }
  }
  registerClaimTool(ctx, { config: { allowClaim, createFrom: 'manager' }, lineDefs, rebindManager })
  return { tool: registered, rebinds }
}

const agent = { session: { id: 'session-new' } }

test('claim tool binds an unbound root and requires confirm', async () => {
  const h = harness({ roots: [agent] })
  await assert.rejects(() => h.tool.execute({ confirm: 'yes' }, { agent }), /bind-manager/)
  const result = await h.tool.execute({ confirm: 'bind-manager' }, { agent })
  assert.deepEqual(result, { line: 'manager', sessionId: 'session-new', claimed: true, already: false, oldSessionId: 'session-old', retiredTitleTagged: true, retiredTitleTag: '【退役261112】' })
  assert.deepEqual(h.rebinds, ['session-new'])
})

test('claim tool rejects non-root and worker-bound sessions', async () => {
  const h = harness({ roots: [] })
  await assert.rejects(() => h.tool.execute({ confirm: 'bind-manager' }, { agent }), /root/)
  const defs = new Map([['session-new', { label: 'worker', sessionId: 'session-new' }]])
  const w = harness({ roots: [agent], lineDefs: defs })
  await assert.rejects(() => w.tool.execute({ confirm: 'bind-manager' }, { agent }), /already bound/)
})

test('claim tool is a no-op for the current manager', async () => {
  const defs = new Map([['session-new', { label: 'manager', sessionId: 'session-new' }]])
  const h = harness({ roots: [agent], lineDefs: defs })
  const result = await h.tool.execute({ confirm: 'bind-manager' }, { agent })
  assert.equal(result.already, true)
  assert.equal(result.claimed, false)
  assert.equal(result.oldSessionId, null)
  assert.equal(result.retiredTitleTagged, false)
  assert.deepEqual(h.rebinds, [])
})
