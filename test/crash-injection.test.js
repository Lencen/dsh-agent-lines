import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LineStore } from '../lib/store.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ITERATIONS = Number(process.env.CRASH_ITERATIONS ?? 100)

async function waitFor(fn, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await new Promise(r => setTimeout(r, 3))
  }
  return false
}

test('kill -9 during delivery converges; no unexplained messages', { timeout: 180000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-crash-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  const childCode = [
    "const { LineStore } = await import('" + join(ROOT, 'lib/store.js').replace(/\\/g, '/') + "');",
    "import { writeFileSync } from 'node:fs';",
    "const s = new LineStore(process.env.CRASH_DB);",
    "const rows = s.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 1, claimTimeoutMs: 0 });",
    "writeFileSync(process.env.CRASH_MARKER, JSON.stringify(rows.map(r => r.id)));",
    "setTimeout(() => process.exit(0), 10000);",
  ].join('\n')

  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-f', ttlMs: 600000 })
    store.acquire({ agentId: 'agent-demo', line: 'backend', sessionId: 's-b', instanceId: 'i-b', ttlMs: 600000 })
    for (let i = 0; i < ITERATIONS; i++) {
      store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'crash-' + i })
    }

    for (let i = 0; i < ITERATIONS; i++) {
      const marker = join(dir, 'claim-' + i + '.json')
      const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
        env: { ...process.env, CRASH_DB: dbPath, CRASH_MARKER: marker },
        stdio: 'ignore',
      })
      const exited = new Promise(resolveExit => child.on('exit', resolveExit))
      const claimed = await waitFor(() => existsSync(marker))
      child.kill('SIGKILL')
      await exited
      assert.ok(claimed, 'child ' + i + ' never claimed a message')
      // 模拟重启：下次 claim 会把超时的 claimed 重新排队
      store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 1, claimTimeoutMs: 0 })
    }

    // 收尾：把剩余排队消息全部投递并 ack
    for (let guard = 0; guard < ITERATIONS * 3; guard++) {
      const rows = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10, claimTimeoutMs: 0 })
      if (rows.length === 0) break
      for (const row of rows) {
        store.markDelivered(row.id, 'i-b')
        store.markAck({ agentId: 'agent-demo', line: 'backend', messageId: row.id })
      }
    }

    const all = store.messagesForLine({ agentId: 'agent-demo', line: 'backend', limit: ITERATIONS * 2 })
    assert.equal(all.length, ITERATIONS, 'messages lost or duplicated')
    const known = new Set(['queued', 'claimed', 'delivered', 'acked', 'failed', 'expired', 'pending_approval'])
    let unexplained = 0
    for (const row of all) {
      if (!known.has(row.state)) unexplained++
      const events = store.eventsForMessage(row.id)
      if (events.length === 0) unexplained++
    }
    assert.equal(unexplained, 0, 'unexplained messages: ' + unexplained)
    const remaining = all.filter(r => r.state !== 'acked')
    assert.equal(remaining.length, 0, 'not fully converged: ' + remaining.map(r => r.state).join(','))
    const counts = store.countsByState({ agentId: 'agent-demo', line: 'backend' })
    assert.equal(counts.acked, ITERATIONS)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
