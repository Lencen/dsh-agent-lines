import test from 'node:test'
import assert from 'node:assert/strict'
import { probeCapabilities, requireCapability, CAPABILITY_NAMES } from '../lib/capabilities.js'
import { LineError } from '../lib/protocol.js'

function fullCtx() {
  return {
    sessionController: { create: async () => ({}), prompt: async () => ({}), rename: async () => ({}) },
    agents: { get: () => undefined, list: () => [], roots: () => [] },
    get: (name) => name === 'workspaceRegistry'
      ? { resolveByPath: async () => undefined, get: () => undefined }
      : (name === 'sessionPersistence' ? { stat: async () => undefined } : undefined),
  }
}

test('capability names are stable', () => {
  assert.deepEqual([...CAPABILITY_NAMES], [
    'session.create', 'session.prompt', 'session.rename', 'session.isLive',
    'session.persistence', 'workspace.resolveByPath', 'workspace.attach',
  ])
})

test('full context exposes every capability', () => {
  const caps = probeCapabilities(fullCtx())
  assert.equal(caps['session.create'], true)
  assert.equal(caps['session.prompt'], true)
  assert.equal(caps['session.rename'], true)
  assert.equal(caps['session.isLive'], true)
  assert.equal(caps['session.persistence'], true)
  assert.equal(caps['workspace.resolveByPath'], true)
  assert.equal(caps['workspace.attach'], true)
})

test('minimal context degrades to false instead of throwing', () => {
  const caps = probeCapabilities({})
  assert.equal(caps['session.create'], false)
  assert.equal(caps['workspace.resolveByPath'], false)
  assert.equal(caps['workspace.attach'], null)
})

test('requireCapability throws LINE_CAPABILITY_MISSING with hint', () => {
  const caps = { 'session.create': false }
  assert.throws(() => requireCapability(caps, 'session.create'), (error) => {
    assert.ok(error instanceof LineError)
    assert.equal(error.code, 'LINE_CAPABILITY_MISSING')
    assert.equal(error.detail.capability, 'session.create')
    assert.ok(error.detail.capabilities !== undefined)
    assert.match(error.detail.hint, /line_status/)
    return true
  })
})

test('requireCapability returns capabilities when present', () => {
  const caps = { 'session.create': true }
  assert.equal(requireCapability(caps, 'session.create'), caps)
})
