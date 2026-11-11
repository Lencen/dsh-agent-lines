import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig } from '../lib/index.js'

test('dedupeWindowMs follows config > env > default', () => {
  const old = process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS
  try {
    delete process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS
    assert.equal(normalizeConfig({}).dedupeWindowMs, 5000)
    process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS = '60000'
    assert.equal(normalizeConfig({}).dedupeWindowMs, 60000)
    assert.equal(normalizeConfig({ dedupeWindowMs: 0 }).dedupeWindowMs, 0)
    process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS = 'not-a-number'
    assert.throws(() => normalizeConfig({}), error => error.code === 'LINE_INVALID_CONFIG')
  } finally {
    if (old === undefined) delete process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS
    else process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS = old
  }
})
