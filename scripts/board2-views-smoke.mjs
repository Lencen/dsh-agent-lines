#!/usr/bin/env node
/**
 * board2-views-smoke.mjs — 0.13.0 Board 2.0 视图覆盖静态门禁
 * 覆盖：新壳 5 视图骨架 / 三页 tokens 引用 / 详情八分区 / 成员页分区 / legacy 冻结 sha
 * 退出码：0 PASS / 1 FAIL / 3 参数错误
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardArgs } from './lib/args-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 参数 fail-closed 守卫必须早于任何读文件/检查（0.14.2 C7.6；本脚本无已知参数）
guardArgs({
  script: 'board2-views-smoke.mjs',
  known: [],
  description: 'Board 2.0 视图覆盖静态门禁：新壳五视图 / 三页 tokens / 详情八分区 / 成员页分区 / legacy 冻结 sha',
  examples: ['node scripts/board2-views-smoke.mjs'],
})
const read = (p) => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass, detail })

const board = read('web/board.html')
const workitem = read('web/workitem.html')
const member = read('web/member.html')
const core = read('web/vendor/board2-core.js')

check('V1 新壳 topbar + 5 视图', /class="bd-topbar"/.test(board) && (board.match(/data-view="/g) || []).length >= 5)
check('V2 新壳总览 5 区块锚点', ['bd-ov-goal', 'bd-ov-plan', 'bd-ov-workflow', 'bd-ov-rhythm', 'bd-ov-l15'].every((id) => board.includes(id)))
check('V3 新壳组织/任务容器', board.includes('bd-org-roles') && board.includes('bd-tasks-list'))
check('V4 三页加载 Board 2.0 tokens 与补丁 CSS', ['web/board.html', 'web/workitem.html', 'web/member.html'].every((f) => /\/vendor\/board-2\.0\.css/.test(read(f)) && /\/vendor\/board2-plugin\.css/.test(read(f))))
check('V5 详情八分区存在', ['bd-wi-sec-header', 'bd-wi-sec-metrics', 'bd-wi-sec-workflow', 'bd-wi-sec-gantt', 'bd-wi-sec-board', 'bd-wi-sec-evidence', 'bd-wi-sec-notes', 'bd-wi-sec-nav'].every((id) => workitem.includes(id)))
check('V6 详情三视图要素', ['bd-wi-page-gantt', 'bd-wi-page-tablewrap', 'bd-wi-board', 'bd-wi-navlink'].every((id) => workitem.includes(id)))
check('V7 成员页分区', ['bd-member-charter-col', 'bd-member-cards', 'bd-member-tasks', 'bd-avatar-48'].every((c) => member.includes(c)))
check('V8 三页无旧 CSS/inline style', [board, workitem, member].every((h) => !/board-l15\.css/.test(h) && !/<style>[\s\S]*?<\/style>/.test(h)))
const coreOk = /renderOrg/.test(core) && /renderTasks/.test(core) && /renderL15/.test(core) && /renderWorkflow/.test(core)
check('V9 core 渲染函数齐备', coreOk)
const legacy = read('web/board-legacy.html')
const baseline = (read('web/board-legacy.html.sha256') || '').trim().split(/\s+/)[0]
const legacySha = legacy ? createHash('sha256').update(legacy).digest('hex') : ''
check('V10 legacy 冻结 sha 一致', !!baseline && baseline === legacySha, 'baseline=' + baseline.slice(0, 12) + ' actual=' + legacySha.slice(0, 12))

const css20 = read('web/vendor/board-2.0.css')
const runtimeIds = ['bd-ov-runtime', 'bd-ov-kpi', 'bd-ov-lines', 'bd-ov-decisions', 'bd-ov-deliveries', 'bd-ov-alerts', 'bd-ov-cost-body', 'bd-ov-banners', 'bd-ov-source']
check('V11 总览 runtime 元素齐备且位于 L1.5 之后', runtimeIds.every((id) => board.includes('id="' + id + '"')) && board.indexOf('id="bd-ov-runtime"') > board.indexOf('id="bd-ov-l15"'))
check('V12 core 有 renderRuntime 且接成本/团队快照', /function renderRuntime\(data\)/.test(core) && /renderRuntime\(data\)/.test(core) && /\/api\/team-metrics/.test(core) && /\/api\/team-board/.test(core))
check('V13 runtime 无源显式未采集 + 无 0 兜底', (function () {
  const start = core.indexOf('function renderRuntime(data)')
  const end = core.indexOf('function renderRhythm(data)')
  const body = start >= 0 && end > start ? core.slice(start, end) : ''
  const naCount = (body.match(/未采集/g) || []).length
  return naCount >= 6 && !/\|\| 0/.test(body) && /\.bd-kpi/.test(body)
})())
check('V14 runtime CSS 齐备', ['\.bd-ov-runtime', '\.bd-ov-line-grid', '\.bd-ov-kpi-na', '\.bd-kpi-grid'].every((re) => new RegExp(re).test(css20)))
const dataJs = read('web/vendor/board2-data.js')
check('V15 data 视图骨架齐备', ['bd-data-window-note', 'bd-data-kpi', 'bd-data-msgline', 'bd-data-chart-stack', 'bd-data-chart-msgline', 'bd-data-chart-costline', 'bd-data-chart-msgday', 'bd-data-chart-tokenday', 'bd-data-source'].every((id) => board.includes('id="' + id + '"')) && (board.match(/data-bd-data-window=/g) || []).length === 3)
check('V16 data 脚本与 echarts 接线', board.includes('/vendor/echarts.min.js') && board.includes('/vendor/board2-data.js') && /BD2Data/.test(core) && /BD2Data/.test(dataJs))
check('V17 data 5 图 legend/tooltip/grid 齐备', (dataJs.match(/legend:/g) || []).length >= 5 && (dataJs.match(/tooltip:/g) || []).length >= 4 && /grid:/.test(dataJs) && /消息数\/日/.test(dataJs) && /token\/日（k）/.test(dataJs) && /type: 'bar'/.test(dataJs) && /type: 'line'/.test(dataJs))
check('V18 data 无源显式未采集且无 0 兜底', (dataJs.match(/未采集/g) || []).length >= 6 && !/\|\| 0/.test(dataJs) && /bd-chart-na/.test(dataJs))
const costJs = read('web/vendor/board2-cost.js')
check('V19 cost 视图骨架齐备', ['bd-cost-overview-title', 'bd-cost-kpis', 'bd-cost-badges', 'bd-cost-stats', 'bd-cost-chart-day', 'bd-cost-chart-line', 'bd-cost-source'].every((id) => board.includes('id="' + id + '"')) && /bd-cost-member/.test(board))
check('V20 cost 脚本与 echarts 接线', board.includes('/vendor/board2-cost.js') && /BD2Cost/.test(core) && /BD2Cost/.test(costJs) && /\/api\/team-metrics/.test(costJs))
check('V21 cost 图表 tooltip/legend/grid + bar/line', (costJs.match(/tooltip:/g) || []).length >= 2 && /legend:/.test(costJs) && /grid:/.test(costJs) && /type: 'bar'/.test(costJs) && /type: 'line'/.test(costJs))
check('V22 cost 无源显式未采集且无 0 兜底', (costJs.match(/未采集/g) || []).length >= 6 && !/\|\| 0/.test(costJs) && /bd-chart-na/.test(costJs) && /不可得/.test(board))
check('V23 任务态近似口径统一可见（O3② 条件1/2）', /按消息终态近似 · 非任务完成态/.test(dataJs) && (dataJs.match(/按消息终态近似 · 非任务完成态/g) || []).length >= 3)
check('V24 tasks/org 新容器齐备', ['bd-tasks-recent-list', 'bd-tasks-history', 'bd-tasks-history-list', 'bd-tasks-source', 'bd-org-source'].every((id) => board.includes('id="' + id + '"')))
check('V25 core 有 recent/history/source 渲染', /function renderRecentMessages/.test(core) && /function renderHistoryPane/.test(core) && /function renderTasksSource/.test(core) && /renderHistoryPane\(by\)/.test(core))
check('V26 tasks 历史 pane 可见近似术语且仅事实陈述', /历史任务 · 按消息终态近似 · 非任务完成态/.test(board) && /按消息终态近似 · 非任务完成态/.test(core) && /不参与任何完成率\/完成数 KPI/.test(board))
check('V27 org agent KPI 用 members.length', /cnt\.agents\.textContent = membersKnown \? String\(members\.length\)/.test(core) && /membersOf\(key\)\.length/.test(core))
check('V28 org 负载接 team-metrics.activity（无源未采集）', /ovActivityOf\(metrics, l\.label\)/.test(core) && /\/api\/team-metrics/.test(core) && /未采集（team-metrics\.activity 无该线）/.test(core))
check('V29 cost stats 5 项始终显式（缺字段未采集）+ 双图 legend', (costJs.match(/pill\('/g) || []).length >= 5 && /缺字段，不显示 0/.test(costJs) && (costJs.match(/legend:/g) || []).length >= 2)
check('V30 workitem 证据区接 recent 且有原因空态', /id="bd-wi-evidence-list"/.test(workitem) && /function renderEvidence/.test(workitem) && /该 taskRef 无关联消息/.test(workitem) && /summary || ''\)\.slice\(0, 120\)/.test(workitem))
check('V31 workitem 完成率统一术语与边界文案', /按消息终态近似 · 非任务完成态/.test(workitem) && /—\/未拆解/.test(workitem) && /未采集（无状态源）/.test(workitem))
check('V32 甘特仅真实范围且无合成轴', !/synthAxis = true/.test(workitem) && /firstAt/.test(workitem) && /真实跨度/.test(workitem) && /无时间数据/.test(workitem) && /不伪造时间轴/.test(workitem))
check('V33 导航可点逻辑与边界文案', /function renderNav/.test(workitem) && /setLink/.test(workitem) && /已是第一个/.test(workitem) && /已是最后一个/.test(workitem) && /aria-disabled/.test(workitem))
check('V34 member 身份区接 /api/members 字段', /fetch\('\/api\/members'/.test(member) && /member\.sessionId/.test(member) && /member\.agentId/.test(member) && /member\.instanceId/.test(member) && /member\.createdAt/.test(member) && /title=/.test(member))
check('V35 member 完成率统一术语 + 无源未采集', /按消息终态近似 · 非任务完成态/.test(member) && /未采集（无状态源）/.test(member) && /byState && x\.byState\.acked/.test(member))
check('V36 member 最近交接取 rebinds[0]', /Array\.isArray\(line\.rebinds\) && line\.rebinds\[0\]/.test(member) && /rb\.from/.test(member) && /rb\.to/.test(member) && /rb\.reason/.test(member))
check('V37 member 头像 a11y role=img + aria-label', /role="img"/.test(member) && /setAttribute\('role', 'img'\)/.test(member) && /setAttribute\('aria-label'/.test(member))
const plugCss = read('web/vendor/board2-plugin.css')
check('V38 图表/甘特/表格容器自身横滚', ['\.bd-chart', '\.bd-wi-page-gantt-wrap', '\.bd-wi-tablewrap'].every((sel) => new RegExp(sel + '[^{]*\{[^}]*overflow-x: auto').test(plugCss)))
check('V39 ≤480 各视图单列/KPI 规则齐备', ['#bd-ov-kpi.bd-kpi-grid', 'bd-data-kpi', 'bd-cost-kpis', 'bd-ov-line-grid', 'bd-wi-metrics, .bd-wi-fields', 'bd-tasks-kpi', 'bd-org-kpi-bar'].every((k) => plugCss.includes(k)))
check('V40 三页含 viewport meta 且无固定宽内联样式', [board, workitem, member].every((h) => /name="viewport"/.test(h)) && ![board, workitem, member].some((h) => /style="[^"]*width:\s*\d{3,}px/.test(h)))
const failures = checks.filter((c) => !c.pass)
for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
console.log('')
console.log(failures.length === 0 ? 'BOARD2_VIEWS_SMOKE: PASS (' + checks.length + ' checks)' : 'BOARD2_VIEWS_SMOKE: FAIL (' + failures.length + '/' + checks.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
