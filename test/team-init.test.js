import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initTeamWorkspace, parseTeamGoal, readTeamGoal, readDecisions } from '../lib/team-init.js'

function temp() { return mkdtempSync(join(tmpdir(), 'agent-lines-team-init-')) }

test('initTeamWorkspace creates TEAM.md, charters, decisions README and registry (idempotent)', () => {
  const dir = temp()
  try {
    const lines = [{ label: 'manager', role: '负责人' }, { label: 'writer', role: '开发' }]
    const first = initTeamWorkspace({ teamRoot: dir, lines, managerLabel: 'manager', now: Date.parse('2026-11-10') })
    assert.ok(first.created.includes('TEAM.md'))
    assert.ok(first.created.includes('charters/manager.md'))
    assert.ok(first.created.includes('charters/writer.md'))
    assert.ok(first.created.includes('decisions/README.md'))
    assert.match(readFileSync(join(dir, 'charters/manager.md'), 'utf8'), /不直接执行/)
    const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'))
    assert.equal(registry.version, 1)
    assert.deepEqual(registry.lines.map(l => l.label).sort(), ['manager', 'writer'])
    const second = initTeamWorkspace({ teamRoot: dir, lines, managerLabel: 'manager' })
    assert.equal(second.created.length, 0)
    assert.ok(second.skipped.includes('TEAM.md'))
    const overwritten = initTeamWorkspace({ teamRoot: dir, lines, managerLabel: 'manager', overwrite: true })
    assert.ok(overwritten.updated.includes('TEAM.md'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('parse/read team goal reports missing fields honestly', () => {
  const dir = temp()
  try {
    const goalPath = join(dir, 'TEAM.md')
    writeFileSync(goalPath, '# 团队目标\n\n## 团队目标\n完成《长夜》创作\n## 简介\n小说团队\n## 规划\n本月完本\n## 计划节奏\n日更2章\n')
    const goal = readTeamGoal({ teamRoot: dir })
    assert.equal(goal.available, true)
    assert.equal(goal.objective, '完成《长夜》创作')
    assert.equal(goal.rhythm, '日更2章')
    assert.deepEqual(goal.missing, [])
    const missing = parseTeamGoal('# 团队目标\n## 团队目标\n暂无\n')
    assert.deepEqual(missing.missing, ['summary', 'plan', 'rhythm'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readDecisions parses decision markdown files', () => {
  const dir = temp()
  try {
    mkdirSync(join(dir, 'decisions'))
    writeFileSync(join(dir, 'decisions/d1.md'), '# 发布许可\n\n## 来源类型\n任务\n## 来源\n大任务 B\n## 背景\n终审完成\n## AGENT 分析\n缺改动说明\n## 影响 / 效果\n延迟 30 分钟\n## 决策建议\n同意并补说明\n')
    const list = readDecisions({ teamRoot: dir })
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'd1')
    assert.equal(list[0].sourceType, '任务')
    assert.equal(list[0].suggestion, '同意并补说明')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('readDecisions parses optional status (processed decisions)', () => {
  const dir = temp()
  try {
    mkdirSync(join(dir, 'decisions'), { recursive: true })
    writeFileSync(join(dir, 'decisions/d2.md'), '# 初始化留痕\n\n## 状态\n已采纳\n\n## 背景\n建团队\n\n## 决策建议\n已执行\n')
    const list = readDecisions({ teamRoot: dir })
    assert.equal(list.length, 1)
    assert.equal(list[0].status, '已采纳')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
