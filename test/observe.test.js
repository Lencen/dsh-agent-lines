import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-observe-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('observe returns cross-line messages, filters and since', () => {
  const { store, cleanup } = tempStore()
  try {
    for (const [line, session] of [['manager', 'session-m'], ['frontend', 'session-f'], ['backend', 'session-b']]) {
      store.acquire({ agentId: 'agent-demo', line, sessionId: session, instanceId: 'i-' + line, ttlMs: 30000 })
    }
    const a = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'frontend', text: 'first' })
    const b = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'second' })
    store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'manager', text: 'same-line' })

    const all = store.observe({ agentId: 'agent-demo', limit: 10 })
    assert.equal(all.count, 2)
    assert.deepEqual(all.messages.map(m => m.id).sort(), [a.id, b.id].sort())
    assert.equal(all.messages[0].summary.length > 0, true)

    const filtered = store.observe({ agentId: 'agent-demo', line: 'frontend', limit: 10 })
    assert.equal(filtered.count, 2)

    const since = store.observe({ agentId: 'agent-demo', since: b.created_at + 1, limit: 10 })
    assert.equal(since.count, 0)
  } finally { cleanup() }
})
