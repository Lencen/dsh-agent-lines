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
import { execFileSync } from 'node:child_process'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { guardArgs } from './lib/args-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 参数 fail-closed 守卫必须早于任何读文件/检查（0.14.2 C7.1/C7.2）
guardArgs({
  script: 'check-docs-consistency.mjs',
  known: ['--json', '--package <path>'],
  description: '文档一致性门禁：中英配对、版本序列、错误码表、README/CHANGELOG/站点声明与代码一致（fail-closed）',
  argHelp: { '--json': '以 JSON 输出全部检查项与失败明细', '--package': '指定被解析的 package.json（C17 派生清单用；默认仓库根 package.json）' },
  examples: [
    'node scripts/check-docs-consistency.mjs',
    'node scripts/check-docs-consistency.mjs --json',
  ],
})
const failures = []
const checks = []
function ok(name, detail = '') { checks.push({ name, pass: true, detail }) }
function fail(name, detail) { checks.push({ name, pass: false, detail }); failures.push(name + ': ' + detail) }
function read(p) { return readFileSync(resolve(ROOT, p), 'utf8') }

// ---------- 文件清单 ----------
const PAIRS = [
  ['docs/TEAM-WORKSPACE.md', 'docs/TEAM-WORKSPACE.en.md'],
  ['README.md', 'README.en.md'],
  ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ['docs/PHILOSOPHY.md', 'docs/PHILOSOPHY.en.md'],
  ['docs/关于AI组织的思考与探索.md', 'docs/en/THOUGHTS-ON-AI-ORGANIZATION.md'],
  ['docs/从流程到岗位.md', 'docs/en/FROM-WORKFLOW-TO-POSITION.md'],
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
  const versions = (p) => [...read(p).matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm)].map(m => m[1])
  const vz = versions('CHANGELOG.md')
  const ve = versions('CHANGELOG.en.md')
  if (vz.length === 0) fail('C4 changelog versions', 'CHANGELOG.md has no version headings')
  else if (vz.join(',') !== ve.join(',')) fail('C4 changelog versions', 'zh=' + vz.join(',') + ' en=' + ve.join(','))
  else ok('C4 changelog versions (' + vz.length + ')')
}

// ---------- C5 package.json 版本 vs CHANGELOG 首条 ----------
{
  const pkg = JSON.parse(read('package.json'))
  const first = (read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)([^\n]*)/m) || [])
  const head = read('CHANGELOG.md').split('\n').find(l => /^## \d+\.\d+\.\d+/.test(l)) || ''
  const unreleased = /未发布|unreleased/i.test(head)
  if (first[1] === undefined) fail('C5 package vs changelog', 'no changelog version heading')
  else if (first[1] === pkg.version || (unreleased && first[1] !== pkg.version)) ok('C5 package vs changelog (' + pkg.version + ' / ' + first[1] + (unreleased ? ' unreleased' : '') + ')')
  else fail('C5 package vs changelog', 'package=' + pkg.version + ' changelog-first=' + first[1] + ' (not marked unreleased)')
}

// ---------- C6 README 版本小节是 CHANGELOG 版本集合的子集，且中英一致 ----------
{
  const sectionVersions = (p) => [...read(p).matchAll(/^### (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm)].map(m => m[1])
  const rz = sectionVersions('README.md')
  const re = sectionVersions('README.en.md')
  const ch = [...read('CHANGELOG.md').matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm)].map(m => m[1])
  const notInChangelog = rz.filter(v => !ch.includes(v))
  if (rz.join(',') !== re.join(',')) fail('C6 readme version sections', 'zh=' + rz.join(',') + ' en=' + re.join(','))
  else if (notInChangelog.length) fail('C6 readme version sections', 'not in CHANGELOG: ' + notInChangelog.join(','))
  else ok('C6 readme version sections (' + rz.length + ')')
}

// ---------- C6b README 覆盖最近发布版本（防版本小节过期） ----------
{
  const pkgVersion = JSON.parse(read('package.json')).version
  const sections = [...read('README.md').matchAll(/^### (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm)].map(m => m[1])
  const isInternalBuild = (v) => /^\d+\.\d+\.\d+-\d+$/.test(v)
  const changelogVersions = [...read('CHANGELOG.md').matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm)].map(m => m[1]).filter(v => !isInternalBuild(v))
  const required = [...new Set([pkgVersion, ...changelogVersions.filter(v => v !== pkgVersion).slice(0, 3)])]
  const missing = required.filter(v => !sections.includes(v))
  if (missing.length) fail('C6b readme covers recent versions', 'missing: ' + missing.join(','))
  else ok('C6b readme covers recent versions (' + required.join(',') + ')')
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
    ['docs/AGENT-TEAMS.md', 'byTaskRef'],
    ['docs/AGENT-TEAMS.md', 'nullTaskRefCount'],
    ['docs/en/AGENT-TEAMS.md', 'parentTaskId'],
    ['docs/en/AGENT-TEAMS.md', 'parentTaskRef'],
    ['docs/en/AGENT-TEAMS.md', 'byTaskRef'],
    ['docs/en/AGENT-TEAMS.md', 'nullTaskRefCount'],
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

// ---------- C12 设计思想网页版（中/英）与 md/版本一致 ----------
{
  const pkg = JSON.parse(read('package.json'))
  const pages = ['docs/philosophy.html', 'docs/en/philosophy.html']
  const bad = []
  for (const p of pages) {
    if (!existsSync(resolve(ROOT, p))) { bad.push(p + ' missing'); continue }
    const html = read(p)
    for (const inv of ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']) {
      if (!html.includes(inv)) bad.push(p + ' missing invariant ' + inv)
    }
    if (!/dsh-agent-lines\s+\d+\.\d+\.\d+/.test(html)) bad.push(p + ' missing version marker')
    else {
      const v = (html.match(/dsh-agent-lines\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/) || [])[1]
      if (v !== pkg.version) bad.push(p + ' version ' + v + ' != package.json ' + pkg.version)
    }
    if (!/PHILOSOPHY\.md|PHILOSOPHY\.en\.md/.test(html)) bad.push(p + ' does not link the markdown source of truth')
    // 相对链接存在性
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1]
      if (/^(https?:|mailto:|#)/.test(href)) continue
      const target = href.split('#')[0]
      if (target === '' || target === './') continue
      if (!existsSync(resolve(ROOT, dirname(p), target))) bad.push(p + ' broken link ' + href)
    }
  }
  if (bad.length === 0) ok('C12 philosophy web pages (zh/en, invariants, version, links)')
  else fail('C12 philosophy web pages', bad.join('; '))
}

// ---------- C12b 设计思想白话版（小白友好） ----------
{
  const bad = []
  const pkgVersion = JSON.parse(read('package.json')).version
  for (const [rel, keyword] of [['docs/philosophy-plain.html', '白话'], ['docs/en/philosophy-plain.html', 'plain language']]) {
    if (!existsSync(resolve(ROOT, rel))) { bad.push(rel + ' missing'); continue }
    const html = read(rel)
    if (!html.includes(pkgVersion)) bad.push(rel + ' version != package.json')
    if (!html.includes(keyword)) bad.push(rel + ' missing keyword ' + keyword)
    if (!html.includes('philosophy.html')) bad.push(rel + ' must link the full philosophy page')
  }
  for (const rel of ['docs/index.html', 'docs/en/index.html']) {
    if (!read(rel).includes('philosophy-plain.html')) bad.push(rel + ' missing plain-version link')
  }
  const zhIndex = read('docs/index.html')
  const labels = (zhIndex.match(/>设计思想</g) || []).length
  if (labels !== 1) bad.push('docs/index.html must have exactly one 设计思想 nav entry (got ' + labels + ')')
  if (bad.length === 0) ok('C12b plain-language philosophy pages (zh/en, version, links, single entry)')
  else fail('C12b plain-language philosophy pages', bad.join('; '))
}

// ---------- C13 AGENTS.md 与代码一致（防 AI 契约漂移） ----------
{
  const bad = []
  if (!existsSync(resolve(ROOT, 'AGENTS.md'))) bad.push('AGENTS.md missing')
  else {
    const agents = read('AGENTS.md')
    const tools = read('lib/tools.js')
    const actualTools = [...new Set([...tools.matchAll(/name: '(line_[a-z_]+)'/g)].map(m => m[1]))].sort()
    // 1) 工具数量声明
    const claim = agents.match(/\((\d+) tools\)/)
    if (claim === null) bad.push('AGENTS.md missing "(N tools)" claim')
    else if (Number(claim[1]) !== actualTools.length) bad.push('AGENTS.md claims ' + claim[1] + ' tools but code has ' + actualTools.length)
    // 2) 声明的工具都存在，且每个工具都被提到
    // 豁免 DB 表/列等非工具标识（工具名与表名都可能以 line_ 开头）
    const NON_TOOL_IDS = new Set(['line_events', 'line_id', 'line_ids'])
    const mentioned = new Set([...agents.matchAll(/`(line_[a-z_]+)`/g)].map(m => m[1]).filter(id => !NON_TOOL_IDS.has(id)))
    for (const t of mentioned) if (!actualTools.includes(t)) bad.push('AGENTS.md mentions unknown tool ' + t)
    for (const t of actualTools) if (!mentioned.has(t)) bad.push('AGENTS.md omits tool ' + t)
    // 3) schema 版本与代码一致
    const sv = agents.match(/Schema version \| \*\*(\d+)\*\*/)
    const codeSv = (read('lib/store.js').match(/PRAGMA user_version = (\d+);/) || [])[1]
    if (sv === null) bad.push('AGENTS.md missing schema version')
    else if (sv[1] !== codeSv) bad.push('AGENTS.md schema ' + sv[1] + ' != store.js ' + codeSv)
    // 4) 引擎版本与 package.json 一致
    const pkg = JSON.parse(read('package.json'))
    for (const [label, ver] of [['node', pkg.engines?.node], ['dsh', pkg.engines?.dsh]]) {
      if (ver !== undefined && !agents.includes(ver)) bad.push('AGENTS.md missing ' + label + ' range ' + ver)
    }
    // 5) 配置键表与代码一致
    const section = (agents.split('## 2. Configuration keys')[1] || '').split('\n## ')[0]
    const keys = [...section.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \|/gm)].map(m => m[1])
    if (keys.length === 0) bad.push('AGENTS.md config table not parsed')
    const indexJs = read('lib/index.js')
    for (const k of keys) {
      const known = k === 'lines' || new RegExp('(^|[^a-zA-Z])' + k + '([^a-zA-Z]|$)').test(indexJs)
      if (!known) bad.push('AGENTS.md documents unknown config key ' + k)
    }
    for (const k of ['createFrom', 'allowCreate', 'allowClaim', 'maxLines', 'ackTimeoutMs', 'bootstrapOnCreate', 'dbPath', 'transport']) {
      if (!keys.includes(k)) bad.push('AGENTS.md config table omits ' + k)
    }
    // 6) AGENTS.md 内相对链接可解析
    for (const m of agents.matchAll(/\]\(([^)]+)\)/g)) {
      const href = m[1]
      if (/^(https?:|mailto:|#)/.test(href)) continue
      const target = href.split('#')[0]
      if (!target) continue
      if (!existsSync(resolve(ROOT, target))) bad.push('AGENTS.md broken link ' + href)
    }
  }
  if (bad.length === 0) ok('C13 AGENTS.md matches code (tools/schema/engines/config keys/links)')
  else fail('C13 AGENTS.md matches code', bad.join('; '))
}

// ---------- C14 发布声明内部一致（防"包 0.12.0、站点 0.11.6"） ----------
{
  const noteZh = read('docs/index.html').match(/最新版本：<b>v(\d+\.\d+\.\d+)<\/b>/)
  const noteEn = read('docs/en/index.html').match(/Latest version: <b>v(\d+\.\d+\.\d+)<\/b>/)
  const miz = JSON.parse(read('docs/market-index.json')).plugins?.[0] ?? {}
  const mie = JSON.parse(read('examples/market-index.json')).plugins?.[0] ?? {}
  const vals = {
    'docs/index.html': noteZh === null ? null : noteZh[1],
    'docs/en/index.html': noteEn === null ? null : noteEn[1],
    'docs/market-index.json#dist-tags.latest': miz['dist-tags']?.latest ?? null,
    'docs/market-index.json#versions[0]': miz.versions?.[0]?.version ?? null,
    'examples/market-index.json#dist-tags.latest': mie['dist-tags']?.latest ?? null,
    'examples/market-index.json#versions[0]': mie.versions?.[0]?.version ?? null,
  }
  const missing = Object.entries(vals).filter(([, v]) => v === null || v === undefined).map(([k]) => k)
  const values = [...new Set(Object.values(vals).filter(v => v !== null && v !== undefined))]
  if (missing.length) fail('C14 release claims present', 'missing: ' + missing.join(','))
  else if (values.length !== 1) fail('C14 release claims consistent', JSON.stringify(vals))
  else ok('C14 release claims consistent (' + values[0] + ')')
}

// ---------- C14b 发布声明 == 最高 git tag（防"未发布却说已发布"） ----------
{
  const released = (read('docs/index.html').match(/最新版本：<b>v(\d+\.\d+\.\d+)<\/b>/) || [])[1] ?? null
  let tags = []
  try {
    tags = execFileSync('git', ['tag', '--sort=-v:refname'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
      .split('\n').map(t => t.trim()).filter(Boolean).map(t => t.replace(/^v/, ''))
  } catch { tags = [] }
  if (tags.length === 0) {
    checks.push({ name: 'C14b release claims match tag', pass: true, detail: 'SKIP (no git tag available)' })
    console.log('SKIP C14b release claims match tag (no git tag available)')
  } else if (released === null) {
    fail('C14b release claims match tag', 'no released version parsed from docs/index.html')
  } else if (released !== tags[0]) {
    fail('C14b release claims match tag', 'released=' + released + ' tag=' + tags[0] + '（按发布序列：commit→打 tag→复跑门禁→publish）')
  } else {
    ok('C14b release claims match tag (' + released + ')')
  }
}

// ---------- D1 错误码表覆盖（代码 ↔ 中英表三向一致） ----------
{
  const codeSrc = read('lib/tools.js') + read('lib/store.js') + read('lib/index.js') + read('lib/protocol.js') + read('lib/delivery.js') + read('lib/team-workspace.js') + read('lib/capabilities.js') + read('bin/dsh-agent-lines.js')
  const codeSet = new Set([...codeSrc.matchAll(/LINE_[A-Z0-9_]+/g)].map(m => m[0]).filter(c => c !== 'LINE_RE'))
  const tableSet = (p) => new Set(read(p).split('\n').filter(l => l.startsWith('|')).flatMap(l => [...l.matchAll(/LINE_[A-Z0-9_]+/g)].map(m => m[0])))
  const zh = tableSet('docs/PROTOCOL.md')
  const en = tableSet('docs/PROTOCOL.en.md')
  const missingZh = [...codeSet].filter(c => !zh.has(c)).sort()
  const ghostZh = [...zh].filter(c => !codeSet.has(c)).sort()
  const missingEn = [...codeSet].filter(c => !en.has(c)).sort()
  const ghostEn = [...en].filter(c => !codeSet.has(c)).sort()
  const zhEnDiff = [...new Set([...[...zh].filter(c => !en.has(c)).map(c => 'zh-only:' + c), ...[...en].filter(c => !zh.has(c)).map(c => 'en-only:' + c)])].sort()
  const bad = []
  if (missingZh.length) bad.push('missing in zh: ' + missingZh.join(','))
  if (ghostZh.length) bad.push('ghost in zh: ' + ghostZh.join(','))
  if (missingEn.length) bad.push('missing in en: ' + missingEn.join(','))
  if (ghostEn.length) bad.push('ghost in en: ' + ghostEn.join(','))
  if (zhEnDiff.length) bad.push('zh/en differ: ' + zhEnDiff.join(','))
  if (bad.length === 0) ok('D1 error-code table covers code (' + codeSet.size + ')')
  else fail('D1 error-code table covers code', bad.join('; '))
}

// ---------- C15 README 当前发布版本 == package.json version（防状态描述过期） ----------
{
  const pkgVersion = JSON.parse(read('package.json')).version
  const targets = [
    ['README.md', /当前发布[：:]\s*v?(\d+\.\d+\.\d+)/],
    ['README.en.md', /Current release[：:]\s*v?(\d+\.\d+\.\d+)/],
  ]
  const bad = []
  for (const [file, re] of targets) {
    const m = read(file).match(re)
    if (!m) bad.push(file + ': 未找到「当前发布/Current release」版本行')
    else if (m[1] !== pkgVersion) bad.push(file + ': ' + m[1] + '（expect ' + pkgVersion + '）')
  }
  if (bad.length === 0) ok('C15 README current release matches package.json (' + pkgVersion + ')')
  else fail('C15 README current release matches package.json', bad.join('; '))
}

// ---------- C16 README 版本小节「未发布候选」不得用于已发布版本（防文档漂移） ----------
{
  const pkgVersion = JSON.parse(read('package.json')).version
  let tags = []
  try {
    tags = execFileSync('git', ['tag', '--sort=-v:refname'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
      .split(String.fromCharCode(10))
      .map(t => t.trim()).filter(Boolean).map(t => t.replace(/^v/, ''))
  } catch { tags = [] }
  const released = new Set([pkgVersion, ...tags])
  const bad = []
  let scanned = 0
  let releasedHit = 0
  for (const file of ['README.md', 'README.en.md']) {
    const lines = read(file).split(String.fromCharCode(10))
    for (const line of lines) {
      const m = line.match(/^###\s+(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?/)
      if (!m) continue
      scanned += 1
      if (released.has(m[1])) releasedHit += 1
      if (!/未发布候选|unreleased candidate/i.test(line)) continue
      if (released.has(m[1])) bad.push(file + ': ' + m[1] + ' 已是发布版本（package/tag），不得标「未发布候选」')
    }
  }
  if (bad.length > 0) fail('C16 README unreleased-candidate only for unreleased versions', bad.join('; '))
  else if (scanned < 1) fail('C16 未扫到任何版本小节（README 结构可能已变），判据空扫', 'scanned=0')
  else if (releasedHit < 1) fail('C16 未扫到任何已发布版本小节，判据可能假绿', 'scanned=' + scanned + ' releasedHit=0')
  else ok('C16 README unreleased-candidate only for unreleased versions (scanned=' + scanned + ', releasedHit=' + releasedHit + ')')
}

// ---------- C17 门禁脚本参数 fail-closed（0.14.2 QA C7.1/C7.2/C7.6/C7.8：清单从 package.json 派生，N 脚本 x {--bogus-arg,--help} + 路径取值 fail-closed；不写死任何脚本名单） ----------
{
  // 探针会再起这些脚本的子进程；若某脚本的守卫将来被删（回归），子进程会跑完整检查并可能再次进入本段
  // -> 递归 fork（docs 探 docs 无限套）。故：本进程若本身是「探针调用」（argv 带探针参数），说明参数解析已经
  // 失效（否则守卫早就 exit 3/0 了），此时跳过 C17 —— 回归表现为父层 C17 红，而不是进程风暴。
  // 正常调用（无参数 / --json）不带探针参数，C17 必然执行，无法被环境变量或开关绕过。
  // 子进程额外带 DSH_GATE_ARGS_PROBE=1 仅作探针标记（便于排查），**不作为跳过条件** —— 否则等于给 C17 开后门。
  const PROBE_ENV = 'DSH_GATE_ARGS_PROBE'
  const probeArgv = process.argv.slice(2)
  const isProbeInvocation = probeArgv.some((a) => a === '--bogus-arg' || a === '--help' || a === '-h')
  if (!isProbeInvocation) {
    // 1) 脚本清单从 package.json 派生（不硬编码，QA C7.8①）：npm test / test:unit / test:board-e2e 三段按 && 拆分去重。
    //    链上新接一个门禁脚本就自动纳入本判据。--package=<path> / --package <path> 只改「读哪份 package.json」
    //    （QA 用临时副本加 check-fake 反向验，不改仓库）；路径不存在已由 args-guard 拦成 exit 3。
    const pkgFlag = probeArgv.findIndex((a) => a === '--package' || a.startsWith('--package='))
    const pkgPath = pkgFlag < 0
      ? 'package.json'
      : (probeArgv[pkgFlag].includes('=') ? probeArgv[pkgFlag].slice(probeArgv[pkgFlag].indexOf('=') + 1) : probeArgv[pkgFlag + 1])
    const pkgScripts = JSON.parse(read(pkgPath)).scripts ?? {}
    const CHAIN_KEYS = ['test', 'test:unit', 'test:board-e2e']
    const derived = []
    for (const key of CHAIN_KEYS) {
      const chain = pkgScripts[key]
      if (typeof chain !== 'string') continue
      for (const part of chain.split('&&')) {
        for (const m of part.matchAll(/node scripts\/([\w.-]+\.mjs)/g)) {
          if (!derived.includes(m[1])) derived.push(m[1])
        }
      }
    }
    // 防空扫（不写死名单，QA C7.8①）：三条派生链必须都存在且非空；派生数下限拦住「链被掏空」。
    const MIN_DERIVED = 4
    const problems = []
    for (const key of CHAIN_KEYS) {
      const chain = pkgScripts[key]
      if (typeof chain !== 'string' || chain.trim() === '') problems.push('package.json scripts.' + key + ' 缺失或为空（派生链被掏空，判据空扫）')
    }
    if (derived.length === 0) problems.push('派生脚本数=0（' + pkgPath + ' 的 scripts 链未解析到任何 node scripts/*.mjs，判据空扫）')
    else if (derived.length < MIN_DERIVED) problems.push('派生脚本数=' + derived.length + ' < 下限 ' + MIN_DERIVED + '（链结构可能被改，判据接近空扫）')
    const jsonMode = probeArgv.includes('--json')
    if (!jsonMode) console.log('C17 派生门禁脚本数: ' + derived.length + ' -> ' + derived.join(', '))

    const scriptPath = (script) => resolve(ROOT, 'scripts', script)
    const isGuarded = (script) => existsSync(scriptPath(script)) && /guardArgs\s*\(/.test(read('scripts/' + script))
    // 判定行：行首 PASS/FAIL，或 "X: PASS (n checks)" 汇总行（0.14.1 的假绿形态）
    const hasVerdictLine = (text) => /^(?:PASS|FAIL) /m.test(text) || /: (?:PASS|FAIL) \(/.test(text)
    const probe = (script, argv) => {
      try {
        const stdout = execFileSync(process.execPath, [scriptPath(script), ...argv], {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 120000,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, [PROBE_ENV]: '1' },
        })
        return { status: 0, stdout: String(stdout), stderr: '' }
      } catch (error) {
        return {
          status: typeof error.status === 'number' ? error.status : -1,
          stdout: String(error.stdout ?? ''),
          stderr: String(error.stderr ?? ''),
        }
      }
    }

    // 2) 每个派生脚本都必须已接守卫：--bogus-arg -> exit 3 且无判定行；--help -> exit 0 且无判定行。
    //    未接守卫不做「静默跳过」（跳过 = 永远绿），而是显式 FAIL 并点名。
    for (const script of derived) {
      if (!existsSync(scriptPath(script))) {
        problems.push(script + ' 在 scripts/ 下不存在（package.json 链与文件不一致）')
        continue
      }
      if (!isGuarded(script)) {
        problems.push(script + ' 未接 guard（脚本顶部没有调用 args-guard.mjs 的 guardArgs）')
        continue
      }
      const bogus = probe(script, ['--bogus-arg'])
      const bogusAll = bogus.stdout + bogus.stderr
      if (bogus.status !== 3) problems.push(script + ' --bogus-arg exit=' + bogus.status + '（期望 3）')
      if (!/未知参数/.test(bogusAll)) problems.push(script + ' --bogus-arg 未提示「未知参数」')
      if (hasVerdictLine(bogus.stdout)) problems.push(script + ' --bogus-arg 仍打印 PASS/FAIL 判定行（假绿）')
      const help = probe(script, ['--help'])
      if (help.status !== 0) problems.push(script + ' --help exit=' + help.status + '（期望 0）')
      if (!help.stdout.includes(script)) problems.push(script + ' --help stdout 未含脚本名')
      if (!help.stdout.includes('--help')) problems.push(script + ' --help stdout 未含 --help')
      if (hasVerdictLine(help.stdout)) problems.push(script + ' --help 仍打印判定行（说明参数解析晚于检查）')
    }

    // 3) C7.4 取值是路径也必须 fail-closed，且「= 形式」必须解析（QA v0.7）：
    //    --file=<存在的文件> -> rc=0；--file=<不存在> 与空格形式不存在 -> rc=3（不得静默回落默认被检文件，也不得用 2）。
    //    目标不写死：从派生脚本源码里找「guardArgs 白名单声明了 --file <path>」的脚本，自动纳入矩阵。
    const FILE_FLAG_RE = /['"]--file\s+<[^>]+>['"]/
    const fileTargets = derived.filter((script) => existsSync(scriptPath(script)) && FILE_FLAG_RE.test(read('scripts/' + script)))
    if (fileTargets.length === 0) problems.push('未从派生脚本里推导出任何声明 --file <path> 的脚本（判据空扫）')
    for (const script of fileTargets) {
      const fileCases = [
        [['--file=web/nope.html'], 3],
        [['--file', 'web/nope.html'], 3],
        [['--file=web/board.html'], 0],
      ]
      for (const [fileArgv, expect] of fileCases) {
        const res = probe(script, fileArgv)
        const label = script + ' ' + fileArgv.join(' ')
        if (res.status !== expect) problems.push(label + ' exit=' + res.status + '（期望 ' + expect + '：= 形式必须解析，路径不存在必须 3 且不回落默认文件）')
        if (expect === 3 && hasVerdictLine(res.stdout)) problems.push(label + ' 仍打印 PASS/FAIL 判定行（静默回落默认文件=假绿）')
      }
    }

    if (problems.length === 0) ok('C17 门禁脚本参数 fail-closed（' + derived.length + ' scripts x 2 modes + --file 取值）')
    else fail('C17 门禁脚本参数 fail-closed', problems.join('; '))
  }
}

// ---------- C18 args-guard 入参自校验（0.14.2 QA C7.7 / Lead C18：防「脚本都调 guard、guard 自己不校验」的新假绿入口） ----------
{
  const probeArgv = process.argv.slice(2)
  const isProbeInvocation = probeArgv.some((a) => a === '--bogus-arg' || a === '--help' || a === '-h')
  if (!isProbeInvocation) {
    // 判据对象是 guard 本身：直接 import 后传非法声明，必须在子进程里非 0 退出且报错来自入参自校验。
    const guardUrl = pathToFileURL(resolve(ROOT, 'scripts/lib/args-guard.mjs')).href
    const cases = [
      ['guardArgs() 无入参', 'm.guardArgs()'],
      ['guardArgs({}) 缺 script', 'm.guardArgs({})'],
      ['guardArgs known 条目畸形', "m.guardArgs({ script: 'x.mjs', known: ['--ok <v>', 'not a flag'] })"],
    ]
    const problems = []
    for (const [label, expr] of cases) {
      const code = 'import(' + JSON.stringify(guardUrl) + ').then((m) => { ' + expr + ' })'
      let res
      try {
        execFileSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] })
        res = { status: 0, stderr: '' }
      } catch (error) {
        res = { status: typeof error.status === 'number' ? error.status : -1, stderr: String(error.stderr ?? '') }
      }
      if (res.status === 0) problems.push('args-guard 入参自校验缺失：' + label + ' 仍以 0 退出（假绿入口）')
      else if (!/guardArgs:/.test(res.stderr)) problems.push('args-guard 入参自校验异常路径不符：' + label + ' exit=' + res.status)
    }
    if (problems.length === 0) ok('C18 args-guard 入参自校验（' + cases.length + ' 条非法声明必须非 0 退出）')
    else fail('C18 args-guard 入参自校验', problems.join('; '))
  }
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
