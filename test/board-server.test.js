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
