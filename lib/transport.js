/**
 * Transport seam.
 *
 * The DSH adapter owns line identity, delivery loops, tools, and claim/status.
 * A transport owns durable line/message storage and cross-process delivery.
 * The default is SQLite; additional transports can implement the same contract.
 */
import { LineStore } from './store.js'
import { LineError } from './protocol.js'

export const TRANSPORTS = Object.freeze(['sqlite'])

/**
 * @param {ReturnType<import('./index.js').normalizeConfig>} config
 * @returns {LineStore}
 */
export function createTransport(config) {
  const kind = config.transport
  if (kind === 'sqlite') return new LineStore(config.dbPath)
  throw new LineError('LINE_INVALID_CONFIG', `Unsupported transport: ${JSON.stringify(kind)}`, { transports: TRANSPORTS })
}
