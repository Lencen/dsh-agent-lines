import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBoardServer } from '../lib/board-server.js'
import { LineStore } from '../lib/store.js'

test('board server serves snapshots read-only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-'))
  writeFileSync(join(dir, 'team-board.json'), JSON.stringify({ schemaVersion: 1, available: true, tasks: [{ id: 't1', subject: 'x' }], lines: [{ label: 'writer', status: 'online' }] }))
  writeFileSync(join(dir, 'team-metrics.json'), JSON.stringify({ schemaVersion: 1, tasks: { manager: { total: 1 } }, sessions: { lines: 1, officialMembers: 0 }, messages: { total: 1 }, tokens: { total: 0 } }))
  writeFileSync(join(dir, 'team-board.writer.json'), JSON.stringify({ schemaVersion: 1, available: true, line: 'writer', tasks: [] }))
  const { server, url } = await startBoardServer({ dir, host: '127.0.0.1', port: 0 })
  try {
    const html = await fetch(url)
    assert.equal(html.status, 200)
    assert.match(await html.text(), /团队看板/)
    const vendor = await fetch(new URL('/vendor/echarts.min.js', url)); assert.equal(vendor.status, 200); assert.match(vendor.headers.get('content-type')||'', /javascript/)
    const board = await fetch(new URL('/api/team-board', url))
    assert.equal(board.status, 200)
    assert.equal((await board.json()).tasks[0].id, 't1')
    const metrics = await fetch(new URL('/api/team-metrics', url))
    assert.equal(metrics.status, 200)
    assert.equal((await metrics.json()).tasks.manager.total, 1)
    const dept = await fetch(new URL('/api/team-board/writer', url))
    assert.equal(dept.status, 200)
    assert.equal((await dept.json()).line, 'writer')
    const missing = await fetch(new URL('/api/team-board/reviewer', url))
    assert.equal(missing.status, 404)
    const post = await fetch(url, { method: 'POST' })
    assert.equal(post.status, 405)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
test('board server /api/live reads lines.db read-only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-live-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'hello' })
  store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w2', reason: 'context full', migrate: 'queued' })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    const live = await fetch(new URL('/api/live', url))
    assert.equal(live.status, 200)
    const payload = await live.json()
    assert.equal(payload.available, true)
    assert.equal(payload.schemaVersion, 1)
    assert.deepEqual(payload.lines.map(line => line.label).sort(), ['manager', 'writer'])
    assert.equal(payload.messages.total, 1)
    assert.ok(Array.isArray(payload.messages.trend))
    const etag = live.headers.get('etag')
    assert.ok(etag)
    const cached = await fetch(new URL('/api/live', url), { headers: { 'if-none-match': etag } })
    assert.equal(cached.status, 304)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('board server /api/live reports unavailable without a db', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-nodb-'))
  const { server, url } = await startBoardServer({ dir, host: '127.0.0.1', port: 0 })
  try {
    const live = await fetch(new URL('/api/live', url))
    assert.equal(live.status, 503)
    assert.equal((await live.json()).available, false)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
test('board server /api/live exposes teamGoal and decisions from teamRoot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-goal-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.close()
  const teamRoot = join(dir, 'team')
  mkdirSync(join(teamRoot, 'decisions'), { recursive: true })
  writeFileSync(join(teamRoot, 'TEAM.md'), ['# 团队目标','','## 团队目标','完成小说','## 简介','小说团','## 规划','本月完本','## 计划节奏','日更2章'].join(String.fromCharCode(10)))
  writeFileSync(join(teamRoot, 'decisions/d1.md'), ['# 发布许可','','## 来源类型','任务','## 背景','终审完成','## 决策建议','同意发布'].join(String.fromCharCode(10)))
  const { server, url } = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0 })
  try {
    const live = await fetch(new URL('/api/live', url))
    assert.equal(live.status, 200)
    const payload = await live.json()
    assert.equal(payload.teamGoal.objective, '完成小说')
    assert.equal(payload.decisions.length, 1)
    assert.equal(payload.decisions[0].id, 'd1')
    assert.equal(payload.decisions[0].suggestion, '同意发布')
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})


test('board server resolves a parent teamRoot to the newest child team', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-parent-'))
  const parent = join(dir, 'teams')
  mkdirSync(join(parent, 'alpha'), { recursive: true })
  writeFileSync(join(parent, 'alpha', 'TEAM.md'), ['# 团队目标','','## 团队目标','写小说','## 简介','小说团','## 规划','分卷','## 计划节奏','日更','## 协作流程','设定 → 大纲 → 初稿'].join(String.fromCharCode(10)))
  writeFileSync(join(parent, 'alpha', 'registry.json'), JSON.stringify({ version: 1, lines: [] }))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, teamRoot: parent, host: '127.0.0.1', port: 0 })
  try {
    const live = await (await fetch(new URL('/api/live', url))).json()
    assert.equal(live.teamName, 'alpha')
    assert.equal(live.teamGoal.objective, '写小说')
    assert.equal(live.teamGoal.workflow, '设定 → 大纲 → 初稿')
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('P1-01 /api/live exposes rebinds and counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-rebind-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w1', instanceId: 'i-w', ttlMs: 60000 })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'hello' })
  store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w2', reason: 'context full', migrate: 'queued' })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    const payload = await (await fetch(new URL('/api/live', url))).json()
    const writer = payload.lines.find(line => line.label === 'writer')
    assert.equal(writer.oldSessionId, 's-w1')
    assert.equal(writer.rebinds.length, 1)
    assert.equal(writer.rebinds[0].from, 's-w1')
    assert.equal(writer.rebinds[0].to, 's-w2')
    assert.equal(writer.rebinds[0].reason, 'context full')
    assert.equal(payload.messages.counts.queued, 1)
    assert.equal(payload.counts.queued, 1)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

test('P1-04 team-board snapshot shapes are normalized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-shape-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    writeFileSync(join(dir, 'team-board.json'), JSON.stringify({ available: true, tasks: { 'task-1': { id: 'task-1', subject: 'x', status: 'completed' } } }))
    let payload = await (await fetch(new URL('/api/team-board', url))).json()
    assert.equal(payload.tasksShape, 'object')
    assert.equal(payload.tasks.length, 1)
    writeFileSync(join(dir, 'team-board.json'), JSON.stringify({ available: true, tasks: 5 }))
    payload = await (await fetch(new URL('/api/team-board', url))).json()
    assert.equal(payload.tasksShape, 'count')
    assert.equal(payload.tasks.length, 0)
    assert.match(payload.tasksDiagnostic, /缺少任务明细/)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

test('P1-01 rebind history is capped at 10 per line (single SQL window)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-rebindcap-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-0', instanceId: 'i', ttlMs: 60000 })
  for (let i = 1; i <= 12; i++) store.rebind({ agentId: 'agent-demo', line: 'writer', sessionId: 's-' + i, reason: 'r' + i, migrate: 'queued' })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    const payload = await (await fetch(new URL('/api/live', url))).json()
    const writer = payload.lines.find(line => line.label === 'writer')
    assert.equal(writer.rebinds.length, 10)
    assert.equal(writer.oldSessionId, 's-11')
    assert.equal(writer.rebinds[0].from, 's-11')
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

test('0.11.3 /api/live exposes lineTasks and no stale tokens field', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-linetasks-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: '写第 1 章', kind: 'task', taskRef: 'T-1' })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: '普通消息' })
  store.close()
  const { server, url } = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    const payload = await (await fetch(new URL('/api/live', url))).json()
    assert.equal(payload.tokens, undefined)
    assert.equal(payload.lineTasks.available, true)
    assert.equal(payload.lineTasks.total, 1)
    assert.equal(payload.lineTasks.byLine[0].line, 'writer')
    assert.equal(payload.lineTasks.recent[0].taskRef, 'T-1')
    assert.match(payload.lineTasks.recent[0].summary, /写第 1 章/)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

test('0.11.3 board reads team-root sidecar when --team-root is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-sidecar-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath); store.close()
  writeFileSync(join(dir, 'TEAM.md'), '# 团队\n\n## 目标\n- 测试团队侧车\n')
  writeFileSync(join(dir, 'team-root'), dir + '\n')
  const started = await startBoardServer({ dir, dbPath, host: '127.0.0.1', port: 0 })
  try {
    assert.equal(started.teamRoot, dir)
    const payload = await (await fetch(new URL('/api/live', started.url))).json()
    assert.equal(payload.teamName, dir.split('/').pop())
  } finally { await new Promise(resolve => started.server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})
