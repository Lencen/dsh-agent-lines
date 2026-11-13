#!/usr/bin/env node
/**
 * board2-views-smoke.mjs — 0.13.0 Board 2.0 视图覆盖静态门禁
 * 覆盖：新壳 5 视图骨架 / 三页 tokens 引用 / 详情八分区 / 成员页分区 / legacy 冻结 sha
 * 退出码：0 PASS / 1 FAIL
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const failures = checks.filter((c) => !c.pass)
for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
console.log('')
console.log(failures.length === 0 ? 'BOARD2_VIEWS_SMOKE: PASS (' + checks.length + ' checks)' : 'BOARD2_VIEWS_SMOKE: FAIL (' + failures.length + '/' + checks.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
