import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig } from '../lib/index.js'

test('legacy single-line config still normalizes', () => {
  const config = normalizeConfig({ agentId: 'agent-demo', line: 'frontend', sessionId: 'session-a' })
  assert.equal(config.lines.length, 1)
  assert.equal(config.lines[0].label, 'frontend')
  assert.equal(config.lines[0].sessionId, 'session-a')
  assert.equal(config.lines[0].lineId, 'agent-demo#frontend')
  assert.equal(config.allowCreate, false)
  assert.equal(config.lines[0].agentId, 'agent-demo')
  assert.equal(config.createFrom, 'frontend')
  assert.equal(config.maxLines, 16)
  assert.equal(config.allowClaim, false)
  assert.equal(config.transport, 'sqlite')
  assert.equal(config.allowSelfSend, false)
  assert.equal(config.dedupeWindowMs, 5000)
  assert.equal(config.maxReplyDepth, 8)
})

test('multi-line config carries roles and allowCreate', () => {
  const config = normalizeConfig({
    agentId: 'agent-demo',
    allowCreate: true,
    allowClaim: true,
    lines: [
      { label: 'manager', sessionId: 'session-m', role: 'dispatcher' },
      { label: 'frontend', sessionId: 'session-f', role: 'UI' },
    ],
  })
  assert.equal(config.allowCreate, true)
  assert.equal(config.allowClaim, true)
  assert.equal(config.transport, 'sqlite')
  assert.equal(config.lines.length, 2)
  assert.equal(config.lines[0].role, 'dispatcher')
  assert.equal(config.lines[1].lineId, 'agent-demo#frontend')
  assert.equal(config.createFrom, 'manager')
})

test('duplicate labels and sessions are rejected', () => {
  assert.throws(() => normalizeConfig({
    agentId: 'agent-demo',
    lines: [{ label: 'a', sessionId: 's1' }, { label: 'a', sessionId: 's2' }],
  }), /Duplicate line label/)
  assert.throws(() => normalizeConfig({
    agentId: 'agent-demo',
    lines: [{ label: 'a', sessionId: 's1' }, { label: 'b', sessionId: 's1' }],
  }), /Duplicate sessionId/)
  assert.throws(() => normalizeConfig({ agentId: 'agent-demo', lines: [] }), /At least one line/)
  assert.throws(() => normalizeConfig({
    agentId: 'agent-demo',
    createFrom: 'missing',
    lines: [{ label: 'a', sessionId: 's1' }],
  }), /createFrom must name/)
  assert.throws(() => normalizeConfig({
    agentId: 'agent-demo',
    transport: 'carrier-pigeon',
    lines: [{ label: 'a', sessionId: 's1' }],
  }), /Unsupported transport/)
  assert.throws(() => normalizeConfig({
    agentId: 'agent-demo',
    maxLines: 0,
    lines: [{ label: 'a', sessionId: 's1' }],
  }), /Expected an integer/)
})
