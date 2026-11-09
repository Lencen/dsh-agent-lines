import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { LineStore } from '../lib/store.js'

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
    get: (name) => name === 'sessionPersistence' ? { stat: async () => ({}) } : name === 'sessionProjections' ? { snapshot: () => ({ values: { sessionStats: { turns: 2, steps: 20, decodeTokens: 30 } } }) } : undefined,
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
    const check = new LineStore(h.config.dbPath)
    try {
      const row = check.listLines().find(line => line.label === 'writer')
      assert.ok(row, 'replaced line row')
      assert.ok(row.lease && row.lease.live, 'F1: replaced line must acquire a live lease')
      assert.equal(row.session_id, replaced.sessionId)
    } finally { check.close() }

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
    assert.equal(status.lines.find(line => line.label === 'writer').activity.level, 'medium')
    assert.equal(status.lines.find(line => line.label === 'writer').activity.steps, 20)
  } finally { h.cleanup() }
})
test('line_observe is manager-only read-only feed', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', bootstrap: false }, exec(h.manager))
    await h.tools.get('line_send').execute({ to: 'writer', text: 'cross line' }, exec(h.manager))
    const feed = await h.tools.get('line_observe').execute({ limit: 10 }, exec(h.manager))
    assert.equal(feed.count, 1)
    assert.equal(feed.messages[0].to, 'agent-demo#writer')
    assert.equal(feed.messages[0].summary, 'cross line')
    const workerAgent = h.agents.get(created.sessionId)
    await assert.rejects(() => h.tools.get('line_observe').execute({}, exec(workerAgent)), error => error.code === 'LINE_CREATE_FORBIDDEN')
  } finally { h.cleanup() }
})
test('worker task waits for manager approval', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', bootstrap: false }, exec(h.manager))
    const worker = h.agents.get(created.sessionId)
    const sent = await h.tools.get('line_send').execute({ to: 'manager', text: '请批准这个任务', kind: 'task' }, exec(worker))
    assert.equal(sent.requiresApproval, true)
    assert.equal(sent.state, 'pending_approval')
    const feed = await h.tools.get('line_observe').execute({ limit: 10 }, exec(h.manager))
    assert.equal(feed.messages[0].approvalState, 'pending')
    const ack = await h.tools.get('line_manager_ack').execute({ messageId: sent.id, decision: 'approve' }, exec(h.manager))
    assert.equal(ack.state, 'queued')
    const after = await h.tools.get('line_observe').execute({ limit: 10 }, exec(h.manager))
    assert.equal(after.messages[0].state, 'queued')
  } finally { h.cleanup() }
})
test('line_team_board auto-reads Agent Teams and maps owner by line label', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', bootstrap: false }, exec(h.manager))
    const originalGet = h.ctx.get
    h.ctx.get = (name, strict) => name === 'agentTeams' ? {
      tryMembership: () => ({ role: 'lead' }),
      listMembers: () => [{ name: 'manager', role: 'lead', status: 'running' }, { name: 'writer', role: 'teammate', status: 'running' }],
      listTasks: () => [{ id: 'task-1', revision: 1, subject: 'ch1', description: '', status: 'pending', blockedBy: [], writeScopes: [], ownerName: 'writer', ready: true, writeScopeWarnings: [] }],
    } : originalGet(name, strict)
    const sent = await h.tools.get('line_send').execute({ to: 'writer', text: '请写 ch1', taskRef: 'task-1' }, exec(h.manager))
    assert.equal(sent.taskRef, 'task-1')
    const board = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    assert.equal(board.available, true)
    assert.equal(board.tasks[0].lastMessage.id, sent.id)
    assert.equal(board.tasks[0].lastMessage.summary, '请写 ch1')
    assert.equal(board.tasks[0].ownerName, 'writer')
    assert.equal(board.tasks[0].ownerLine, 'writer')
    assert.equal(board.tasks[0].staleOwner, false)
    assert.ok(board.lines.some(line => line.label === 'writer' && line.sessionId === created.sessionId))
    const worker = h.agents.get(created.sessionId)
    await assert.rejects(() => h.tools.get('line_team_board').execute({}, exec(worker)), error => error.code === 'LINE_CREATE_FORBIDDEN')
  } finally { h.cleanup() }
})

test('line_team_board reports unavailable without Agent Teams service', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const board = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    assert.equal(board.available, false)
    assert.match(board.reason, /not mounted/)
    assert.deepEqual(board.tasks, [])
  } finally { h.cleanup() }
})