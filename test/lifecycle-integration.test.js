import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    const sent = await h.tools.get('line_send').execute({ to: 'writer', text: '请写 ch1', taskRef: 'task-1', parentTaskRef: 'parent-1', taskScope: 'writer', subteamPolicy: 'ask', maxMembers: 2 }, exec(h.manager))
    assert.equal(sent.taskRef, 'task-1')
    const board = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    assert.equal(board.available, true)
    assert.equal(board.tasks[0].lastMessage, null)
    assert.equal(board.tasks[0].parentTaskId, null)
    assert.equal(board.tasks[0].ownerName, 'writer')
    assert.equal(board.tasks[0].ownerLine, 'writer')
    assert.equal(board.tasks[0].staleOwner, false)
    assert.ok(board.lines.some(line => line.label === 'writer' && line.sessionId === created.sessionId))
    const replaced = await h.tools.get('line_create').execute({ label: 'writer', replace: true, force: true, bootstrap: false }, exec(h.manager))
    const stale = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    assert.equal(stale.tasks[0].staleOwner, true)
    assert.equal(stale.tasks[0].staleReason, 'line replaced/rebuilt')
    assert.equal(stale.tasks[0].ownerLine, 'writer')
    const writerLine = stale.lines.find(line => line.label === 'writer')
    assert.equal(writerLine.officialTeamAvailable, true)
    assert.equal(writerLine.officialTeamLead, true)
    assert.equal(writerLine.deptSummary.total, 1)
    assert.equal(writerLine.subteamPolicy, 'ask')
    assert.equal(writerLine.maxMembers, 2)
    const dept = await h.tools.get('line_department_board').execute({ line: 'writer' }, exec(h.manager))
    assert.equal(dept.available, true)
    assert.equal(dept.tasks[0].id, 'task-1')
    assert.equal(dept.tasks[0].ownerName, 'writer')
    assert.equal(dept.tasks[0].parentTaskId, 'parent-1')
    assert.equal(dept.messages[0].id, sent.id)
    assert.equal(dept.tasks[0].subteamPolicy, 'ask')
    assert.equal(dept.tasks[0].maxMembers, 2)
    assert.equal(dept.subteamAudit.policies[0], 'ask')
    assert.equal(dept.subteamAudit.maxMembers, 2)
    assert.equal(dept.subteamAudit.overLimit, false)
    const comm = await h.tools.get('line_communications').execute({ line: 'writer', taskRef: 'task-1' }, exec(h.manager))
    assert.equal(comm.schemaVersion, 1)
    assert.ok(comm.messages.length >= 1)
    assert.equal(comm.messages[0].taskRef, 'task-1')
    const metrics = await h.tools.get('line_metrics').execute({}, exec(h.manager))
    assert.equal(metrics.schemaVersion, 1)
    assert.ok(metrics.tasks.byLine.some(line => line.line === 'writer'))
    assert.ok(metrics.messages.total >= 1)
    assert.ok(Array.isArray(metrics.messages.trend))
    assert.ok(metrics.tokens.total >= 0)
    const writerAgent = h.agents.get(replaced.sessionId)
    const reply = await h.tools.get('line_send').execute({ to: 'manager', text: '已完成 ch1', taskRef: 'task-1', taskScope: 'writer' }, exec(writerAgent))
    const stale2 = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    assert.equal(stale2.tasks[0].lastMessage, null)
    const dept2 = await h.tools.get('line_department_board').execute({ line: 'writer' }, exec(h.manager))
    assert.equal(dept2.messages[0].id, reply.id)
    assert.ok(Array.isArray(dept.messages))
    assert.equal(existsSync(join(dirname(h.config.dbPath), 'team-board.writer.json')), true)
    const snapshotPath = join(dirname(h.config.dbPath), 'team-board.json')
    assert.equal(existsSync(snapshotPath), true)
    assert.equal(statSync(snapshotPath).mode & 0o777, 0o600)
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    assert.equal(snapshot.available, true)
    assert.ok(Array.isArray(snapshot.messages))
    assert.ok(Array.isArray(snapshot.quality))
    assert.ok(snapshot.team && snapshot.team.managerLine)
    assert.equal(snapshot.schemaVersion, 1)
    const worker = h.agents.get(replaced.sessionId)
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
test('line_create replace on a hibernating line fails fast without creating a Session (V1)', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'sleeper', bootstrap: false }, exec(h.manager))
    assert.equal(created.created, true)
    await h.tools.get('line_hibernate').execute({ line: 'sleeper' }, exec(h.manager))
    const sessionsBefore = h.agents.size
    await assert.rejects(
      h.tools.get('line_create').execute({ label: 'sleeper', replace: true, force: true, bootstrap: false }, exec(h.manager)),
      (error) => {
        assert.equal(error.code, 'LINE_HIBERNATING')
        assert.equal(error.detail.line, 'sleeper')
        return true
      },
    )
    assert.equal(h.agents.size, sessionsBefore, 'no orphan Session may be created for a failed replace')
  } finally { h.cleanup() }
})

test('line_hibernate refuses a line that is rebinding (V7)', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'busy', bootstrap: false }, exec(h.manager))
    assert.equal(created.created, true)
    const store = new LineStore(h.config.dbPath)
    try { store.setLifecycle({ agentId: 'agent-demo', line: 'busy', lifecycle: 'rebinding', reason: 'test' }) } finally { store.close() }
    await assert.rejects(
      h.tools.get('line_hibernate').execute({ line: 'busy' }, exec(h.manager)),
      (error) => error.code === 'LINE_REBIND_BUSY',
    )
  } finally { h.cleanup() }
})

test('line_init_team treats teamRoot as parent when teamName is also given', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const parent = join(h.dir, 'teams')
    const res = await h.tools.get('line_init_team').execute({ teamRoot: parent, teamName: 'family-test' }, exec(h.manager))
    assert.equal(res.teamName, 'family-test')
    assert.ok(existsSync(join(parent, 'family-test', 'TEAM.md')), 'TEAM.md nested under parent/teamName')
    assert.ok(existsSync(join(parent, 'family-test', 'charters', 'manager.md')))
    assert.ok(!existsSync(join(parent, 'TEAM.md')), 'no flat TEAM.md at parent root')
  } finally { h.cleanup() }
})

test('line_create batch creates multiple lines and reports skipped/failed', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const first = await h.tools.get('line_create').execute({ lines: [{ label: 'batch-a', role: '开发' }, { label: 'batch-b' }], bootstrap: false }, exec(h.manager))
    assert.equal(first.batch, true)
    assert.equal(first.counts.created, 2)
    assert.equal(first.counts.failed, 0)
    assert.ok(first.created.every(row => row.created === true && row.sessionId))
    const again = await h.tools.get('line_create').execute({ lines: [{ label: 'batch-a' }, { label: 'batch-c' }], bootstrap: false }, exec(h.manager))
    assert.equal(again.counts.created, 1)
    assert.equal(again.counts.skipped, 1)
    const bad = await h.tools.get('line_create').execute({ lines: [{ label: 'bad label' }], bootstrap: false }, exec(h.manager))
    assert.equal(bad.counts.failed, 1)
    assert.ok(bad.failed[0].code)
    await assert.rejects(() => h.tools.get('line_create').execute({ label: 'x', lines: [{ label: 'y' }] }, exec(h.manager)), error => error.code === 'LINE_INVALID_ARGUMENT')
  } finally { h.cleanup() }
})

test('line_create batch replace output is lossless JSON', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    await h.tools.get('line_create').execute({ lines: [{ label: 'rb1', role: '开发' }], bootstrap: false }, exec(h.manager))
    const out = await h.tools.get('line_create').execute({ lines: [{ label: 'rb1', role: '开发', title: '开发' }], replace: true, force: true, migrate: 'none', bootstrap: false }, exec(h.manager))
    assert.equal(out.counts.created, 1)
    assert.equal(out.created[0].replaced, true)
    assert.equal(out.created[0].lifecycle, null)
    const round = JSON.parse(JSON.stringify(out))
    assert.deepEqual(round, out)
    const walk = (value, path) => { if (value === undefined) throw new Error('undefined at ' + path); if (value !== null && typeof value === 'object') for (const key of Object.keys(value)) walk(value[key], path + '.' + key) }
    walk(out, 'root')
  } finally { h.cleanup() }
})

test('line_create always bootstraps visible lines; per-call bootstrap:false is ignored', async () => {
  const h = harness()
  try {
    h.config.bootstrapOnCreate = true
    await apply(h.ctx, h.config)
    const out = await h.tools.get('line_create').execute({ label: 'vis1', role: '可见线', bootstrap: false }, exec(h.manager))
    assert.equal(out.bootstrapForced, true)
    assert.equal(out.bootstrapQueued, true)
    assert.equal(out.visibleInSidebar, false) // harness has no sessionListMetadata projection
    const check = new LineStore(h.config.dbPath)
    try {
      const queued = check.messageCounts({ agentId: 'agent-demo', line: 'vis1' })
      assert.equal(queued.queued + queued.claimed >= 1, true)
    } finally { check.close() }
  } finally { h.cleanup() }
})

test('line_init_team defaults to the manager cwd when teamRoot is not configured', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const res = await h.tools.get('line_init_team').execute({ teamName: 'cwd-team' }, exec(h.manager))
    assert.equal(res.teamName, 'cwd-team')
    assert.ok(existsSync(join(h.dir, 'cwd-team', 'TEAM.md')))
    assert.ok(existsSync(join(h.dir, 'cwd-team', 'charters', 'manager.md')))
  } finally { h.cleanup() }
})

test('line_status discovers the team under the manager cwd when teamRoot is unset', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const teamDir = join(h.dir, 'video-team')
    mkdirSync(teamDir, { recursive: true })
    writeFileSync(join(teamDir, 'TEAM.md'), ['# 团队目标','','## 团队目标','短视频团队','## 简介','短视频','## 规划','周更','## 计划节奏','每周三条','## 协作流程','选题 → 脚本 → 拍摄'].join(String.fromCharCode(10)))
    writeFileSync(join(teamDir, 'registry.json'), JSON.stringify({ version: 1, lines: [] }))
    const status = await h.tools.get('line_status').execute({}, exec(h.manager))
    assert.equal(status.teamWorkspace.enabled, true)
    assert.equal(status.teamGoal.objective, '短视频团队')
  } finally { h.cleanup() }
})

test('P1-02 replace/retire retitles old Sessions with retirement stamp', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', title: '正文写手', bootstrap: false }, exec(h.manager))
    const replaced = await h.tools.get('line_create').execute({ label: 'writer', replace: true, force: true, bootstrap: false }, exec(h.manager))
    assert.equal(replaced.role, 'writer')
    const tag = h.renamed.filter(item => item.sessionId === created.sessionId).find(item => String(item.title).startsWith('【退役'))
    assert.ok(tag, 'rename called for replaced old session')
    assert.match(tag.title, /^【退役[0-9]{6}】正文写手/)
    const editor = await h.tools.get('line_create').execute({ label: 'editor', role: 'editor', bootstrap: false }, exec(h.manager))
    await h.tools.get('line_retire').execute({ line: 'editor', reason: 'test' }, exec(h.manager))
    const retireTag = h.renamed.filter(item => item.sessionId === editor.sessionId).find(item => String(item.title).startsWith('【退役'))
    assert.ok(retireTag, 'rename called for retired session')
    assert.match(retireTag.title, /^【退役[0-9]{6}】/)
  } finally { h.cleanup() }
})

test('P1-03 line_handoff accepts business sections and extra', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', title: '写手', bootstrap: false }, exec(h.manager))
    const md = await h.tools.get('line_handoff').execute({ line: 'writer', sections: { current: '第 3 章', todos: '接第 4 章', pitfalls: '不要改大纲' }, extra: '依赖：编辑器' }, exec(h.manager))
    assert.match(md.markdown, /## 5 业务交接/)
    assert.match(md.markdown, /第 3 章/)
    assert.match(md.markdown, /依赖：编辑器/)
    assert.equal(md.businessSections.current.text, '第 3 章')
    const json = await h.tools.get('line_handoff').execute({ line: 'writer', format: 'json', sections: { current: '第 4 章' } }, exec(h.manager))
    assert.equal(json.businessSections.current.text, '第 4 章')
    assert.equal(json.extra, null)
  } finally { h.cleanup() }
})

test('P3-01 TEAM.md template includes a fill hint without fake content', async () => {
  const h = harness()
  try {
    await apply(h.ctx, h.config)
    const res = await h.tools.get('line_init_team').execute({ teamName: 'tpl-team' }, exec(h.manager))
    const md = readFileSync(join(h.dir, 'tpl-team', 'TEAM.md'), 'utf8')
    assert.match(md, /填写提示/)
    assert.equal(res.teamName, 'tpl-team')
  } finally { h.cleanup() }
})
