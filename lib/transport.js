/**
 * Transport seam.
 *
 * The DSH adapter owns line identity, delivery loops, tools, and claim/status.
 * A transport owns durable line/message storage and cross-process delivery.
 * The default is SQLite; additional transports can implement the same contract.
 */
import { LineStore } from './store.js'
import { LineError } from './protocol.js'

export const TRANSPORTS = Object.freeze(['sqlite', 'memory'])

/**
 * @param {ReturnType<import('./index.js').normalizeConfig>} config
 * @returns {LineStore}
 */
export function createTransport(config) {
  const kind = config.transport
  if (kind === 'sqlite') return new LineStore(config.dbPath)
  // 'memory' = in-memory SQLite: same engine, ephemeral database. It proves the transport
  // seam is swappable (tests start/stop instantly) without pretending to be a second engine.
  if (kind === 'memory') return new LineStore(':memory:')
  throw new LineError('LINE_INVALID_CONFIG', `Unsupported transport: ${JSON.stringify(kind)}`, { transports: TRANSPORTS })
}
