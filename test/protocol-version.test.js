import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION, parseProtocolVersion,
  isProtocolCompatible, assertProtocolCompatible, LineError,
} from '../lib/protocol.js'
import { LineStore } from '../lib/store.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-proto-'))
  const store = new LineStore(join(dir, 'lines.db'))
  return { dir, store, cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}
function acquire(store, line, instanceId) {
  return store.acquire({ agentId: 'agent-demo', line, sessionId: 'session-' + line, instanceId, ttlMs: 30000 })
}

test('protocol version constants and parsing', () => {
  assert.equal(PROTOCOL_VERSION, '0.4')
  assert.equal(LEGACY_PROTOCOL_VERSION, '0.3')
  assert.deepEqual(parseProtocolVersion('0.4'), { major: 0, minor: 4, raw: '0.4' })
  assert.deepEqual(parseProtocolVersion(''), { major: 0, minor: 3, raw: '0.3' })
  assert.deepEqual(parseProtocolVersion('1.2'), { major: 1, minor: 2, raw: '1.2' })
  assert.throws(() => parseProtocolVersion('abc'), (error) => error instanceof LineError && error.code === 'LINE_INVALID_ARGUMENT')
})

test('compatibility: same major ok, different major rejected', () => {
  assert.equal(isProtocolCompatible('0.4'), true)
  assert.equal(isProtocolCompatible('0.3'), true)
  assert.equal(isProtocolCompatible('0.99'), true)
  assert.equal(isProtocolCompatible('1.0'), false)
  assert.ok(assertProtocolCompatible('0.3'))
  assert.throws(() => assertProtocolCompatible('1.0'), (error) => error instanceof LineError && error.code === 'LINE_PROTOCOL_MISMATCH')
})

test('send stamps the current protocol version', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const row = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' })
    assert.equal(row.protocol_version, PROTOCOL_VERSION)
  } finally { cleanup() }
})

test('legacy rows without version still deliver (treated as 0.3)', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const row = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'hi' })
    store.db.prepare("UPDATE messages SET protocol_version = '0.3' WHERE id = ?").run(row.id)
    const claimed = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].id, row.id)
  } finally { cleanup() }
})

test('incompatible major is not delivered: failed + audited', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const row = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'future' })
    store.db.prepare("UPDATE messages SET protocol_version = '1.0' WHERE id = ?").run(row.id)
    const claimed = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    assert.equal(claimed.length, 0, 'incompatible message must not be claimed')
    const failed = store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] })
    assert.equal(failed.length, 1)
    assert.match(failed[0].last_error, /LINE_PROTOCOL_MISMATCH/)
    const events = store.eventsForMessage(row.id).map(e => e.state)
    assert.ok(events.includes('failed'))
    assert.ok(store.eventsForMessage(row.id).some(e => String(e.detail || '').includes('LINE_PROTOCOL_MISMATCH')))
  } finally { cleanup() }
})

test('schema v14 has protocol_version column with legacy default', () => {
  const { store, cleanup } = tempStore()
  try {
    const cols = store.db.prepare('PRAGMA table_info(messages)').all().map(c => c.name)
    assert.ok(cols.includes('protocol_version'))
    const version = store.db.prepare('PRAGMA user_version').get()
    assert.equal(version.user_version, 14)
  } finally { cleanup() }
})

test('malformed protocol_version does not stall the whole claim batch', () => {
  const { store, cleanup } = tempStore()
  try {
    acquire(store, 'frontend', 'i-a')
    acquire(store, 'backend', 'i-b')
    const bad = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'bad-version' })
    const good = store.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'healthy' })
    store.db.prepare("UPDATE messages SET protocol_version = 'abc' WHERE id = ?").run(bad.id)
    const claimed = store.claim({ agentId: 'agent-demo', line: 'backend', instanceId: 'i-b', limit: 10 })
    assert.equal(claimed.length, 1, 'healthy message must still be claimable')
    assert.equal(claimed[0].id, good.id)
    const failed = store.messagesByStates({ agentId: 'agent-demo', line: 'backend', states: ['failed'] })
    assert.equal(failed.length, 1)
    assert.match(failed[0].last_error, /LINE_PROTOCOL_MISMATCH/)
  } finally { cleanup() }
})

test('v13 database migrates additively to v14 with protocol_version default 0.3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-lines-mig14-'))
  const path = join(dir, 'lines.db')
  try {
    const first = new LineStore(path)
    acquire(first, 'frontend', 'i-a')
    acquire(first, 'backend', 'i-b')
    const sent = first.send({ agentId: 'agent-demo', fromLine: 'frontend', to: 'backend', text: 'migrate-me' })
    first.close()
    const db = new DatabaseSync(path)
    db.exec('ALTER TABLE messages DROP COLUMN protocol_version')
    db.exec('PRAGMA user_version = 13')
    db.close()
    const reopened = new LineStore(path)
    try {
      const cols = reopened.db.prepare('PRAGMA table_info(messages)').all().map(c => c.name)
      assert.ok(cols.includes('protocol_version'), 'protocol_version column must be re-added')
      assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 14)
      const row = reopened.messageById(sent.id)
      assert.equal(row.protocol_version, '0.3', 'legacy rows default to 0.3')
    } finally { reopened.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
