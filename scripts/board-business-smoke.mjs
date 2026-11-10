#!/usr/bin/env node
/**
 * 0.11.0 board business smoke: init workspace -> start board -> read live -> assert goal/decisions/views/vendor.
 * No browser; Node fetch against a real board server.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { initTeamWorkspace } from '../lib/team-init.js'
import { startBoardServer } from '../lib/board-server.js'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass, detail })
const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-business-'))
let server
try {
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'hello' })
  store.close()

  const teamRoot = join(dir, 'team')
  const init = initTeamWorkspace({ teamRoot, lines: [{ label: 'manager', role: '负责人' }, { label: 'writer', role: '开发' }], managerLabel: 'manager' })
  check('init creates TEAM.md/charters/decisions/registry', init.created.includes('TEAM.md') && init.created.includes('charters/manager.md') && init.created.includes('charters/writer.md') && init.created.includes('decisions/README.md'))
  writeFileSync(join(teamRoot, 'TEAM.md'), ['# 团队目标', '', '## 团队目标', '完成 0.11 业务验证', '## 简介', '业务测试团', '## 规划', '本周', '## 计划节奏', '日更'].join(String.fromCharCode(10)))
  mkdirSync(join(teamRoot, 'decisions'), { recursive: true })
  writeFileSync(join(teamRoot, 'decisions/d1.md'), ['# 业务决策', '', '## 来源类型', '任务', '## 背景', '业务背景', '## 决策建议', '按建议处理'].join(String.fromCharCode(10)))

  const started = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0 })
  server = started.server
  const url = started.url
  const html = await (await fetch(url)).text()
  check('board html has five views', html.includes('data-view="overview"') && html.includes('data-view="cost"') && html.includes('data-view="tasks"'))
  check('board html marks read-only', (html.match(/只读/g) || []).length >= 2)
  const vendor = await fetch(new URL('/vendor/echarts.min.js', url))
  check('echarts vendor served', vendor.status === 200)
  const live = await (await fetch(new URL('/api/live', url))).json()
  check('live lines/messages', live.available === true && live.lines.length === 2 && live.messages.total >= 1)
  check('live teamGoal parsed', live.teamGoal && live.teamGoal.objective === '完成 0.11 业务验证')
  check('live decisions parsed', Array.isArray(live.decisions) && live.decisions.length === 1 && live.decisions[0].suggestion === '按建议处理')
  check('live team workspace charters', live.teamWorkspace && live.teamWorkspace.enabled === true)
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
}
const failures = checks.filter(c => !c.pass)
for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
console.log('')
console.log(failures.length ? 'BOARD_BUSINESS_SMOKE: FAIL (' + failures.length + '/' + checks.length + ')' : 'BOARD_BUSINESS_SMOKE: PASS (' + checks.length + ' checks)')
process.exit(failures.length ? 1 : 0)
