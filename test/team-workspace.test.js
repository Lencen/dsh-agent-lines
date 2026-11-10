import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCharter, loadTeamWorkspace, toProfileBlocks, REQUIRED_SECTIONS } from '../lib/team-workspace.js'

const FULL = [
  '# 写手（writer）章程',
  '',
  '> 归属：小说创作团 · label：writer · 上级：manager · 版本：v1.0 · 更新：2026-11-09',
  '',
  '## 1. 定位',
  '负责正文创作。',
  '',
  '## 2. 职责',
  '按大纲写初稿。',
  '',
  '## 3. 标准产出',
  '章节初稿、修订稿。',
  '',
  '## 4. 边界（不做什么）',
  '不擅自改大纲。',
  '',
  '## 5. 质量要求',
  '每章 2000 字以上。',
  '',
  '## 6. 协作接口',
  '上游大纲，下游校对。',
  '',
  '## 7. 调度与汇报规则',
  '只接管理线任务单。',
].join('\n')

test('parseCharter extracts header and the seven sections', () => {
  const parsed = parseCharter(FULL, { source: 'charters/writer.md' })
  assert.equal(parsed.header.name, '写手')
  assert.equal(parsed.header.label, 'writer')
  assert.equal(parsed.header.manager, 'manager')
  assert.equal(parsed.header.version, 'v1.0')
  assert.equal(parsed.header.updated, '2026-11-09')
  assert.equal(parsed.sections.positioning, '负责正文创作。')
  assert.equal(parsed.sections.responsibilities, '按大纲写初稿。')
  assert.equal(parsed.sections.outputs, '章节初稿、修订稿。')
  assert.equal(parsed.sections.boundaries, '不擅自改大纲。')
  assert.deepEqual(parsed.missingSections, [])
  assert.equal(parsed.updatedAt, Date.parse('2026-11-09'))
})

test('missing required sections are reported, not invented', () => {
  const parsed = parseCharter(FULL.replace('## 4. 边界（不做什么）\n不擅自改大纲。\n', ''), { source: 'charters/editor.md' })
  assert.deepEqual(parsed.missingSections, ['boundaries'])
  const blocks = toProfileBlocks(parsed)
  assert.equal(blocks.roleDefinition, '负责正文创作。')
  assert.equal(blocks.constraints, null)
})

test('loadTeamWorkspace maps labels to charter files and reports three missing states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-team-'))
  try {
    mkdirSync(join(dir, 'charters'))
    writeFileSync(join(dir, 'registry.json'), JSON.stringify({ version: 1, lines: [{ label: 'writer', name: '写手', charter: 'charters/writer.md' }] }))
    writeFileSync(join(dir, 'charters', 'writer.md'), FULL)
    const result = loadTeamWorkspace({ teamRoot: dir, lines: [{ label: 'writer' }, { label: 'editor' }] })
    assert.equal(result.enabled, true)
    assert.equal(result.charters.writer.status, 'ok')
    assert.equal(result.charters.writer.source, 'charters/writer.md')
    assert.equal(result.charters.editor.status, 'file-missing')
    assert.match(result.charters.editor.reason, /文件不存在/)
    assert.equal(result.lines.length, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('loadTeamWorkspace is disabled without teamRoot and reports root-missing', () => {
  assert.equal(loadTeamWorkspace({}).enabled, false)
  const result = loadTeamWorkspace({ teamRoot: '/tmp/agent-lines-no-such-dir-xyz' })
  assert.equal(result.enabled, true)
  assert.equal(result.error, 'root-missing')
})

test('REQUIRED_SECTIONS matches the four board blocks', () => {
  assert.deepEqual([...REQUIRED_SECTIONS], ['positioning', 'responsibilities', 'outputs', 'boundaries'])
})
