import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LineStore } from '../lib/store.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'dsh-agent-lines.js')

function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-status-'))
  const db = join(dir, 'lines.db')
  const store = new LineStore(db)
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'writer', sessionId: 's-w', instanceId: 'i-w', ttlMs: 60000 })
  store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'writer', text: 'hello' })
  store.close()
  return { dir, db }
}

test('status --json prints a stable, versioned snapshot', () => {
  const { dir, db } = seed()
  try {
    const out = execFileSync(process.execPath, [BIN, '--db', db, '--json', 'status'], { encoding: 'utf8' })
    const payload = JSON.parse(out)
    assert.equal(payload.schemaVersion, 1)
    assert.equal(payload.protocolVersion, '0.4')
    assert.equal(payload.agent, 'agent-demo')
    assert.deepEqual(payload.lines.map(line => line.label).sort(), ['manager', 'writer'])
    assert.equal(payload.messages.total, 1)
    assert.ok(Array.isArray(payload.messages.byState))
    assert.ok(Array.isArray(payload.messages.trend))
    assert.ok(Array.isArray(payload.tokens.perDay))
    assert.equal(payload.teamWorkspace.enabled, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('status --json reads the optional team workspace', () => {
  const { dir, db } = seed()
  try {
    const root = join(dir, 'team')
    mkdirSync(join(root, 'charters'), { recursive: true })
    writeFileSync(join(root, 'registry.json'), JSON.stringify({ version: 1, lines: [{ label: 'writer', charter: 'charters/writer.md' }] }))
    writeFileSync(join(root, 'charters', 'writer.md'), '# 写手（writer）章程\n\n> 归属：T · label：writer · 上级：manager · 版本：v1 · 更新：2026-11-09\n\n## 1. 定位\n写正文。\n\n## 2. 职责\n写初稿。\n\n## 3. 标准产出\n初稿。\n\n## 4. 边界\n不改大纲。\n')
    const out = execFileSync(process.execPath, [BIN, '--db', db, '--json', 'status', '--team-root', root], { encoding: 'utf8' })
    const payload = JSON.parse(out)
    assert.equal(payload.teamWorkspace.enabled, true)
    const writer = payload.teamWorkspace.lines.find(item => item.label === 'writer')
    assert.equal(writer.status, 'ok')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
