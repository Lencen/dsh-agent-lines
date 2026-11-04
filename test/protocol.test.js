import test from 'node:test'
import assert from 'node:assert/strict'
import { formatEnvelope, lineId, makeIdempotencyKey, parseTarget, validateLineLabel } from '../lib/protocol.js'

test('lineId validates and joins', () => {
  assert.equal(lineId('agent-demo', 'frontend-line'), 'agent-demo#frontend-line')
  assert.throws(() => validateLineLabel('../bad'), /Invalid line label/)
})

test('parseTarget accepts bare and qualified targets', () => {
  assert.deepEqual(parseTarget('backend-line', 'agent-demo'), {
    agentId: 'agent-demo', line: 'backend-line', lineId: 'agent-demo#backend-line',
  })
  assert.deepEqual(parseTarget('other#asset-line', 'agent-demo'), {
    agentId: 'other', line: 'asset-line', lineId: 'other#asset-line',
  })
  assert.throws(() => parseTarget('a#b#c', 'agent-demo'), /Invalid target/)
})

test('formatEnvelope carries sender, id and reply guidance', () => {
  const text = formatEnvelope({
    id: 'msg_1', from_agent: 'agent-demo', from_line: 'frontend-line',
    body: 'hello', reply_to: 'msg_0',
  })
  assert.match(text, /from agent-demo#frontend-line \(msg_1\)/)
  assert.match(text, /In reply to: msg_0/)
  assert.match(text, /line_ack/)
})

test('idempotency keys are stable only when a caller key is supplied', () => {
  const a = makeIdempotencyKey({ fromLine: 'a', to: 'b', text: 'x', key: 'k' })
  const b = makeIdempotencyKey({ fromLine: 'a', to: 'b', text: 'x', key: 'k' })
  assert.equal(a, b)
  const c = makeIdempotencyKey({ fromLine: 'a', to: 'b', text: 'x' })
  const d = makeIdempotencyKey({ fromLine: 'a', to: 'b', text: 'x' })
  assert.notEqual(c, d)
})
