/**
 * DSH capability probing (0.9.0 S2 / F5).
 *
 * We never widen the DSH version range to "support more people"; instead we probe
 * what the running profile actually exposes and degrade explicitly.
 */
import { LineError } from './protocol.js'

export const CAPABILITY_NAMES = Object.freeze([
  'session.create',
  'session.prompt',
  'session.rename',
  'session.isLive',
  'session.persistence',
  'workspace.resolveByPath',
  'workspace.attach',
])

function hasFn(target, name) {
  return target !== undefined && target !== null && typeof target[name] === 'function'
}

/**
 * Probe the running DSH context. true = available, false = unavailable,
 * null = indirect/unknown (never pretend a capability we did not observe).
 */
export function probeCapabilities(ctx) {
  const sessionController = ctx?.sessionController
  const agents = ctx?.agents
  const registry = ctx?.get?.('workspaceRegistry')
  const persistence = ctx?.get?.('sessionPersistence')
  const canCreate = hasFn(sessionController, 'create')
  const canResolveWorkspace = hasFn(registry, 'resolveByPath')
  return {
    'session.create': canCreate,
    'session.prompt': hasFn(sessionController, 'prompt'),
    'session.rename': hasFn(sessionController, 'rename'),
    'session.isLive': hasFn(agents, 'get'),
    'session.persistence': hasFn(persistence, 'stat'),
    'workspace.resolveByPath': canResolveWorkspace,
    'workspace.attach': canCreate && canResolveWorkspace ? true : null,
  }
}

/** Throw a clear, actionable error when a required capability is missing. */
export function requireCapability(capabilities, name) {
  if (capabilities[name] === true) return capabilities
  throw new LineError('LINE_CAPABILITY_MISSING', 'Required DSH capability is not available in this profile: ' + name, {
    capability: name,
    capabilities,
    hint: 'Upgrade DSH or disable the feature that needs it; see line_status.capabilities.',
  })
}
