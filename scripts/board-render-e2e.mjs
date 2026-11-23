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
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)
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
store.send({ agentId: 'agent-deepseek', fromLine: 'manager', to: 'writer', text: 'e2e 线层任务：写第一章', kind: 'task', taskRef: 'T-E2E' })
store.close()
const tasks = []
for (let i = 1; i <= 5; i++) tasks.push({ id: 'task-' + i, revision: 1, subject: '任务 ' + i, status: i === 5 ? 'in_progress' : 'completed', blockedBy: [], ownerName: i === 5 ? 'proofreader' : 'architect', ownerLine: i === 5 ? 'proofreader' : 'architect', writeScopes: [], staleOwner: false, lastMessage: null, children: [] })
const board = { schemaVersion: 1, protocolVersion: '0.4', available: true, manager: { line: 'manager', sessionId: 'sess-manager', role: 'lead' }, generatedAt: Date.now(), tasks, members: [{ name: 'manager', role: 'lead', status: 'active' }], team: { name: 'novel-studio', managerLine: 'manager' }, messages: [], deliveries: [], lines: labels.map(label => ({ label, status: 'online', lifecycle: 'active', generation: 1, officialTeamLead: label === 'proofreader', officialTeamAvailable: label === 'proofreader', deptSummary: label === 'proofreader' ? { total: 8, done: 5, inProgress: 3, blocked: 0, stale: 0 } : null, deptTasks: label === 'proofreader' ? [{ id: 'p1', subject: '校对 1', status: 'completed' }, { id: 'p2', subject: '校对 2', status: 'completed' }] : [] })), inbox: [] }
const boardPath = join(dir, 'team-board.json')
const setBoard = (value) => writeFileSync(boardPath, JSON.stringify(value))
setBoard(board)

// 0.12.0 legacy 回归：显式 board2:false（新壳断言在 0.13 S11 单独加）
const { server, url } = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0, board2: false })
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
  check('线层任务 tab 存在', await evaluate('!!document.querySelector("#tab-line-tasks")') === true)
  await evaluate('document.querySelector("#tab-line-tasks").click(), true')
  check('线层任务视图可见', await evaluate('!document.querySelector("#line-tasks-list").classList.contains("hidden")') === true)
  check('线层任务内容可见', /写第一章/.test(String(await evaluate('document.querySelector("#line-tasks-list").textContent'))))
  check('只读原因链接存在', await evaluate('!!document.querySelector("footer a[href*=SECURITY]")') === true)
  await evaluate('document.querySelector("#tab-active").click(), true')

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
  // 0.14 S2：board2 总览 runtime 区（DOM 级：元素存在 + 非空或显式未采集）
  const b2 = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0, board2: true })
  try {
    await send('Page.navigate', { url: b2.url + '?view=overview' })
    let ready = false
    for (let i = 0; i < 100; i++) { ready = await evaluate('!!(document.querySelector("#bd-ov-kpi") && document.querySelector("#bd-ov-kpi").children.length)').catch(() => false); if (ready) break; await sleep(200) }
    check('board2 runtime：KPI 4 卡', await evaluate('document.querySelectorAll("#bd-ov-kpi .bd-kpi").length') === 4)
    check('board2 runtime：线卡非空', (await evaluate('document.querySelectorAll("#bd-ov-lines .bd-ov-line-card").length')) >= 1)
    check('board2 runtime：线卡 owner+在线 badge', /owner/.test(String(await evaluate('(document.querySelector("#bd-ov-lines .bd-ov-line-owner")||{}).textContent||""'))) && /在线|离线/.test(String(await evaluate('(document.querySelector("#bd-ov-lines .bd-ov-badges .bd-badge")||{}).textContent||""'))))
    check('board2 runtime：决策卡非空或显式未采集', /未采集|暂无待决策|查看/.test(String(await evaluate('(document.querySelector("#bd-ov-decisions")||{}).textContent'))))
    check('board2 runtime：交接卡非空或显式未采集', /未采集|暂无交接|交接/.test(String(await evaluate('(document.querySelector("#bd-ov-deliveries")||{}).textContent'))))
    check('board2 runtime：异常卡非空或显式未采集', /未采集|暂无异常|failed|blocked|expired/.test(String(await evaluate('(document.querySelector("#bd-ov-alerts")||{}).textContent'))))
    check('board2 runtime：成本摘要非空或显式未采集', /未采集|今日|快照/.test(String(await evaluate('(document.querySelector("#bd-ov-cost-body")||{}).textContent'))))
    check('board2 runtime：source line 非空', String(await evaluate('(document.querySelector("#bd-ov-source")||{}).textContent||""')).length > 10)
    check('board2 runtime：无显示加载中', !/加载中/.test(String(await evaluate('document.body.innerText'))))
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    check('board2 runtime：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await send('Emulation.clearDeviceMetricsOverride')
    await send('Page.navigate', { url: b2.url + '?view=data' })
    let dataReady = false
    for (let i = 0; i < 100; i++) { dataReady = await evaluate('!!(document.querySelector("#bd-data-kpi") && document.querySelector("#bd-data-kpi").children.length)').catch(() => false); if (dataReady) break; await sleep(200) }
    check('board2 data：KPI 6 卡', await evaluate('document.querySelectorAll("#bd-data-kpi .bd-kpi").length') === 6)
    check('board2 data：时间窗 chips 3 枚', await evaluate('document.querySelectorAll("#bd-view-data [data-bd-data-window]").length') === 3)
    check('board2 data：5 图表容器为 canvas 或显式未采集', await evaluate('(function(){var ids=["bd-data-chart-stack","bd-data-chart-msgline","bd-data-chart-costline","bd-data-chart-msgday","bd-data-chart-tokenday"];return ids.every(function(id){var n=document.getElementById(id);return !!n && (!!n.querySelector("canvas") || !!n.querySelector(".bd-chart-na"))})})()') === true)
    check('board2 data：msgline 非空', String(await evaluate('(document.querySelector("#bd-data-msgline")||{}).textContent||""')).length > 5)
    check('board2 data：window note 非空', String(await evaluate('(document.querySelector("#bd-data-window-note")||{}).textContent||""')).length > 5)
    check('board2 data：source line 非空', String(await evaluate('(document.querySelector("#bd-data-source")||{}).textContent||""')).length > 10)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(700)
    check('board2 data：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    check('board2 data：390 KPI 单列', String(await evaluate('getComputedStyle(document.getElementById("bd-data-kpi")).gridTemplateColumns')).split(' ').length === 1)
    await send('Emulation.clearDeviceMetricsOverride')
    await send('Page.navigate', { url: b2.url + '?view=tasks' })
    let tasksReady = false
    for (let i = 0; i < 100; i++) { tasksReady = await evaluate('!!(document.querySelector("#bd-tasks-recent-list") && document.querySelector("#bd-tasks-recent-list").children.length)').catch(() => false); if (tasksReady) break; await sleep(200) }
    check('board2 tasks：最近消息流非空或空态', /暂无消息|→|->|bd-tasks-recent-item/.test(String(await evaluate('(document.querySelector("#bd-tasks-recent-list")||{}).innerHTML||""'))))
    await evaluate('(function(){var t=document.querySelector(".bd-tasks-tab[data-pane=history]"); if(t) t.click(); return true})()')
    await sleep(400)
    check('board2 tasks：历史 pane 可见且有近似标注', await evaluate('(function(){var h=document.getElementById("bd-tasks-history"); if(!h || h.hidden) return false; var n=document.querySelector(".bd-tasks-history-note"); return !!n && /按消息终态近似 · 非任务完成态/.test(n.textContent)})()') === true)
    check('board2 tasks：source line 非空', String(await evaluate('(document.querySelector("#bd-tasks-source")||{}).textContent||""')).length > 10)
    await send('Page.navigate', { url: b2.url + '?view=org' })
    let orgReady = false
    for (let i = 0; i < 100; i++) { orgReady = await evaluate('document.querySelectorAll("#bd-org-roles .bd-org-role-row").length > 0').catch(() => false); if (orgReady) break; await sleep(200) }
    check('board2 org：agent KPI 为数字（members.length）', /^[0-9]+$/.test(String(await evaluate('(document.querySelector("#bd-org-kpi-agents")||{}).textContent||""')).trim()))
    check('board2 org：负载显示 turns/steps 或未采集', /turns|未采集/.test(String(await evaluate('(document.querySelector("#bd-org-roles")||{}).textContent||""'))))
    check('board2 org：source line 非空', String(await evaluate('(document.querySelector("#bd-org-source")||{}).textContent||""')).length > 10)
    await send('Page.navigate', { url: b2.url + 'member?id=writer' })
    let memReady = false
    for (let i = 0; i < 100; i++) { memReady = await evaluate('(document.body.innerText||"").indexOf("lines.created_at") >= 0').catch(() => false); if (memReady) break; await sleep(200) }
    check('board2 member：身份 session/agent 非空', await evaluate('(function(){var dd=document.querySelectorAll(".bd-kv dd"); return dd.length>=3 && dd[1].textContent.trim().length>0 && dd[2].textContent.trim().length>0})()') === true)
    check('board2 member：入队时间带 basis', /lines\.created_at|入队时间/.test(String(await evaluate('(document.body.innerText||"")'))))
    check('board2 member：完成率术语或未采集', /按消息终态近似 · 非任务完成态|未采集（无状态源）/.test(String(await evaluate('(document.body.innerText||"")'))))
    check('board2 member：最近交接 rebind 或未采集', /交接/.test(String(await evaluate('(document.body.innerText||"")'))))
    check('board2 member：头像 role=img + aria-label', await evaluate('(function(){var a=document.querySelector(".bd-avatar-48"); return !!a && a.getAttribute("role")==="img" && (a.getAttribute("aria-label")||"").length>0})()') === true)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    check('board2 member：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await send('Emulation.clearDeviceMetricsOverride')
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-1' })
    let wiReady = false
    for (let i = 0; i < 100; i++) { wiReady = await evaluate('(function(){var a=document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink").length === 2').catch(() => false); if (wiReady) break; await sleep(200) }
    check('board2 workitem：首条边界文案', /已是第一个/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[0]||{}).textContent||""'))))
    check('board2 workitem：下一条可点 href', /workitem\?id=wi-demo-2/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]||{}).getAttribute("href")||""'))))
    await evaluate('(function(){var a=document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]; if(a) a.click(); return true})()')
    await sleep(1500)
    check('board2 workitem：点击后 URL 变 B', /wi-demo-2/.test(String(await evaluate('location.search'))))
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-3' })
    await sleep(1500)
    check('board2 workitem：末条边界文案', /已是最后一个/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]||{}).textContent||""'))))
    check('board2 workitem：证据区有事实或原因', String(await evaluate('(document.querySelector("#bd-wi-evidence-list")||{}).textContent||""')).length > 8)
    check('board2 workitem：甘特真实跨度或显式空态', /真实跨度|未绘制|无时间数据/.test(String(await evaluate('(document.querySelector("#bd-wi-gantt-note")||{}).textContent||""'))))
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    check('board2 workitem：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await send('Emulation.clearDeviceMetricsOverride')
    writeFileSync(join(dir, 'team-metrics.json'), JSON.stringify({ schemaVersion: 1, generatedAt: Date.now(), tasks: { byLine: [] }, sessions: { lines: 3 }, messages: { total: 3 }, tokens: { total: 12345678, today: 3456789, window: 3456789, outputTotal: 120000, samples: 42, perDay: [{ date: '2026-11-22', tokens: 1000000 }, { date: '2026-11-23', tokens: 3456789 }], perDayOutput: [{ date: '2026-11-22', tokens: 50000 }, { date: '2026-11-23', tokens: 68000 }], byLine: [{ line: 'writer', today: 2222222, totalTokens: 2345678 }] } }))
    await send('Page.navigate', { url: b2.url + '?view=cost' })
    let costReady = false
    for (let i = 0; i < 100; i++) { costReady = await evaluate('!!(document.querySelector("#bd-cost-kpis") && document.querySelector("#bd-cost-kpis").children.length)').catch(() => false); if (costReady) break; await sleep(200) }
    check('board2 cost：KPI 3 卡', await evaluate('document.querySelectorAll("#bd-cost-kpis .bd-kpi").length') === 3)
    check('board2 cost：badges 非空', String(await evaluate('(document.querySelector("#bd-cost-badges")||{}).textContent||""')).length > 5)
    check('board2 cost：stats 5 项齐（缺字段未采集）', await evaluate('document.querySelectorAll("#bd-cost-stats .bd-pill").length') === 5 && /未采集/.test(String(await evaluate('(document.querySelector("#bd-cost-stats")||{}).textContent||""'))))
    check('board2 cost：2 图表容器为 canvas 或显式未采集', await evaluate('(function(){var ids=["bd-cost-chart-day","bd-cost-chart-line"];return ids.every(function(id){var n=document.getElementById(id);return !!n && (!!n.querySelector("canvas") || !!n.querySelector(".bd-chart-na"))})})()') === true)
    check('board2 cost：member 不可得块', /不可得/.test(String(await evaluate('(document.querySelector("#bd-view-cost .bd-cost-member")||{}).textContent||""'))))
    check('board2 cost：source line 非空', String(await evaluate('(document.querySelector("#bd-cost-source")||{}).textContent||""')).length > 10)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(700)
    check('board2 cost：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await send('Emulation.clearDeviceMetricsOverride')
    check('board2 runtime：无 console 异常', exceptions.length === 0)
  } finally {
    await new Promise((resolve) => b2.server.close(resolve))
  }

} catch (error) {
  failures.push(String(error && error.message ? error.message : error))
  console.log('FAIL ' + String(error && error.message ? error.message : error))
} finally {
  try { ws?.close() } catch {}
  try { if (chromeProc.exitCode === null && chromeProc.signalCode === null) chromeProc.kill('SIGKILL') } catch {}
  // Q1 修复：SIGKILL 后必须先等 Chrome 退出，否则 rmSync 与 profile 写入竞态会偶发 ENOTEMPTY
  await new Promise((resolve) => {
    if (chromeProc.exitCode !== null || chromeProc.signalCode !== null) return resolve()
    const timer = setTimeout(resolve, 5000)
    const done = () => { clearTimeout(timer); resolve() }
    chromeProc.once('exit', done)
    chromeProc.once('error', done)
  })
  await new Promise(resolve => server.close(resolve))
  // 清理重试：Chrome 子进程可能有短暂残余写；清理失败只告警，断言结果单独决定退出码
  let cleaned = false
  for (let attempt = 1; attempt <= 10 && !cleaned; attempt++) {
    try { rmSync(dir, { recursive: true, force: true }); cleaned = true }
    catch (error) {
      if (attempt === 10) console.warn('BOARD_E2E: cleanup warning after 10 attempts: ' + String(error?.code ?? '') + ' ' + String(error?.message ?? error))
      else await sleep(200)
    }
  }
  if (!cleaned) console.warn('BOARD_E2E: temp dir left for inspection: ' + dir)
}
console.log('')
console.log(failures.length === 0 ? 'BOARD_E2E: PASS' : 'BOARD_E2E: FAIL (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
