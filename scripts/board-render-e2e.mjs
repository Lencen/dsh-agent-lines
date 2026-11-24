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
  // 0.14.2 C1.5：结构信号轮询（禁用固定 sleep 判绿）；超时返回 false 交给断言报红
  const waitFor = async (expression, tries = 100, ms = 200) => {
    for (let i = 0; i < tries; i++) {
      const ok = await evaluate(expression).catch(() => false)
      if (ok === true) return true
      await sleep(ms)
    }
    return false
  }
  const load = async (query) => {
    await send('Page.navigate', { url: url + '?v=' + query })
    for (let i = 0; i < 80; i++) { const ready = await evaluate('typeof DATA !== "undefined" && typeof DATA.missions !== "undefined"').catch(() => false); if (ready === true) break; await sleep(250) }
    await sleep(500)
  }

  await load('array')
  // 高负载下 DATA 先定义、missions 稍后填充；按结构信号等到位再断言（不改断言数）
  await waitFor('(DATA.missions||[]).length === 5', 40, 250)
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
  await waitFor('(DATA.missions||[]).length === 5 && DATA.tasksShape === "object"', 40, 250)
  check('对象 map 快照：任务 5 条', await evaluate('(DATA.missions||[]).length') === 5)
  check('对象 map 快照：tasksShape=object', await evaluate('DATA.tasksShape') === 'object')
  check('对象 map 快照：无渲染异常', !(await evaluate('DATA.renderError||null')))
  check('对象 map 快照：无 console 异常', exceptions.length === 0)

  setBoard({ ...board, tasks: 5 })
  exceptions.length = 0
  await load('count')
  await waitFor('!!DATA.tasksDiagnostic && (DATA.missions||[]).length === 0', 40, 250)
  check('计数快照：tasksDiagnostic 可见', /缺少任务明细/.test(String(await evaluate('DATA.tasksDiagnostic'))))
  check('计数快照：页面提示缺少明细', /缺少任务明细/.test(String(await evaluate('(document.querySelector("#missions")||{}).textContent'))))
  check('计数快照：不伪造任务', await evaluate('(DATA.missions||[]).length') === 0)
  // 0.14 S2：board2 总览 runtime 区（DOM 级：元素存在 + 非空或显式未采集）
  const b2 = await startBoardServer({ dir, dbPath, teamRoot, host: '127.0.0.1', port: 0, board2: true })
  try {
    await send('Page.navigate', { url: b2.url + '?view=overview' })
    let ready = false
    for (let i = 0; i < 100; i++) { ready = await evaluate('!!(document.querySelector("#bd-ov-kpi") && document.querySelector("#bd-ov-kpi").children.length)').catch(() => false); if (ready) break; await sleep(200) }
    // 0.14.2 C1/C2/C8.1：默认态 L1.5 必须为空态且 0 行，容器不随数据删
    await waitFor('!!document.querySelector("#bd-ov-l15 .bd-l15-empty, #bd-ov-l15 .bd-wi-row")')
    const l15Default = JSON.parse(String(await evaluate('(function(){var host=document.getElementById("bd-ov-l15");var body=document.getElementById("bd-ov-l15-body");var badge=document.getElementById("bd-ov-l15-badge");var banner=document.getElementById("bd-demo-banner");return JSON.stringify({text:body?body.innerText:"",rows:document.querySelectorAll("#bd-ov-l15 .bd-wi-row").length,count:(document.querySelector("#bd-ov-l15 .bd-l15-count")||{}).textContent||"",h3:(document.querySelector("#bd-ov-l15 h3")||{}).textContent||"",head:!!document.querySelector("#bd-ov-l15 .bd-l15-head"),chips:document.querySelectorAll("#bd-ov-l15 .bd-chip").length,note:!!document.querySelector("#bd-ov-l15 .bd-l15-note"),demoNodes:document.querySelectorAll("[data-wi^=wi-demo]").length,demoTitles:/0\\.12\\.0 发布准备|官网文案改版|视频 v2 收尾/.test(document.body.innerText),badgeHidden:badge?badge.hidden:null,bannerHidden:banner?banner.hidden:null})})()')))
    check('board2 默认：L1.5 空态含「未接入/D1/本区不显示示意数据」', /未接入/.test(l15Default.text) && /D1/.test(l15Default.text) && /本区不显示示意数据/.test(l15Default.text), JSON.stringify(l15Default.text).slice(0, 160))
    check('board2 默认：L1.5 0 行 + 当前 0 个', l15Default.rows === 0 && String(l15Default.count).trim() === '当前 0 个', 'rows=' + l15Default.rows + ' count=' + l15Default.count)
    check('board2 默认：无 wi-demo 节点/标题', l15Default.demoNodes === 0 && l15Default.demoTitles === false, 'nodes=' + l15Default.demoNodes + ' titles=' + l15Default.demoTitles)
    check('board2 默认：示例横幅与示例 badge 隐藏', l15Default.bannerHidden === true && l15Default.badgeHidden === true)
    check('board2 容器回归：L1.5 头/4 chips/count/note/h3', l15Default.head && l15Default.chips === 4 && l15Default.note && String(l15Default.h3).trim() === 'L1.5 大任务')
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
    // 0.14.2 C1.2：默认态大任务筛选器只剩「全部大任务」，不得由示例数据生成 option
    const wiSelect = JSON.parse(String(await evaluate('(function(){var s=document.getElementById("bd-tasks-wi-select");var opts=s?Array.prototype.slice.call(s.options).map(function(o){return o.value+"|"+o.textContent}):[];return JSON.stringify({count:opts.length,opts:opts})})()')))
    check('board2 tasks：大任务筛选器仅「全部大任务」', wiSelect.count === 1 && wiSelect.opts[0] === '|全部大任务', JSON.stringify(wiSelect))
    check('board2 tasks：默认无示例标题', !/0\.12\.0 发布准备|官网文案改版|视频 v2 收尾/.test(String(await evaluate('document.body.innerText'))))
    await evaluate('(function(){var t=document.querySelector(".bd-tasks-tab[data-pane=history]"); if(t) t.click(); return true})()')
    await sleep(400)
    check('board2 tasks：历史 pane 可见且有近似标注', await evaluate('(function(){var h=document.getElementById("bd-tasks-history"); if(!h || h.hidden) return false; var n=document.querySelector(".bd-tasks-history-note"); return !!n && /按消息终态近似 · 非任务完成态/.test(n.textContent)})()') === true)
    check('board2 tasks：source line 非空', String(await evaluate('(document.querySelector("#bd-tasks-source")||{}).textContent||""')).length > 10)
    // 0.14.2 C3.1：?demo=1 显式示例态——3 行 + 每行「示例」badge + 首屏横幅
    await send('Page.navigate', { url: b2.url + '?demo=1' })
    await waitFor('document.querySelectorAll("#bd-ov-l15 .bd-wi-row").length === 3')
    const demoState = JSON.parse(String(await evaluate('(function(){var rows=Array.prototype.slice.call(document.querySelectorAll("#bd-ov-l15 .bd-wi-row"));var banner=document.querySelector(".bd-demo-banner");return JSON.stringify({rows:rows.length,badges:rows.filter(function(r){return Array.prototype.some.call(r.querySelectorAll(".bd-badge"),function(b){return /示例/.test(b.textContent)})}).length,text:document.getElementById("bd-ov-l15-body").innerText,banner:banner?{text:banner.innerText.trim(),hidden:banner.hidden,top:Math.round(banner.getBoundingClientRect().top)}:null,count:(document.querySelector("#bd-ov-l15 .bd-l15-count")||{}).textContent||""})})()')))
    check('board2 demo：L1.5 3 行示例', demoState.rows === 3 && /0\.12\.0 发布准备/.test(demoState.text), 'rows=' + demoState.rows)
    check('board2 demo：每行含「示例」badge = 3', demoState.badges === 3, 'badges=' + demoState.badges)
    check('board2 demo：首屏横幅「示例数据（非真实）」', !!demoState.banner && demoState.banner.hidden === false && /示例数据（非真实）/.test(demoState.banner.text) && demoState.banner.top < 400, JSON.stringify(demoState.banner))
    // 0.14.2 C3.2：同一上下文 /?demo=1 → / → /?demo=1 可逆不残留
    await send('Page.navigate', { url: b2.url + '/' })
    await waitFor('!!document.querySelector("#bd-ov-l15 .bd-l15-empty")')
    const backDefault = JSON.parse(String(await evaluate('(function(){var banner=document.querySelector(".bd-demo-banner");return JSON.stringify({rows:document.querySelectorAll("#bd-ov-l15 .bd-wi-row").length,bannerHidden:banner?banner.hidden:null,demoNodes:document.querySelectorAll("[data-wi^=wi-demo]").length})})()')))
    check('board2 demo 隔离：回默认 0 行 + 横幅隐藏', backDefault.rows === 0 && backDefault.bannerHidden === true && backDefault.demoNodes === 0, JSON.stringify(backDefault))
    await send('Page.navigate', { url: b2.url + '?demo=1' })
    const reDemo = await waitFor('document.querySelectorAll("#bd-ov-l15 .bd-wi-row").length === 3')
    check('board2 demo 隔离：再次带参数恢复 3 行', reDemo === true && (await evaluate('document.querySelectorAll("#bd-ov-l15 .bd-wi-row").length')) === 3)
    // 0.14.2 C3.3：?demo=1 不破坏只读
    const readonly = JSON.parse(String(await evaluate('(async function(){var a=await fetch("/api/work-items",{method:"POST"});var b=await fetch("/api/live",{method:"PUT"});return JSON.stringify({post:a.status,put:b.status})})()')))
    check('board2 demo：只读 POST/PUT 仍 405', readonly.post === 405 && readonly.put === 405, JSON.stringify(readonly))
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
    // 0.14.2 C4.4：member 页数据时刻必须来自 /api/live，不得写死 2026-11-13
    const memberSnap = JSON.parse(String(await evaluate('(function(){var e=document.getElementById("bd-member-snapshot");return JSON.stringify({text:(e||{}).textContent||"",body:document.body.innerText})})()')))
    check('board2 member：数据时刻非写死（无 2026-11-13 09:28:52）', !/2026-11-13 09:28:52/.test(memberSnap.body) && /数据时刻/.test(memberSnap.text), memberSnap.text.slice(-80))
    check('board2 member：默认无示例标题', !/0\.12\.0 发布准备|官网文案改版|视频 v2 收尾|wi-demo/.test(memberSnap.body))
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(600)
    check('board2 member：390 无横向溢出', (await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1)
    await send('Emulation.clearDeviceMetricsOverride')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    // 0.14.2 C1.5 双态：默认态与 ?demo=1 态都要过 390 布局
    const pages390 = ['', '?demo=1', '?view=org', '?view=tasks', '?view=data', '?view=cost', 'workitem?id=wi-demo-1', 'workitem?id=wi-demo-1&demo=1', 'member?id=writer', 'member?id=writer&demo=1']
    for (const path of pages390) {
      await send('Page.navigate', { url: b2.url + path })
      await sleep(2200)
      const info = JSON.parse(String(await evaluate('(function(){var d=document.documentElement;return JSON.stringify({scroll:d.scrollWidth,client:d.clientWidth})})()')))
      console.log('390 ' + (path || '/') + ' scroll=' + info.scroll + ' client=' + info.client)
      check('board2 390 无横溢 ' + (path || '/'), info.scroll <= info.client + 1, 'scroll=' + info.scroll + ' client=' + info.client)
    }
    await send('Page.navigate', { url: b2.url + '?view=data' })
    await sleep(1800)
    check('board2 390 data 图表容器可横滚', /(auto|scroll)/.test(String(await evaluate('getComputedStyle(document.getElementById("bd-data-chart-stack")).overflowX'))))
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-1' })
    await sleep(1800)
    check('board2 390 workitem 甘特容器可横滚', /(auto|scroll)/.test(String(await evaluate('getComputedStyle(document.querySelector(".bd-wi-page-gantt-wrap")).overflowX'))))
    await send('Emulation.clearDeviceMetricsOverride')
    // 0.14.2 C1.3：默认态直访 wi-demo-* 必须是明确空态，不得渲染示例甘特/工作流/6 行表
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-1' })
    await waitFor('/已移出默认视图/.test((document.querySelector(".bd-wi-page-title")||{}).textContent || "")')
    const wiDefault = JSON.parse(String(await evaluate('(function(){return JSON.stringify({title:(document.querySelector(".bd-wi-page-title")||{}).textContent||"",body:document.body.innerText,secs:document.querySelectorAll(".bd-wi-sec").length,wfCards:document.querySelectorAll(".bd-wi-wfcard").length,tableRows:document.querySelectorAll("#bd-wi-page-tablewrap tr").length,gantt:!!document.getElementById("bd-wi-page-gantt"),tablewrap:!!document.getElementById("bd-wi-page-tablewrap"),snapshot:(document.getElementById("bd-wi-snapshot")||{}).textContent||""})})()')))
    check('board2 workitem 默认：示例任务明确「已移出默认视图」', /示例数据/.test(wiDefault.title) && /已移出默认视图/.test(wiDefault.title), wiDefault.title)
    check('board2 workitem 默认：不渲染示例甘特/工作流/6 行表', wiDefault.wfCards === 0 && wiDefault.tableRows === 0 && !/0\.12\.0 发布准备|官网文案改版|视频 v2 收尾/.test(wiDefault.body), 'wf=' + wiDefault.wfCards + ' rows=' + wiDefault.tableRows)
    check('board2 workitem 容器回归：8 分区 + 甘特/表格容器', wiDefault.secs === 8 && wiDefault.gantt && wiDefault.tablewrap, 'secs=' + wiDefault.secs)
    check('board2 workitem 默认：无写死快照时刻', !/2026-11-13 09:28:52/.test(wiDefault.body) && /未采集（无快照时刻）/.test(wiDefault.snapshot), wiDefault.snapshot.slice(0, 80))
    // 0.14.2 C1.1：真实 id（非 wi-demo）也不得残留示例标题/面包屑
    await send('Page.navigate', { url: b2.url + 'workitem?id=real-1' })
    await waitFor('/大任务未接入/.test((document.querySelector(".bd-wi-page-title")||{}).textContent || "")')
    const wiReal = JSON.parse(String(await evaluate('(function(){return JSON.stringify({body:document.body.innerText,crumb:(document.querySelector(".bd-wi-crumb")||{}).textContent||"",title:(document.querySelector(".bd-wi-page-title")||{}).textContent||"",secs:document.querySelectorAll(".bd-wi-sec").length})})()')))
    check('board2 workitem 真实 id：无示例标题且 8 分区仍在', !/0\.12\.0 发布准备|官网文案改版|视频 v2 收尾|wi-demo/.test(wiReal.body + wiReal.crumb) && wiReal.secs === 8, wiReal.crumb + ' secs=' + wiReal.secs)
    // 0.14.2 C1.5 双态：?demo=1 才恢复 3 条示例的导航与甘特
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-1&demo=1' })
    // 静态 HTML 自带「已是第一个/已是最后一个」占位，必须等 JS 把下一条 href 真正写出来再断言
    await waitFor('(function(){var a=document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1];return !!a && /wi-demo-2/.test(a.getAttribute("href")||"")})()')
    check('board2 workitem demo：首条边界文案', /已是第一个/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[0]||{}).textContent||""'))))
    check('board2 workitem demo：下一条可点 href 且带 demo=1', /workitem\?id=wi-demo-2(&demo=1)?/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]||{}).getAttribute("href")||""'))))
    await evaluate('(function(){var a=document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]; if(a) a.click(); return true})()')
    await waitFor('/wi-demo-2/.test(location.search)')
    check('board2 workitem demo：点击后 URL 变 B', /wi-demo-2/.test(String(await evaluate('location.search'))))
    await send('Page.navigate', { url: b2.url + 'workitem?id=wi-demo-3&demo=1' })
    await waitFor('/视频 v2 收尾/.test((document.querySelector(".bd-wi-page-title")||{}).textContent || "")')
    check('board2 workitem demo：末条边界文案', /已是最后一个/.test(String(await evaluate('(document.querySelectorAll("#bd-wi-sec-nav .bd-wi-navlink")[1]||{}).textContent||""'))))
    const wiDemo = JSON.parse(String(await evaluate('(function(){var banner=document.querySelector(".bd-demo-banner");return JSON.stringify({banner:banner?{text:banner.innerText.trim(),hidden:banner.hidden,top:Math.round(banner.getBoundingClientRect().top)}:null,evidence:(document.querySelector("#bd-wi-evidence-list")||{}).textContent||"",gantt:(document.querySelector("#bd-wi-gantt-note")||{}).textContent||""})})()')))
    check('board2 workitem demo：横幅可见', !!wiDemo.banner && wiDemo.banner.hidden === false && /示例数据（非真实）/.test(wiDemo.banner.text))
    check('board2 workitem demo：证据区有事实或原因', String(wiDemo.evidence).length > 8)
    check('board2 workitem demo：甘特真实跨度或显式空态', /真实跨度|未绘制|无时间数据/.test(String(wiDemo.gantt)))
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
