#!/usr/bin/env node
/**
 * check-board-scripts.mjs — 0.11.0-14 看板门禁
 * 1) web/board.html 每个内联 <script> 语法检查（vm.compileFunction，等价 node --check）
 * 2) 无原型演示数据残留（DATA.missions / 演示值 / 高保真演示）
 * 3) 无写接口调用（/api/actions）
 * 用法：node scripts/check-board-scripts.mjs [--file <html>] [--json]
 * 退出码：0 PASS / 1 FAIL / 2 读取失败
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
check('B2 无原型演示数据残留', !/DATA\.missions|演示值|高保真演示/.test(html))
check('B3 无写接口调用', !/\/api\/actions/.test(html))
check('B4 只读声明 >=2', (html.match(/只读/g) || []).length >= 2)
check('B5 必备视图与详情槽', html.includes('data-view="overview"') && html.includes('data-view="org"') && html.includes('data-view="tasks"') && html.includes('data-view="data"') && html.includes('data-view="cost"') && html.includes('drawer-title') && html.includes('drawer-body'))

const failures = checks.filter(c => !c.pass)
if (json) console.log(JSON.stringify({ ok: failures.length === 0, file: target, checks }, null, 1))
else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'BOARD_SCRIPTS: PASS (' + checks.length + ' checks)' : 'BOARD_SCRIPTS: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
