import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../lib/index.js'
import { LineStore } from '../lib/store.js'
import { startBoardServer } from '../lib/board-server.js'

function boardHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-parentref-'))
  const dbPath = join(dir, 'lines.db')
  const agents = new Map(); const tools = new Map(); const effects = []; let next = 0
  const makeAgent = (id) => ({ session: { id, header: { cwd: dir } }, ctx: undefined })
  const manager = makeAgent('session-m'); agents.set('session-m', manager)
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register: (t) => { tools.set(t.name, t); return () => tools.delete(t.name) } },
    agents: { get: (id) => agents.get(id), list: () => [...agents.values()], roots: () => [...agents.values()] },
    sessionController: { create: async () => { const id = 'session-new-' + (++next); const a = makeAgent(id); a.ctx = ctx; agents.set(id, a); return { sessionId: id } }, rename: async () => {}, prompt: async () => {} },
    on: () => () => {},
    get: (n) => n === 'sessionPersistence' ? { stat: async () => ({}) } : undefined,
    effect: (fn) => effects.push(fn()),
  }
  for (const a of agents.values()) a.ctx = ctx
  const config = { agentId: 'agent-demo', dbPath, lines: [{ label: 'manager', sessionId: 'session-m', role: 'manager' }], createFrom: 'manager', allowCreate: true, allowClaim: true, bootstrapOnCreate: false, pollMs: 1000, leaseTtlMs: 30000, dedupeWindowMs: 0 }
  return { dir, ctx, agents, tools, effects, manager, config, cleanup: () => { for (const e of effects.reverse()) e(); rmSync(dir, { recursive: true, force: true }) } }
}
const exec = (agent) => ({ agent })

test('N11: line_team_board 与 line_department_board 全局投影一致（parentTaskRef/parentTaskId/lastMessage/policy）', async () => {
  const h = boardHarness()
  try {
    await apply(h.ctx, h.config)
    const originalGet = h.ctx.get
    h.ctx.get = (name, strict) => name === 'agentTeams' ? {
      tryMembership: () => ({ role: 'lead' }),
      listMembers: () => [{ name: 'manager', role: 'lead', status: 'running' }, { name: 'writer', role: 'teammate', status: 'running' }],
      listTasks: () => [{ id: 'task-1', revision: 1, subject: 'ch1', description: '', status: 'pending', blockedBy: [], writeScopes: [], ownerName: 'writer', ready: true, writeScopeWarnings: [] }],
    } : originalGet(name, strict)
    const created = await h.tools.get('line_create').execute({ label: 'writer', role: 'writer', bootstrap: false }, exec(h.manager))
    const first = await h.tools.get('line_send').execute({ to: 'writer', text: '请写 ch1', kind: 'task', taskRef: 'task-1', parentTaskRef: 'parent-1', taskScope: 'writer', subteamPolicy: 'ask', maxMembers: 2 }, exec(h.manager))
    const writerAgent = h.agents.get(created.sessionId)
    // 后一条无 parent/无 policy 的消息（全局最新消息应成为 lastMessage，但 parent/policy 仍取最新非空）
    const second = await h.tools.get('line_send').execute({ to: 'manager', text: '已写 ch1', taskRef: 'task-1' }, exec(writerAgent))
    const main = await h.tools.get('line_team_board').execute({}, exec(h.manager))
    const dept = await h.tools.get('line_department_board').execute({ line: 'writer' }, exec(h.manager))
    for (const board of [main, dept]) {
      assert.equal(board.tasks[0].parentTaskRef, 'parent-1', 'parentTaskRef 全局最新非空')
      assert.equal(board.tasks[0].parentTaskId, 'parent-1', 'parentTaskId deprecated alias 同值')
      assert.equal(board.tasks[0].subteamPolicy, 'ask', 'policy 全局最新非空')
      assert.equal(board.tasks[0].maxMembers, 2, 'maxMembers 全局最新非空')
      assert.equal(board.tasks[0].lastMessage.id, second.id, 'lastMessage 全局最新消息')
    }
    const filtered = await h.tools.get('line_team_board').execute({ byTaskRef: 'parent-1' }, exec(h.manager))
    assert.equal(filtered.tasks.length, 1)
    assert.equal(filtered.filteredCount, 1)
    const none = await h.tools.get('line_team_board').execute({ byTaskRef: 'nope' }, exec(h.manager))
    assert.deepEqual(none.tasks, [])
    assert.equal(none.filteredCount, 0)
    // P2/D4：byTaskRef 过滤不得覆盖快照；team-board.json 与 /api/team-board 仍为全量
    const snapDir = dirname(h.config.dbPath)
    const snap = JSON.parse(readFileSync(join(snapDir, 'team-board.json'), 'utf8'))
    assert.equal(snap.tasks.length, 1, 'snapshot tasks 仍为全量')
    assert.equal(snap.filteredCount, 1, 'snapshot filteredCount 为全量')
    const { server, url } = await startBoardServer({ dir: snapDir, dbPath: h.config.dbPath, host: '127.0.0.1', port: 0 })
    try {
      const full = await (await fetch(new URL('/api/team-board', url))).json()
      assert.equal(full.tasks.length, 1, '/api/team-board 仍返回全量')
    } finally { await new Promise(resolve => server.close(resolve)) }
    assert.equal(first.taskRef, 'task-1')
  } finally { h.cleanup() }
})

test('parentTaskFor 全局最新非空 + id tie-breaker + 跨 agent 隔离', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-parentref-store-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  try {
    for (const line of ['manager', 'writer', 'renderer']) {
      store.acquire({ agentId: 'agent-a', line, sessionId: 'a-' + line, instanceId: 'i', ttlMs: 60000 })
      store.acquire({ agentId: 'agent-b', line, sessionId: 'b-' + line, instanceId: 'i', ttlMs: 60000 })
    }
    // 最新非空：晚到的 null 不得覆盖旧非空
    store.send({ agentId: 'agent-a', fromLine: 'manager', to: 'writer', text: 'p1', kind: 'task', taskRef: 'T-1', parentTaskRef: 'P-OLD', now: 1000 })
    store.send({ agentId: 'agent-a', fromLine: 'manager', to: 'writer', text: 'p2', kind: 'task', taskRef: 'T-1', now: 2000 })
    assert.equal(store.parentTaskFor({ agentId: 'agent-a', taskRef: 'T-1' }), 'P-OLD')
    // 跨 agent 隔离
    store.send({ agentId: 'agent-b', fromLine: 'manager', to: 'writer', text: 'b1', kind: 'task', taskRef: 'T-1', parentTaskRef: 'P-B', now: 3000 })
    assert.equal(store.parentTaskFor({ agentId: 'agent-a', taskRef: 'T-1' }), 'P-OLD')
    assert.equal(store.parentTaskFor({ agentId: 'agent-b', taskRef: 'T-1' }), 'P-B')
    // 同毫秒 tie：created_at 相同，取 id DESC
    store.send({ agentId: 'agent-a', fromLine: 'manager', to: 'renderer', text: 'tie-aaa', kind: 'task', taskRef: 'T-9', parentTaskRef: 'P-A', now: 5000 })
    store.send({ agentId: 'agent-a', fromLine: 'manager', to: 'renderer', text: 'tie-zzz', kind: 'task', taskRef: 'T-9', parentTaskRef: 'P-Z', now: 5000 })
    const db = new (await import('node:sqlite')).DatabaseSync(dbPath)
    db.exec("UPDATE messages SET id='aaa' WHERE body='tie-aaa'; UPDATE messages SET id='zzz' WHERE body='tie-zzz'")
    db.close()
    assert.equal(store.parentTaskFor({ agentId: 'agent-a', taskRef: 'T-9' }), 'P-Z')
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
test('不变量：schema user_version==15 与 protocolVersion==0.4 不随本实现变化', async () => {
  const { PROTOCOL_VERSION } = await import('../lib/protocol.js')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-parentref-inv-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath); store.close()
  const db = new DatabaseSync(dbPath)
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15)
    assert.equal(PROTOCOL_VERSION, '0.4')
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})
