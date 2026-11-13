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

const isNewShell = /class="bd-topbar"/.test(html) && /\/vendor\/board-2\.0\.css/.test(html)
if (isNewShell) {
  const cssPath = resolve(ROOT, 'web/vendor/board-2.0.css')
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
  check('B1 五视图 (overview/org/tasks/data/cost)', count(/data-view="/g) >= 5, 'views=' + count(/data-view="/g))
  check('B2 Board 2.0 tokens CSS 引入', /\/vendor\/board-2\.0\.css/.test(html) && css.length > 1000)
  check('B3 五视图容器 (.bd-view)', count(/class="bd-view"/g) >= 5, 'views=' + count(/class="bd-view"/g))
  check('B4 详情 fallback 槽 (drawer-title/body)', html.includes('drawer-title') && html.includes('drawer-body'))
  check('B5 五区块锚点存在', ['bd-ov-goal','bd-ov-plan','bd-ov-workflow','bd-ov-rhythm','bd-ov-l15'].every(id => html.includes(id)))
  check('B6 窄屏响应式 (viewport + media query)', /name="viewport"/.test(html) && /@media/.test(css))
  check('B7 空态/未采集占位', /bd-empty|未采集/.test(html))
  check('B8 只读边界显式标注', count(/只读/g) >= 2, 'count=' + count(/只读/g))
  check('B9 无写操作控件', !/api\/actions/.test(html) && !/<input[^>]+type="text"/i.test(html))
  // legacy 冻结回归（0.12.0 旧视图仍满足旧 9 条）
  const legacyPath = resolve(ROOT, 'web/board-legacy.html')
  if (existsSync(legacyPath)) {
    const lh = readFileSync(legacyPath, 'utf8')
    check('L1 legacy 五视图保留', (lh.match(/data-view="/g) || []).length >= 5)
    check('L2 legacy 详情停靠保留', /aside\.drawer\{[^}]*position:fixed/.test(lh) && /#drawer-body\{[^}]*overflow-y:auto/.test(lh))
    check('L3 legacy 只读标注保留', (lh.match(/只读/g) || []).length >= 2)
  }
} else {
check('B1 五视图 (overview/org/tasks/data/cost)', count(/data-view="/g) >= 5, 'views=' + count(/data-view="/g))
check('B2 内容+详情双列 grid', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+420px/.test(html))
check('B3 详情停靠 (fixed + 内部滚动)', /aside\.drawer\{[^}]*position:fixed/.test(html) && /#drawer-body\{[^}]*overflow-y:auto/.test(html))
check('B4 固定信息槽 (drawer-title/body)', html.includes('drawer-title') && html.includes('drawer-body'))
check('B5 团队目标/决策/任务/数据存在', /团队目标|待决策/.test(html) && /任务/.test(html) && /消耗/.test(html))
check('B6 卡内滚动 (overflow-y:auto)', /overflow-y:auto/.test(html))
check('B7 空态/不可得占位', /暂无|不可得|未采集/.test(html))
check('B8 只读边界显式标注', count(/只读/g) >= 2, 'count=' + count(/只读/g))
check('B9 无写操作控件 (允许刷新 checkbox)', !/api\/actions/.test(html) && !/<input[^>]+type="text"/i.test(html))

}
const failures = checks.filter(c => !c.pass)
if (json) console.log(JSON.stringify({ ok: failures.length === 0, file: target, checks }, null, 1))
else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'BENTO_ALIGNMENT: PASS (' + checks.length + ' checks)' : 'BENTO_ALIGNMENT: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
