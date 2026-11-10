#!/usr/bin/env node
/**
 * check-docs-consistency.cjs — 0.8.0 文档一致性门禁（fail-closed）
 *
 * 目的：防止"这边改了、那边没改"。所有检查项任一失败 -> exit 1。
 * 用法：
 *   node scripts/check-docs-consistency.cjs          # 人读输出
 *   node scripts/check-docs-consistency.cjs --json   # 机器读
 * 接入：package.json 的 npm test 末尾调用本脚本。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checks = []
function ok(name, detail = '') { checks.push({ name, pass: true, detail }) }
function fail(name, detail) { checks.push({ name, pass: false, detail }); failures.push(name + ': ' + detail) }
function read(p) { return readFileSync(resolve(ROOT, p), 'utf8') }

// ---------- 文件清单 ----------
const PAIRS = [
  ['README.md', 'README.en.md'],
  ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ['docs/PHILOSOPHY.md', 'docs/PHILOSOPHY.en.md'],
  ['docs/KNOWN_ISSUES.md', 'docs/KNOWN_ISSUES.en.md'],
  ['docs/DELEGATION-POLICY.md', 'docs/DELEGATION-POLICY.en.md'],
  ['docs/ARCHITECTURE.md', 'docs/ARCHITECTURE.en.md'],
  ['docs/PROTOCOL.md', 'docs/PROTOCOL.en.md'],
  ['docs/SECURITY.md', 'docs/SECURITY.en.md'],
  ['docs/DEPLOY.md', 'docs/DEPLOY.en.md'],
  ['docs/AGENT-TEAMS.md', 'docs/en/AGENT-TEAMS.md'],
]

// ---------- C1 相对链接 ----------
{
  const files = ['README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md',
    ...readdirSync(resolve(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f),
    'docs/en/AGENT-TEAMS.md']
  let total = 0
  const missing = []
  for (const f of files) {
    const text = read(f)
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      total++
      const clean = target.split('#')[0]
      if (!clean) continue
      if (!existsSync(resolve(ROOT, dirname(f), clean))) missing.push(f + ' -> ' + target)
    }
  }
  if (missing.length === 0) ok('C1 relative links (' + total + ')')
  else fail('C1 relative links', missing.join('; '))
}

// ---------- C2 中英配对存在 ----------
{
  const missing = []
  for (const [zh, en] of PAIRS) {
    if (!existsSync(resolve(ROOT, zh))) missing.push(zh)
    if (!existsSync(resolve(ROOT, en))) missing.push(en)
  }
  if (missing.length === 0) ok('C2 zh/en pairs (' + PAIRS.length + ')')
  else fail('C2 zh/en pairs', 'missing: ' + missing.join(', '))
}

// ---------- C3 中英小节数一致 ----------
{
  const bad = []
  for (const [zh, en] of PAIRS) {
    if (!existsSync(resolve(ROOT, zh)) || !existsSync(resolve(ROOT, en))) continue
    const nz = (read(zh).match(/^## /gm) || []).length
    const ne = (read(en).match(/^## /gm) || []).length
    if (nz !== ne) bad.push(zh + '=' + nz + ' vs ' + en + '=' + ne)
  }
  if (bad.length === 0) ok('C3 zh/en h2 parity')
  else fail('C3 zh/en h2 parity', bad.join('; '))
}

// ---------- C4 CHANGELOG 中英版本序列一致 ----------
{
  const versions = (p) => [...read(p).matchAll(/^## (\d+\.\d+\.\d+)/gm)].map(m => m[1])
  const vz = versions('CHANGELOG.md')
  const ve = versions('CHANGELOG.en.md')
  if (vz.length === 0) fail('C4 changelog versions', 'CHANGELOG.md has no version headings')
  else if (vz.join(',') !== ve.join(',')) fail('C4 changelog versions', 'zh=' + vz.join(',') + ' en=' + ve.join(','))
  else ok('C4 changelog versions (' + vz.length + ')')
}

// ---------- C5 package.json 版本 vs CHANGELOG 首条 ----------
{
  const pkg = JSON.parse(read('package.json'))
  const first = (read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)([^\n]*)/m) || [])
  const head = read('CHANGELOG.md').split('\n').find(l => /^## \d+\.\d+\.\d+/.test(l)) || ''
  const unreleased = /未发布|unreleased/i.test(head)
  if (first[1] === undefined) fail('C5 package vs changelog', 'no changelog version heading')
  else if (first[1] === pkg.version || (unreleased && first[1] !== pkg.version)) ok('C5 package vs changelog (' + pkg.version + ' / ' + first[1] + (unreleased ? ' unreleased' : '') + ')')
  else fail('C5 package vs changelog', 'package=' + pkg.version + ' changelog-first=' + first[1] + ' (not marked unreleased)')
}

// ---------- C6 README 版本小节是 CHANGELOG 版本集合的子集，且中英一致 ----------
{
  const sectionVersions = (p) => [...read(p).matchAll(/^### (\d+\.\d+\.\d+)/gm)].map(m => m[1])
  const rz = sectionVersions('README.md')
  const re = sectionVersions('README.en.md')
  const ch = [...read('CHANGELOG.md').matchAll(/^## (\d+\.\d+\.\d+)/gm)].map(m => m[1])
  const notInChangelog = rz.filter(v => !ch.includes(v))
  if (rz.join(',') !== re.join(',')) fail('C6 readme version sections', 'zh=' + rz.join(',') + ' en=' + re.join(','))
  else if (notInChangelog.length) fail('C6 readme version sections', 'not in CHANGELOG: ' + notInChangelog.join(','))
  else ok('C6 readme version sections (' + rz.length + ')')
}

// ---------- C7 过期标记扫描（README/docs，排除 CHANGELOG） ----------
{
  const files = ['README.md', 'README.en.md',
    ...readdirSync(resolve(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)]
  const bad = []
  for (const f of files) {
    const text = read(f)
    for (const marker of ['HOLD', '待用户批准', '待发布', '仍 HOLD']) {
      if (text.includes(marker)) bad.push(f + ' contains "' + marker + '"')
    }
  }
  if (bad.length === 0) ok('C7 no stale HOLD/pending markers')
  else fail('C7 no stale markers', bad.join('; '))
}

// ---------- C8 不变量 I1–I7 中英各 7 行 ----------
{
  const count = (p) => (read(p).match(/^\| I[1-7] \|/gm) || []).length
  const nz = count('docs/PHILOSOPHY.md')
  const ne = count('docs/PHILOSOPHY.en.md')
  if (nz === 7 && ne === 7) ok('C8 invariants I1-I7 (7/7)')
  else fail('C8 invariants I1-I7', 'zh=' + nz + ' en=' + ne)
}

// ---------- C9 L1/L2/L3 术语映射中英各 3 行 ----------
{
  const has = (p, re) => re.test(read(p))
  const rezh = /\| L1 \/|L1 \/ 管理线/, reen = /L1 \/ manager line/
  if (has('docs/PHILOSOPHY.md', rezh) && has('docs/PHILOSOPHY.en.md', reen)) ok('C9 L1/L2/L3 glossary mapping')
  else fail('C9 L1/L2/L3 glossary mapping', 'missing L1/L2/L3 mapping rows in PHILOSOPHY (zh+en)')
}

// ---------- C10 关键字段已文档化 ----------
{
  const need = [
    ['README.md', 'subteamPolicy'],
    ['docs/AGENT-TEAMS.md', 'subteamPolicy'],
    ['docs/AGENT-TEAMS.md', 'parentTaskId'],
    ['docs/AGENT-TEAMS.md', 'parentTaskRef'],
    ['docs/en/AGENT-TEAMS.md', 'parentTaskId'],
    ['docs/en/AGENT-TEAMS.md', 'parentTaskRef'],
  ]
  const bad = need.filter(([f, k]) => !read(f).includes(k)).map(([f, k]) => f + ' missing ' + k)
  if (bad.length === 0) ok('C10 key fields documented')
  else fail('C10 key fields documented', bad.join('; '))
}

// ---------- C11 禁用措辞 / 站点版本链接 ----------
{
  const bad = []
  for (const f of ['README.md', 'README.en.md', 'docs/AGENT-TEAMS.md', 'docs/en/AGENT-TEAMS.md']) {
    if (/UIUX 0\.6 的 ?bento/i.test(read(f))) bad.push(f + ' still says "UIUX 0.6 bento"')
  }
  for (const f of ['docs/index.html', 'docs/en/index.html']) {
    if (existsSync(resolve(ROOT, f)) && /releases\/tag\/v\d+\.\d+\.\d+/.test(read(f))) bad.push(f + ' links a fixed release tag (use releases/latest)')
  }
  if (bad.length === 0) ok('C11 wording & site links')
  else fail('C11 wording & site links', bad.join('; '))
}

// ---------- 输出 ----------
const json = process.argv.includes('--json')
if (json) {
  console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 1))
} else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'DOCS_CONSISTENCY: PASS (' + checks.length + ' checks)' : 'DOCS_CONSISTENCY: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
