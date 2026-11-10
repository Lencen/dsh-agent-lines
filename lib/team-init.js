/**
 * Team workspace initialization + goal/decision parsing (0.11.0).
 * Files are plain Markdown/JSON, read-only to the board; the manager owns updates.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const BT = String.fromCharCode(96)

function nowDate(now) {
  const d = new Date(now)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function sections(markdown) {
  const out = {}
  let cur = null
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2 !== null) { cur = h2[1].trim(); if (out[cur] === undefined) out[cur] = []; continue }
    if (cur !== null) out[cur].push(line)
  }
  const cleaned = {}
  for (const [k, v] of Object.entries(out)) { const body = v.join('\n').trim(); cleaned[k] = body.length ? body : null }
  return cleaned
}

function headerUpdated(markdown, fallback) {
  const m = /更新[：:]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(String(markdown ?? ''))
  if (m === null) return fallback
  const ms = Date.parse(m[1]); return Number.isFinite(ms) ? ms : fallback
}

export function parseTeamGoal(markdown, { source = null, updatedAt = null } = {}) {
  const s = sections(markdown)
  const pick = (...keys) => { for (const k of keys) if (s[k]) return s[k]; return null }
  const goal = {
    objective: pick('团队目标', '目标'),
    summary: pick('简介', '团队简介'),
    plan: pick('规划'),
    rhythm: pick('计划节奏', '节奏'),
    source: pick('来源') ?? source,
    updatedAt: headerUpdated(markdown, updatedAt),
    missing: [],
  }
  for (const key of ['objective', 'summary', 'plan', 'rhythm']) if (goal[key] === null) goal.missing.push(key)
  return goal
}

export function parseDecision(markdown, { id = null, source = null, updatedAt = null } = {}) {
  const s = sections(markdown)
  const titleLine = String(markdown ?? '').split(/\r?\n/).find(line => /^#\s+/.test(line)) ?? ''
  const pick = (...keys) => { for (const k of keys) if (s[k]) return s[k]; return null }
  return {
    id, source, title: titleLine.replace(/^#\s+/, '').trim() || id,
    sourceType: pick('来源类型', '类型'), sourceRef: pick('来源'),
    background: pick('背景'), analysis: pick('AGENT 分析', '分析'), impact: pick('影响', '影响 / 效果', '影响与效果'), suggestion: pick('决策建议', '建议'),
    updatedAt: headerUpdated(markdown, updatedAt),
  }
}

export function readTeamGoal({ teamRoot } = {}) {
  if (!teamRoot) return { available: false, objective: null, summary: null, plan: null, rhythm: null, source: null, missing: ['objective', 'summary', 'plan', 'rhythm'] }
  const path = join(resolve(teamRoot), 'TEAM.md')
  if (!existsSync(path)) return { available: false, objective: null, summary: null, plan: null, rhythm: null, source: 'TEAM.md', missing: ['objective', 'summary', 'plan', 'rhythm'] }
  const markdown = readFileSync(path, 'utf8')
  const parsed = parseTeamGoal(markdown, { source: 'TEAM.md', updatedAt: statSync(path).mtimeMs })
  return { available: true, ...parsed }
}

export function readDecisions({ teamRoot } = {}) {
  if (!teamRoot) return []
  const dir = join(resolve(teamRoot), 'decisions')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!/\.md$/.test(name) || name.toLowerCase() === 'readme.md') continue
    const path = join(dir, name)
    const markdown = readFileSync(path, 'utf8')
    out.push(parseDecision(markdown, { id: name.replace(/\.md$/, ''), source: 'decisions/' + name, updatedAt: statSync(path).mtimeMs }))
  }
  return out
}

const MANAGER_CHARTER = [
  '# 团队负责人（manager）章程', '',
  '> 归属：团队 · label：manager · 上级：用户 · 版本：v1.0 · 更新：{DATE}', '',
  '## 1. 定位', '只做需求对接、任务拆解、调度分配、资源协调与沟通协调，不直接执行具体任务。', '',
  '## 2. 职责', '1) 接收用户需求，确认目标与优先级；2) 把需求拆解成任务并分配给合适的线/成员；3) 调度跨线依赖、协调冲突；4) 从与用户沟通中提炼团队目标/简介/规划/计划节奏并更新 TEAM.md；5) 跟踪进度、处理升级与验收。', '',
  '## 3. 标准产出', '任务单、分配记录、验收结论、升级与决策记录。', '',
  '## 4. 边界（不做什么）', '不直接执行任务、不替代成员产出；不执行具体交付类工具，仅使用编排类工具派单与协调。', '',
  '## 5. 质量要求', '交付验收与风险升级，任务来源与决策记录可追溯。', '',
  '## 6. 协作接口', '上游用户；下游各角色线。', '',
  '## 7. 调度与汇报规则', '按优先级分配；阻塞升级给用户。', '',
].join('\n')

function lineCharter({ label, role, managerLabel, date, name }) {
  return [
    '# ' + (name || label) + '（' + label + '）章程', '',
    '> 归属：团队 · label：' + label + ' · 上级：' + managerLabel + ' · 角色：' + (role || label) + ' · 版本：v1.0 · 更新：' + date, '',
    '## 1. 定位', '（未采集：请负责人补充）', '',
    '## 2. 职责', '（未采集：请负责人补充）', '',
    '## 3. 标准产出', '（未采集）', '',
    '## 4. 边界（不做什么）', '（未采集）', '',
    '## 5. 质量要求', '（未采集）', '',
    '## 6. 协作接口', '（未采集）', '',
    '## 7. 调度与汇报规则', '（未采集）', '',
  ].join('\n')
}

const TEAM_MD = [
  '# 团队目标', '',
  '> 更新：{DATE} · 来源：负责人从与用户对话中提炼', '',
  '## 团队目标', '暂无整体目标', '',
  '## 简介', '暂无简介', '',
  '## 规划', '暂无规划', '',
  '## 计划节奏', '暂无计划', '',
].join('\n')

const DECISIONS_README = [
  '# 决策记录（decisions/）', '',
  '由负责人/agent 从任务或沟通中提炼，每个决策一个 Markdown 文件：', '',
  '## 来源类型', '任务 / 沟通', '',
  '## 来源', '任务名或消息引用', '',
  '## 背景', '', '## AGENT 分析', '', '## 影响 / 效果', '', '## 决策建议', '',
  '缺失字段看板显示“暂无/不可得”，不编造。',
].join('\n')

export function initTeamWorkspace({ teamRoot, lines = [], managerLabel = 'manager', overwrite = false, now = Date.now() } = {}) {
  if (!teamRoot || String(teamRoot).trim() === '') throw new Error('teamRoot is required and must not be empty')
  const root = resolve(String(teamRoot).trim())
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'charters'), { recursive: true })
  mkdirSync(join(root, 'decisions'), { recursive: true })
  const date = nowDate(now)
  const created = []
  const skipped = []
  const updated = []
  const write = (rel, body) => {
    const path = join(root, rel)
    if (existsSync(path) && !overwrite) { skipped.push(rel); return }
    const exists = existsSync(path)
    writeFileSync(path, body)
    if (exists) updated.push(rel); else created.push(rel)
  }
  write('TEAM.md', TEAM_MD.replace('{DATE}', date))
  write('charters/manager.md', MANAGER_CHARTER.replace('{DATE}', date))
  const labels = new Set([managerLabel])
  for (const line of lines) {
    const label = line?.label
    if (!label || labels.has(label)) continue
    labels.add(label)
    write('charters/' + label + '.md', lineCharter({ label, role: line.role, managerLabel, date, name: line.title }))
  }
  write('decisions/README.md', DECISIONS_README)
  const registryPath = join(root, 'registry.json')
  let registry = null
  try { registry = JSON.parse(readFileSync(registryPath, 'utf8')) } catch { registry = null }
  const base = registry && typeof registry === 'object' ? registry : {}
  const existingLines = Array.isArray(base.lines) ? base.lines : []
  const byLabel = new Map(existingLines.filter(x => x && x.label).map(x => [String(x.label), x]))
  for (const label of labels) {
    const prev = byLabel.get(label) ?? {}
    byLabel.set(label, { ...prev, label, name: prev.name ?? (label === managerLabel ? '团队负责人' : label), charter: prev.charter ?? 'charters/' + label + '.md' })
  }
  const merged = { ...base, version: base.version ?? 1, lines: [...byLabel.values()] }
  const serialized = JSON.stringify(merged, null, 2) + '\n'
  const before = existsSync(registryPath) ? readFileSync(registryPath, 'utf8') : null
  if (before !== serialized) { writeFileSync(registryPath, serialized); if (before === null) created.push('registry.json'); else updated.push('registry.json') }
  else skipped.push('registry.json')
  return { root, created, skipped, updated, managerLabel, date }
}
