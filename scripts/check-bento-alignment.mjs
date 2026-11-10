#!/usr/bin/env node
/**
 * check-bento-alignment.mjs — 插件包内 Bento UI 静态门禁（0.8.0 S1c / R9）
 * 校验 web/board.html 是否满足 UIUX 线的 Bento 规范（DESIGN-SPEC §11）的结构要求。
 * 用法：node scripts/check-bento-alignment.mjs [--file <html>] [--json]
 * 退出码：0 PASS / 1 FAIL / 2 参数或读取失败
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const json = args.includes('--json')
const fileArg = args.indexOf('--file')
const target = fileArg >= 0 ? args[fileArg + 1] : resolve(ROOT, 'web/board.html')
if (!existsSync(target)) {
  console.error('board file not found: ' + target)
  process.exit(2)
}
const html = readFileSync(target, 'utf8')
const count = (re) => (html.match(re) || []).length
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass, detail: detail ?? '' })

check('B1 四卡结构 (tree/main/side/full)', count(/class="card /g) >= 4, 'cards=' + count(/class="card /g))
check('B2 12 列 grid 布局', /display:grid/.test(html) && /grid-template-columns:\s*repeat\(12/.test(html))
check('B3 同行等高 (align-items:stretch)', /align-items:stretch/.test(html))
const slots = ['slot-title', 'slot-status', 'slot-body', 'slot-actions']
check('B4 固定信息槽 (title/status/body/actions)', slots.every(s => html.includes(s)), slots.filter(s => !html.includes(s)).join(','))
check('B5 data-level 层级标注', count(/data-level/g) >= 4, 'count=' + count(/data-level/g))
check('B6 卡内滚动 (overflow:auto)', /overflow:auto/.test(html))
check('B7 空态/离线/stale 占位', /stale|offline|empty/i.test(html))
check('B8 只读边界显式标注', count(/只读/g) >= 2, 'count=' + count(/只读/g))
check('B9 无写操作控件 (无 input/actions API)', !/<input/i.test(html) && !/api\/actions/.test(html))

const failures = checks.filter(c => !c.pass)
if (json) console.log(JSON.stringify({ ok: failures.length === 0, file: target, checks }, null, 1))
else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'BENTO_ALIGNMENT: PASS (' + checks.length + ' checks)' : 'BENTO_ALIGNMENT: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
