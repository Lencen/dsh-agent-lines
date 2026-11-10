import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSchema } from './helpers/schema-lint.js'
import { LineStore } from '../lib/store.js'
import { PROTOCOL_VERSION, toEnvelope } from '../lib/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const envelopeSchema = JSON.parse(readFileSync(join(ROOT, 'schema/envelope.v0_4.json'), 'utf8'))
const messageSchema = JSON.parse(readFileSync(join(ROOT, 'schema/message.v0_4.json'), 'utf8'))

function acquire(store, line, instanceId) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId: 'session-' + line, instanceId, ttlMs: 30000 })
}

test('live database rows validate against schema/message.v0_4.json', () => {
  const store = new LineStore(':memory:')
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const normal = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hello', kind: 'request', ccManager: true })
    const legacy = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'legacy' })
    store.db.prepare("UPDATE messages SET protocol_version = '0.3' WHERE id = ?").run(legacy.id)
    const rows = store.messagesForLine({ agentId: 'agent-demo', line: 'backend', limit: 10 })
    assert.equal(rows.length, 2)
    for (const row of rows) {
      const errors = validateSchema(messageSchema, row)
      assert.deepEqual(errors, [], row.id + ': stored row must satisfy schema: ' + errors.join('; '))
    }
    assert.equal(rows.find(row => row.id === normal.id).protocol_version, PROTOCOL_VERSION)
    assert.equal(rows.find(row => row.id === legacy.id).protocol_version, '0.3')
  } finally { store.close() }
})

test('toEnvelope(row) validates against schema/envelope.v0_4.json', () => {
  const store = new LineStore(':memory:')
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const sent = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi', kind: 'task', replyTo: null })
    const row = store.messageById(sent.id)
    const envelope = toEnvelope(row)
    const errors = validateSchema(envelopeSchema, envelope)
    assert.deepEqual(errors, [], 'wire envelope must satisfy schema: ' + errors.join('; '))
    assert.equal(envelope.protocolVersion, PROTOCOL_VERSION)
    assert.equal(envelope.body.text, 'hi')
    assert.equal(envelope.kind, 'task')
  } finally { store.close() }
})

test('toEnvelope falls back to 0.3 when the row has no protocol_version', () => {
  const row = {
    id: 'msg_' + 'a'.repeat(32), idempotency_key: 'caller:legacy',
    from_agent: 'agent-demo', from_line: 'frontend', from_session: 'session-frontend',
    to_agent: 'agent-demo', to_line: 'backend', body: 'legacy', created_at: 1,
    expires_at: null, reply_to: null, root_message_id: null, hop: 0, no_reply: 0,
    kind: 'info', cc_manager: 0,
  }
  const envelope = toEnvelope(row)
  assert.equal(envelope.protocolVersion, '0.3')
  assert.deepEqual(validateSchema(envelopeSchema, envelope), [], 'legacy envelope must satisfy schema')
})
