import test from 'node:test'
import assert from 'node:assert/strict'
import { activityLevel, summarizeActivity } from '../lib/activity.js'

test('activity levels are deterministic and not a context percentage', () => {
  assert.equal(activityLevel({ steps: 0 }), 'low')
  assert.equal(activityLevel({ steps: 14 }), 'low')
  assert.equal(activityLevel({ steps: 15 }), 'medium')
  assert.equal(activityLevel({ steps: 39 }), 'medium')
  assert.equal(activityLevel({ steps: 40 }), 'high')
})

test('summarizeActivity keeps lastActivityAt and token counts', () => {
  const a = summarizeActivity({ turns: 3, steps: 20, decodeTokens: 100 }, 123)
  assert.deepEqual(a, { turns: 3, steps: 20, decodeTokens: 100, level: 'medium', lastActivityAt: 123 })
  assert.equal(summarizeActivity(undefined, 1), null)
})

test('summarizeActivity includes totalTokens when the tokenUsage projection is present', () => {
  const a = summarizeActivity({ turns: 1, steps: 2, decodeTokens: 10 }, null, { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0 })
  assert.equal(a.decodeTokens, 10)
  assert.equal(a.outputTokens, 10)
  assert.equal(a.inputTokens, 100)
  assert.equal(a.cacheReadTokens, 900)
  assert.equal(a.cacheWriteTokens, 0)
  assert.equal(a.totalTokens, 1010)
})
