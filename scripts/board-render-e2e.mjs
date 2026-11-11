#!/usr/bin/env node
/**
 * board-render-e2e.mjs — 0.11.2 P1-04 headless 看板回归
 * 覆盖：tasks 数组 / 对象 map / 仅计数 三种快照；任务页、组织部门摘要、错误可见、无 console 异常。
 * 用法：node scripts/board-render-e2e.mjs [--require-chrome]
 * 退出码：0 PASS / 1 FAIL / 2 环境缺失（--require-chrome 时）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { startBoardServer } from '../lib/board-server.js'

const requireChrome = process.argv.includes('--require-chrome')
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const chrome = candidates.find(existsSync)
if (!chrome) {
  console.log('BOARD_E2E: SKIP (no Chrome; release gate requires --require-chrome)')
  process.exit(requireChrome ? 2 : 0)
}

const dir = mkdtempSync(join(tmpdir(), 'agent-lines-board-e2e-'))
const teamRoot = join(dir, 'team')
mkdirSync(teamRoot, { recursive: true })
writeFileSync(join(teamRoot, 'TEAM.md'), ['# 团队目标','','## 团队目标','写一部小说','## 简介','小说团','## 规划','三卷','## 计划节奏','日更','## 协作流程','设定 → 大纲 → 初稿 → 编辑 → 校对 → 审读 → 发布'].join(String.fromCharCode(10)))
writeFileSync(join(teamRoot, 'registry.json'), JSON.stringify({ version: 1, lines: [] }))
const dbPath = join(dir, 'lines.db')
const store = new LineStore(dbPath)
const labels = ['manager','architect','outliner','writer','editor','continuity','proofreader','reviewer','archivist']
for (const label of labels) store.acquire({ agentId: 'agent-deepseek', line: label, sessionId: 'sess-' + label, instanceId: 'inst', ttlMs: 600000, role: label === 'manager' ? '负责人' : label })
store.rebind({ agentId: 'agent-deepseek', line: 'writer', sessionId: 'sess-writer-2', reason: 'e2e replace', migrate: 'queued' })
store.close()
const tasks = []
for (let i = 1; i <= 5; i++) tasks.push({ id: 'task-' + i, revision: 1, subject: '任务 ' + i, status: i === 5 ? 'in_progress' : 'completed', blockedBy: [], ownerName: i === 5 ? 'proofreader' : 'architect', ownerLine: i === 5 ? 'proofreader' : 'architect', writeScopes: [], staleOwner: false, lastMessage: null, children: [] })
const board = { schemaVersion: 1, protocolVersion: '0.4', available: true, manager: { line: 'manager', sessionId: 'sess-manager', role: 'lead' }, generatedAt: Date.now(), tasks, members: [{ name: 'manager', role: 'lead', status: 'active' }], team: { name: 'novel-studio', managerLine: 'manager' }, messages: [], deliveries: [], lines: labels.map(label => ({ label, status: 'online', lifecycle: 'active', generation: 1, officialTeamLead: label === 'proofreader', officialTeamAvailable: label === 'proofreader', deptSummary: label === 'proofreader' ? { total: 8, done: 5, inProgress: 3, blocked: 0, stale: 0 } : null, deptTasks: label === 'proofreader' ? [{ id: 'p1', subject: '校对 1', status: 'completed' }, { id: 'p2', subject: '校对 2', status: 'completed' }] : [] })), inbox: [] }
const boardPath = join(dir, 'team-board.json')
const setBoard = (value) => writeFileSync(boardPath, JSON.stringify(value))
setBoard(board)

const { server, url } = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0 })
const port = 9300 + Math.floor(Math.random() * 500)
const userData = join(dir, 'chrome-profile')
const chromeProc = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars','--window-size=1440,1000','--remote-debugging-port=' + String(port),'--user-data-dir=' + userData, 'about:blank'], { stdio: 'ignore' })
let ws
const failures = []
const check = (name, pass, detail = '') => { if (!pass) failures.push(name + (detail ? ': ' + detail : '')); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')) }
try {
  let version = null
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) { version = await r.json(); break } } catch {}
    await sleep(250)
  }
  if (!version) throw new Error('Chrome did not start')
  const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?url=about:blank', { method: 'PUT' })).json()
  ws = new WebSocket(tab.webSocketDebuggerUrl)
  const pending = new Map(); let nextId = 0; const exceptions = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    else if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg)
  }
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return result.result?.result?.value
  }
  const load = async (query) => {
    await send('Page.navigate', { url: url + '?v=' + query })
    for (let i = 0; i < 80; i++) { const ready = await evaluate('typeof DATA !== "undefined" && typeof DATA.missions !== "undefined"').catch(() => false); if (ready === true) break; await sleep(250) }
    await sleep(500)
  }

  await load('array')
  check('数组快照：任务 5 条', await evaluate('(DATA.missions||[]).length') === 5)
  check('数组快照：无渲染异常', !(await evaluate('DATA.renderError||null')))
  check('数组快照：协作流程 7 阶段', (await evaluate('(DATA.stages||[]).length')) === 7)
  check('数组快照：任务页非空', /任务 5/.test(String(await evaluate('(document.querySelector("#missions")||{}).textContent'))))
  check('数组快照：proofreader 部门摘要', (await evaluate('(DATA.lines.find(function(l){return l.id==="proofreader"})||{}).deptSummary?.total')) === 8)
  check('数组快照：部门抽屉可渲染', /部门（官方 L3）/.test(String(await evaluate('window.__deptBlock({officialTeamAvailable:true,deptSummary:{total:8,done:5,inProgress:3,blocked:0},deptTasks:[{subject:"校对 1",status:"completed"}]})'))))
  check('数组快照：历史包含换代', await evaluate('(DATA.retired||[]).some(function(r){return r.label==="writer"&&r.kind==="rebind"})') === true)
  check('数组快照：成本拆分元素存在', await evaluate('!!document.querySelector("#cost-basis")') === true)
  check('数组快照：无 console 异常', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 1)))

  const objectTasks = {}; for (const task of tasks) objectTasks[task.id] = task
  setBoard({ ...board, tasks: objectTasks })
  exceptions.length = 0
  await load('object')
  check('对象 map 快照：任务 5 条', await evaluate('(DATA.missions||[]).length') === 5)
  check('对象 map 快照：tasksShape=object', await evaluate('DATA.tasksShape') === 'object')
  check('对象 map 快照：无渲染异常', !(await evaluate('DATA.renderError||null')))
  check('对象 map 快照：无 console 异常', exceptions.length === 0)

  setBoard({ ...board, tasks: 5 })
  exceptions.length = 0
  await load('count')
  check('计数快照：tasksDiagnostic 可见', /缺少任务明细/.test(String(await evaluate('DATA.tasksDiagnostic'))))
  check('计数快照：页面提示缺少明细', /缺少任务明细/.test(String(await evaluate('(document.querySelector("#missions")||{}).textContent'))))
  check('计数快照：不伪造任务', await evaluate('(DATA.missions||[]).length') === 0)
} catch (error) {
  failures.push(String(error && error.message ? error.message : error))
  console.log('FAIL ' + String(error && error.message ? error.message : error))
} finally {
  try { ws?.close() } catch {}
  try { chromeProc.kill('SIGKILL') } catch {}
  await new Promise(resolve => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
}
console.log('')
console.log(failures.length === 0 ? 'BOARD_E2E: PASS' : 'BOARD_E2E: FAIL (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
