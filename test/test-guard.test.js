import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const guard = fileURLToPath(new URL('../scripts/check-test-set.mjs', import.meta.url))

test('test-set guard passes in the repository', () => {
  const out = execFileSync(process.execPath, [guard], { cwd: process.cwd(), encoding: 'utf8' })
  assert.match(out, /unit test set:/)
})

test('test-set guard fails closed when test/ is absent (npm package case)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-guard-'))
  try {
    assert.throws(() => execFileSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }), /no unit tests found/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
