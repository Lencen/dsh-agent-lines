/**
 * Team workspace reader (0.11.0 S5a).
 *
 * Reads the optional team workspace (registry.json + charters/*.md) so the board
 * can show role cards without a DB migration. Read-only: this module never writes.
 * Convention: docs/TEAM-WORKSPACE.md (v0).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const REQUIRED_SECTIONS = Object.freeze(['positioning', 'responsibilities', 'outputs', 'boundaries'])

const SECTION_TITLES = [
  [/定位/, 'positioning'],
  [/职责/, 'responsibilities'],
  [/标准产出/, 'outputs'],
  [/质量要求/, 'quality'],
  [/边界/, 'boundaries'],
  [/协作接口/, 'collaboration'],
  [/调度/, 'dispatch'],
]

function headerField(headerLines, key) {
  const re = new RegExp(key + '\\s*[：:]\\s*([^·|]+)')
  for (const line of headerLines) {
    const match = re.exec(line)
    if (match !== null) return match[1].trim()
  }
  return null
}

/** Parse one charter markdown into a structured role card. Pure: no I/O. */
export function parseCharter(markdown, { source = null, updatedAt = null } = {}) {
  const text = String(markdown ?? '')
  const lines = text.split(/\r?\n/)
  const headerLines = lines.filter(line => /^\s*>/.test(line))
  const titleLine = lines.find(line => /^#\s+/.test(line)) ?? ''
  const title = titleLine.replace(/^#\s+/, '').trim()
  const nameMatch = /^(.+?)（([^）]+)）/.exec(title) ?? /^(.+?)\(([^)]+)\)/.exec(title)
  const header = {
    name: nameMatch === null ? (title || null) : nameMatch[1].trim(),
    label: headerField(headerLines, 'label') ?? (nameMatch === null ? null : nameMatch[2].trim()),
    manager: headerField(headerLines, '上级'),
    team: headerField(headerLines, '归属'),
    version: headerField(headerLines, '版本'),
    updated: headerField(headerLines, '更新'),
  }
  const sections = {}
  let current = null
  for (const line of lines) {
    const h2 = /^##\s+(?:\d+\.\s*)?(.+?)\s*$/.exec(line)
    if (h2 !== null) {
      current = null
      for (const [re, key] of SECTION_TITLES) {
        if (re.test(h2[1])) { current = key; break }
      }
      if (current !== null && sections[current] === undefined) sections[current] = []
      continue
    }
    if (current !== null && /^###\s+/.test(line) === false) sections[current].push(line)
  }
  const cleaned = {}
  for (const [key, value] of Object.entries(sections)) {
    const body = value.join('\n').trim()
    cleaned[key] = body.length === 0 ? null : body
  }
  const missingSections = REQUIRED_SECTIONS.filter(key => cleaned[key] === undefined || cleaned[key] === null)
  let updatedMs = updatedAt
  if (header.updated !== null) {
    const parsed = Date.parse(header.updated)
    if (Number.isFinite(parsed)) updatedMs = parsed
  }
  return { source, header, sections: cleaned, missingSections, updatedAt: updatedMs, parseError: null }
}

/** Map parsed charter sections to the four board blocks. */
export function toProfileBlocks(charter) {
  if (charter === null || charter === undefined) return null
  const requirements = [charter.sections.outputs, charter.sections.quality].filter(Boolean).join('\n')
  return {
    roleDefinition: charter.sections.positioning ?? null,
    workDefinition: charter.sections.responsibilities ?? null,
    requirements: requirements.length === 0 ? null : requirements,
    constraints: charter.sections.boundaries ?? null,
    source: charter.source,
    updatedAt: charter.updatedAt,
    missingSections: charter.missingSections,
  }
}

function safeStat(path) {
  try { return statSync(path) } catch { return null }
}

/**
 * Load a team workspace from disk (read-only).
 * Returns charters keyed by line label plus a per-line status:
 *   ok | section-missing | file-missing | read-error
 */
export function loadTeamWorkspace({ teamRoot, lines = [] } = {}) {
  if (teamRoot === undefined || teamRoot === null || String(teamRoot).trim() === '') {
    return { enabled: false, root: null, registry: null, charters: {}, lines: [] }
  }
  const root = resolve(String(teamRoot).trim())
  if (!existsSync(root)) {
    return { enabled: true, root, registry: null, charters: {}, lines: [], error: 'root-missing' }
  }
  let registry = null
  let registryError = null
  const registryPath = join(root, 'registry.json')
  if (existsSync(registryPath)) {
    try { registry = JSON.parse(readFileSync(registryPath, 'utf8')) } catch (error) { registryError = String(error?.message ?? error) }
  }
  const entries = new Map()
  const registryLines = registry !== null && Array.isArray(registry.lines) ? registry.lines : []
  for (const entry of registryLines) {
    const label = entry.label ?? entry.id
    if (label === undefined || label === null) continue
    entries.set(String(label), entry)
  }
  const labels = []
  for (const line of lines) {
    if (line && line.label !== undefined && !labels.includes(String(line.label))) labels.push(String(line.label))
  }
  for (const label of entries.keys()) {
    if (!labels.includes(label)) labels.push(label)
  }
  const charters = {}
  const summary = []
  for (const label of labels) {
    const entry = entries.get(label)
    const rel = entry !== undefined && entry.charter !== undefined
      ? String(entry.charter)
      : 'charters/' + label + '.md'
    const path = join(root, rel)
    const stat = safeStat(path)
    if (stat === null) {
      charters[label] = { label, status: 'file-missing', source: rel, reason: '文件不存在：' + rel, charter: null, registry: entry ?? null, updatedAt: null }
      summary.push({ label, status: 'file-missing', source: rel })
      continue
    }
    let markdown
    try { markdown = readFileSync(path, 'utf8') } catch (error) {
      charters[label] = { label, status: 'read-error', source: rel, reason: '读取失败：' + String(error?.message ?? error), charter: null, registry: entry ?? null, updatedAt: null }
      summary.push({ label, status: 'read-error', source: rel })
      continue
    }
    const parsed = parseCharter(markdown, { source: rel, updatedAt: stat.mtimeMs })
    const status = parsed.missingSections.length === 0 ? 'ok' : 'section-missing'
    charters[label] = {
      label, status, source: rel, reason: status === 'ok' ? null : '缺小节：' + parsed.missingSections.join(','),
      charter: parsed, registry: entry ?? null, updatedAt: parsed.updatedAt,
    }
    summary.push({ label, status, source: rel, updatedAt: parsed.updatedAt })
  }
  return { enabled: true, root, registry, registryError, charters, lines: summary }
}
