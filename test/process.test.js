import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { LineStore } from '../lib/store.js'

function waitFor(child, marker, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + marker + ': ' + out)), timeoutMs)
    child.stdout.on('data', chunk => {
      out += chunk.toString()
      if (out.includes(marker)) { clearTimeout(timer); resolve(out) }
    })
    child.on('exit', code => {
      if (!out.includes(marker)) { clearTimeout(timer); reject(new Error('receiver exited ' + code + ': ' + out)) }
    })
  })
}

test('two processes exchange 100 messages without duplicates or loss', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-proc-'))
  const dbPath = join(dir, 'lines.db')
  const parent = new LineStore(dbPath)
  let child
  try {
    parent.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 'session-frontend', instanceId: 'parent', ttlMs: 30_000 })
    child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures', 'receiver.js'), dbPath, 'child', '100'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitFor(child, 'READY')
    for (let i = 0; i < 100; i += 1) {
      parent.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'm' + i })
    }
    const output = await waitFor(child, 'DELIVERED=100', 15000)
    assert.match(output, /DELIVERED=100/)
    const count = parent.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE state = 'delivered'").get()
    assert.equal(Number(count.n), 100)
    const dupes = parent.db.prepare("SELECT COUNT(*) AS n FROM (SELECT id FROM messages GROUP BY id HAVING COUNT(*) > 1)").get()
    assert.equal(Number(dupes.n), 0)
  } finally {
    child?.kill('SIGTERM')
    parent.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
