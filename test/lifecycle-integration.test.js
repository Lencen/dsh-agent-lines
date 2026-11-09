import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-int-'))
  const dbPath = join(dir, 'lines.db')
  const agents = new Map()
  const tools = new Map()
  const effects = []
  const renamed = []
  let nextSession = 0
  const makeAgent = (id) => ({ session: { id, header: { cwd: dir } }, ctx: undefined })
  const manager = makeAgent('session-m')
  agents.set('session-m', manager)
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    agents: { get: (id) => agents.get(id), list: () => [...agents.values()], roots: () => [...agents.values()] },
    sessionController: {
      create: async () => { const id = 'session-new-' + (++nextSession); const a = makeAgent(id); a.ctx = ctx; agents.set(id, a); return { sessionId: id } },
      rename: async (input) => { renamed.push(input) },
      prompt: async () => {},
    },
    on: () => () => {},
    get: (name) => name === 'sessionPersistence' ? { stat: async () => ({}) } : undefined,
    effect: (fn) => { effects.push(fn()) },
  }
  for (const a of agents.values()) a.ctx = ctx
  const config = {
    agentId: 'agent-demo', dbPath, lines: [{ label: 'manager', sessionId: 'session-m', role: 'manager' }],
    createFrom: 'manager', allowCreate: true, allowClaim: true, bootstrapOnCreate: false,
    pollMs: 1000, leaseTtlMs: 30000, dedupeWindowMs: 0,
  }
  return { dir, ctx, agents, tools, effects, renamed, manager, config, cleanup: () => { for (const e of effects.reverse()) e(); rmSync(dir, { recursive: true, force: true }) } }
}

const exec = (agent) => ({ agent })

test('line_create title, replace, retire and rename lifecycle', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    assert.ok(h.tools.has('line_create'))
    assert.ok(h.tools.has('line_retire'))
    assert.ok(h.tools.has('line_rebind'))
    assert.ok(h.tools.has('line_rename'))

    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', title: '写手 · 正文', bootstrap: false }, exec(h.manager))
    assert.equal(created.created, true)
    assert.equal(created.title, '写手 · 正文')
    assert.equal(created.lifecycle, 'active')

    const oldSession = created.sessionId
    const newAgent = h.agents.get(oldSession)
    assert.ok(newAgent)

    const replaced = await h.tools.get('line_create').execute({ label: 'writer', replace: true, force: true, reason: 'context full', bootstrap: false }, exec(h.manager))
    assert.equal(replaced.replaced, true)
    assert.equal(replaced.oldSessionId, oldSession)
    assert.notEqual(replaced.sessionId, oldSession)
    assert.equal(replaced.counts.queued, 0)

    const renamed = await h.tools.get('line_rename').execute({ line: 'writer', title: '写手 · 新' }, exec(h.manager))
    assert.equal(renamed.title, '写手 · 新')
    assert.ok(h.renamed.some(row => row.sessionId === replaced.sessionId && row.title === '写手 · 新'))

    const retired = await h.tools.get('line_retire').execute({ line: 'writer', reason: 'done' }, exec(h.manager))
    assert.equal(retired.lifecycle, 'retired')
    await assert.rejects(() => h.tools.get('line_send').execute({ to: 'writer', text: 'x' }, exec(h.manager)), error => error.code === 'LINE_RETIRED')
  } finally { h.cleanup() }
})

test('line_rebind switches to a live Session and rejects manager line', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', bootstrap: false }, exec(h.manager))
    const newId = 'session-rebind-target'
    const target = { session: { id: newId, header: { cwd: h.dir } }, ctx: h.ctx }
    h.agents.set(newId, target)
    const rebound = await h.tools.get('line_rebind').execute({ line: 'writer', sessionId: newId, reason: 'context full' }, exec(h.manager))
    assert.equal(rebound.oldSessionId, created.sessionId)
    assert.equal(rebound.newSessionId, newId)
    assert.equal(rebound.generation, 2)
    await assert.rejects(() => h.tools.get('line_rebind').execute({ line: 'manager', sessionId: newId }, exec(h.manager)), error => error.code === 'LINE_MANAGER_REBIND_UNSUPPORTED')
  } finally { h.cleanup() }
})
test('line_handoff snapshots backlog and markdown', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', title: '写手', bootstrap: false }, exec(h.manager))
    await h.tools.get('line_send').execute({ to: 'writer', text: 'todo for writer' }, exec(h.manager))
    const snap = await h.tools.get('line_handoff').execute({ line: 'writer', format: 'json' }, exec(h.manager))
    assert.equal(snap.label, 'writer')
    assert.equal(snap.counts.queued, 1)
    assert.equal(snap.sessionId, created.sessionId)
    const md = await h.tools.get('line_handoff').execute({ line: 'writer', format: 'md' }, exec(h.manager))
    assert.match(md.markdown, /交接单/)
    assert.match(md.markdown, /queued: 1/)
    const status = await h.tools.get('line_status').execute({}, exec(h.manager))
    assert.equal(status.lines.find(line => line.label === 'writer').lifecycle, 'active')
    assert.equal(status.lines.find(line => line.label === 'writer').title, '写手')
  } finally { h.cleanup() }
})
