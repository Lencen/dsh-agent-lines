#!/usr/bin/env node
/**
 * check-board-scripts.mjs — 0.11.0-14 看板门禁
 * 1) web/board.html 每个内联 <script> 语法检查（vm.compileFunction，等价 node --check）
 * 2) 无原型演示数据残留（DATA.missions / 演示值 / 高保真演示）
 * 3) 无写接口调用（/api/actions）
 * 用法：node scripts/check-board-scripts.mjs [--file <html>] [--json] [-h|--help]
 * 退出码：0 PASS / 1 FAIL / 2 读取被检文件失败 / 3 参数错误
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { guardArgs } from './lib/args-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 参数 fail-closed 守卫必须早于任何读文件/检查（0.14.2 C7）
guardArgs({
  script: 'check-board-scripts.mjs',
  known: ['--json', '--file <path>'],
  description: '看板静态门禁：内联脚本语法 / 无演示数据残留 / 无写接口 / board-2.0.css 完整性',
  argHelp: { '--json': '以 JSON 输出全部检查项与结果', '--file': '指定被检查的 HTML 文件（默认 web/board.html）' },
  examples: [
    'node scripts/check-board-scripts.mjs',
    'node scripts/check-board-scripts.mjs --file web/board.html',
    'node scripts/check-board-scripts.mjs --json',
  ],
})
const args = process.argv.slice(2)
const json = args.includes('--json')
const fileArg = args.indexOf('--file')
const target = fileArg >= 0 ? args[fileArg + 1] : resolve(ROOT, 'web/board.html')
if (!existsSync(target)) { console.error('board file not found: ' + target); process.exit(2) }
const html = readFileSync(target, 'utf8')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass, detail })

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1])
const bad = []
let syntax = 0
scripts.forEach((src, i) => {
  if (src.trim() === '') return
  syntax++
  try { vm.compileFunction(src, ['window', 'document'], { filename: 'board.html#script' + (i + 1) }) }
  catch (error) { bad.push('script#' + (i + 1) + ': ' + String((error && error.message) || error)) }
})
check('B1 内联脚本语法 (' + syntax + ' 段)', bad.length === 0, bad.join(' | '))
const isNewShell = /class="bd-topbar"/.test(html) && /\/vendor\/board-2\.0\.css/.test(html)
check('B2 真实数据适配层存在（同步清空演示数据）', isNewShell ? (!/BD_SAMPLES/.test(html) && !/演示值|高保真演示/.test(html)) : (/__REAL_ADAPTER__/.test(html) && /resetData\(\)/.test(html) && !/function showOrg\b/.test(html)))
check('B3 无写接口调用', !/\/api\/actions/.test(html))
check('B4 只读声明 >=2', (html.match(/只读/g) || []).length >= 2)
check('B5 必备视图与详情槽', html.includes('data-view="overview"') && html.includes('data-view="org"') && html.includes('data-view="tasks"') && html.includes('data-view="data"') && html.includes('data-view="cost"') && html.includes('drawer-title') && html.includes('drawer-body'))

check('B6 P1-04 前端防御（asArray/错误可见/无静默 catch）',
  isNewShell ? (/id="bd-error"/.test(html) && /role="alert"/.test(html) && /bd-empty/.test(html)) : (/function asArray\(/.test(html) && /function safeRender\(/.test(html) && /tasksEmptyHtml\(/.test(html) && !/try\{renderTasks\(false\)\}catch\(e\)\{\}/.test(html) && /officialTeamAvailable/.test(html) && /deptSummary/.test(html)))
const boardServerPath = resolve(ROOT, 'lib/board-server.js')
const boardServer = existsSync(boardServerPath) ? readFileSync(boardServerPath, 'utf8') : ''
check('B7 P1-04 服务端归一（normalizeBoardSnapshot + 诊断字段）',
  /export function normalizeBoardSnapshot\(/.test(boardServer) && /normalizeBoardSnapshot\(board\)/.test(boardServer) && /tasksDiagnostic/.test(boardServer) && /tasksShape/.test(boardServer))
// B8-B10: 0.12.0 独立页（workitem/member）静态检查（flag gated 页面，必须同样只读）
for (const [name, rel] of [['workitem', 'web/workitem.html'], ['member', 'web/member.html']]) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) { check('B8 独立页脚本语法 ' + name, false, rel + ' missing'); continue }
  const h = readFileSync(p, 'utf8')
  const segs = [...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim() !== '')
  const bad2 = []
  segs.forEach((src, i) => { try { vm.compileFunction(src, ['window', 'document'], { filename: rel + '#s' + i }) } catch (e) { bad2.push('script#' + (i + 1) + ': ' + String((e && e.message) || e)) } })
  check('B8 独立页脚本语法 ' + name + ' (' + segs.length + ' 段)', bad2.length === 0, bad2.join(' | '))
  check('B9 独立页只读声明 ' + name, (h.match(/只读/g) || []).length >= 2)
  check('B10 独立页无写接口 ' + name, !/\/api\/actions/.test(h) && !/method="post"/i.test(h))
}
// B11-B12: Board 2.0 新壳/独立页不得残留旧类与旧 CSS（0.13 视觉口径）
for (const rel of ['web/board.html', 'web/workitem.html', 'web/member.html']) {
  const p = resolve(ROOT, rel)
  const h = existsSync(p) ? readFileSync(p, 'utf8') : ''
  check('B11 无旧类残留 ' + rel, !/(?:class="(?:card|kpis|missions?|tab|chips|view)|id="missions"|line-tasks-list)/.test(h))
  check('B12 无旧 CSS 引用 ' + rel, !/board-l15\.css/.test(h) && !/<style>[\s\S]*?<\/style>/.test(h))
}
// B13-B15: Board 2.0 数据/消耗脚本（0.14）：语法 / 只读 / 数据源
for (const [name, rel] of [['board2-data', 'web/vendor/board2-data.js'], ['board2-cost', 'web/vendor/board2-cost.js']]) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) { check('B13 board2 脚本语法 ' + name, false, rel + ' missing'); continue }
  const src = readFileSync(p, 'utf8')
  const bad3 = []
  try { vm.compileFunction(src, ['window', 'document', 'fetch', 'getComputedStyle'], { filename: rel }) } catch (e) { bad3.push(String((e && e.message) || e)) }
  check('B13 board2 脚本语法 ' + name, bad3.length === 0, bad3.join(' | '))
  check('B14 board2 只读（无写方法/无写接口） ' + name, !/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(src) && !/\/api\/actions/.test(src))
  check('B15 board2 数据源仅只读端点 ' + name, /\/api\/team-metrics/.test(src) && !/new\s+EventSource|WebSocket/.test(src))
}
// B16-B20: vendored board-2.0.css 完整性（防截断，0.14.1）
{
  const cssPath = resolve(ROOT, 'web/vendor/board-2.0.css')
  const css20 = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  const cssLines = css20 === '' ? 0 : css20.split(String.fromCharCode(10)).length
  const selectorCount = (css20.match(/[^{}]+(?=\s*\{)/g) || []).length
  check('B16 board-2.0.css 行数 >= 1400', cssLines >= 1400, 'lines=' + cssLines)
  check('B17 board-2.0.css 选择器 >= 500', selectorCount >= 500, 'selectors=' + selectorCount)
  check('B18 board-2.0.css 关键选择器齐备', ['.bd-tasks-', '.bd-wi-', '.bd-cost-', '.bd-data-', '.bd-ov-line-owner'].every(k => css20.includes(k)))
  let headDeleted = 0
  try {
    const out = execFileSync('git', ['show', '--numstat', 'HEAD', '--', 'web/vendor/board-2.0.css'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
    const m = out.match(/^(\d+)\s+(\d+)\s/m)
    if (m) headDeleted = Number(m[2])
  } catch {}
  check('B19 HEAD 提交对 board-2.0.css 删除行 <= 50', headDeleted <= 50, 'deleted=' + headDeleted)
  let workDeleted = 0
  try {
    const out = execFileSync('git', ['diff', '--numstat', 'HEAD', '--', 'web/vendor/board-2.0.css'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
    const m = out.match(/^(\d+)\s+(\d+)\s/m)
    if (m) workDeleted = Number(m[2])
  } catch {}
  check('B20 工作树对 board-2.0.css 删除行 <= 50', workDeleted <= 50, 'deleted=' + workDeleted)
}
const failures = checks.filter(c => !c.pass)
if (json) console.log(JSON.stringify({ ok: failures.length === 0, file: target, checks }, null, 1))
else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'BOARD_SCRIPTS: PASS (' + checks.length + ' checks)' : 'BOARD_SCRIPTS: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
