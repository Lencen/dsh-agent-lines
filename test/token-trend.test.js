import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineStore } from '../lib/store.js'
import { registerToolsForAgent } from '../lib/tools.js'

const DAY = 86400000

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-tokens-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('recordTokenSample stores a line_event and is queryable', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    const id = store.recordTokenSample({ agentId: 'agent-demo', line: 'frontend', decodeTokens: 120, turns: 2, steps: 6, now: 1000 })
    const rows = store.tokenSamples({ agentId: 'agent-demo', line: 'frontend', since: 0, until: 2000 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, id)
    assert.equal(rows[0].action, 'token_sample')
    assert.equal(JSON.parse(rows[0].detail).decodeTokens, 120)
  } finally { cleanup() }
})

test('tokenTrend computes per-local-day increments and ignores counter resets', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    // UTC day 1: 23:50, UTC day 2: 00:10, then a reset (smaller counter) at 00:20
    const d1 = Date.UTC(2026, 0, 1, 23, 50)
    const d2 = Date.UTC(2026, 0, 2, 0, 10)
    const d3 = Date.UTC(2026, 0, 2, 0, 20)
    store.recordTokenSample({ agentId: 'agent-demo', line: 'frontend', decodeTokens: 100, now: d1 })
    store.recordTokenSample({ agentId: 'agent-demo', line: 'frontend', decodeTokens: 300, now: d2 })
    store.recordTokenSample({ agentId: 'agent-demo', line: 'frontend', decodeTokens: 50, now: d3 }) // reset -> 0
    const now = Date.UTC(2026, 0, 2, 1, 0)
    const trend = store.tokenTrend({ agentId: 'agent-demo', lines: ['frontend'], days: 7, now, tzOffsetMinutes: 0 })
    assert.equal(trend.samples, 3)
    assert.equal(trend.today, 200, 'today increment = 300 - 100')
    assert.deepEqual(trend.perDay, [{ date: '2026-01-02', tokens: 200 }])
    assert.equal(trend.lines[0].latest, 50)
    assert.equal(trend.lines[0].windowIncrement, 200)
  } finally { cleanup() }
})

test('tokenTrend returns empty trend when there are no samples', () => {
  const { store, cleanup } = tempStore()
  try {
    store.acquire({ agentId: 'agent-demo', line: 'frontend', sessionId: 's-f', instanceId: 'i-a', ttlMs: 60000 })
    const trend = store.tokenTrend({ agentId: 'agent-demo', lines: ['frontend'], days: 7, now: Date.UTC(2026, 0, 2), tzOffsetMinutes: 0 })
    assert.equal(trend.samples, 0)
    assert.deepEqual(trend.perDay, [])
    assert.equal(trend.today, 0)
    assert.equal(trend.lines[0].latest, null)
  } finally { cleanup() }
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-metrics-'))
  const dbPath = join(dir, 'lines.db')
  const store = new LineStore(dbPath)
  const config = {
    agentId: 'agent-demo', createFrom: 'manager', allowCreate: true, dbPath,
    dedupeWindowMs: 5000, maxReplyDepth: 8, allowSelfSend: true, bootstrapOnCreate: false,
    maxMessageBytes: 65536, ackTimeoutMs: 60000, tokenSampleMs: 60000, lines: [],
  }
  const lineDefs = new Map()
  const registered = new Map()
  const sessionId = 'session-manager'
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId, instanceId: 'i-m', ttlMs: 60000 })
  store.acquire({ agentId: 'agent-demo', line: 'worker', sessionId: 'session-worker', instanceId: 'i-w', ttlMs: 60000 })
  const def = { label: 'manager', agentId: 'agent-demo', sessionId, lineId: 'agent-demo#manager' }
  lineDefs.set(sessionId, def)
  lineDefs.set('session-worker', { label: 'worker', agentId: 'agent-demo', sessionId: 'session-worker', lineId: 'agent-demo#worker' })
  const projections = { snapshot: () => ({ values: { sessionStats: { decodeTokens: 1000, turns: 2, steps: 5 } } }) }
  const ctx = {
    tools: { register: (tool) => { registered.set(tool.name, tool); return () => {} } },
    agents: { get: () => ({ session: {} }), list: () => [] },
    get: (name) => (name === 'sessionProjections' ? projections : undefined),
  }
  const agent = { ctx, session: { id: sessionId } }
  registerToolsForAgent(agent, def, {
    config, store, lineDefs,
    createLine: async () => ({}), moveLineWorkspace: async () => ({}),
    retireLine: async () => ({}), rebindLine: async () => ({}), renameLine: async () => ({}),
  })
  return { store, registered, agent, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('line_metrics reports token trend fields from samples', async () => {
  const h = harness()
  try {
    const now = Date.now()
    h.store.recordTokenSample({ agentId: 'agent-demo', line: 'manager', decodeTokens: 0, now: now - 60000 })
    h.store.recordTokenSample({ agentId: 'agent-demo', line: 'manager', decodeTokens: 500, now })
    const payload = await h.registered.get('line_metrics').execute({ days: 7 }, { agent: h.agent })
    assert.equal(typeof payload.tokens.total, 'number')
    assert.equal(payload.tokens.samples >= 2, true)
    assert.equal(payload.tokens.today >= 0, true)
    assert.ok(Array.isArray(payload.tokens.perDay))
    assert.equal(payload.tokens.sampleIntervalMs, 60000)
    assert.match(payload.tokens.basis, /estimate/)
    const manager = payload.tokens.byLine.find(item => item.line === 'manager')
    assert.equal(manager.samples >= 2, true)
    assert.equal(manager.window >= 500, true)
  } finally { h.cleanup() }
})
