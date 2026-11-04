/**
 * Owner-process delivery loop.
 *
 * Only the DSH process that owns `config.sessionId` consumes its queue. The
 * loop never resolves another process's Session, which keeps DSH's per-Session
 * writer lock intact.
 */
import { formatEnvelope } from './protocol.js'

const RETRYABLE = new Set([
  'session/agent-busy',
  'session/conflict',
  'LINE_LEASE_LOST',
  'SQLITE_BUSY',
])

function errorCode(error) {
  return String(error?.code ?? error?.remoteCode ?? error?.name ?? '')
}

function backoffMs(attempts) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}

export class DeliveryLoop {
  constructor({ ctx, config, store, logger = ctx.logger }) {
    this.ctx = ctx
    this.config = config
    this.store = store
    this.logger = logger
    this.instanceId = config.instanceId
    this.timer = undefined
    this.current = Promise.resolve()
    this.stopping = false
    this.started = false
  }

  start() {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.timer = setInterval(() => {
      this.current = this.current.then(() => this.tick()).catch(error => {
        this.logger?.warn?.('agent-lines: delivery tick failed: %s', String(error))
      })
    }, this.config.pollMs)
    this.timer.unref?.()
    this.current = this.tick().catch(error => {
      this.logger?.warn?.('agent-lines: initial delivery tick failed: %s', String(error))
    })
  }

  async stop() {
    if (!this.started) return
    this.stopping = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    await this.current.catch(() => {})
    try {
      this.store.release({ agentId: this.config.agentId, line: this.config.line, instanceId: this.instanceId })
    } catch (error) {
      this.logger?.warn?.('agent-lines: release lease failed: %s', String(error))
    }
    this.started = false
  }

  async tick() {
    if (this.stopping) return
    const { agentId, line, instanceId, leaseTtlMs, maxAttempts } = this.config
    this.store.heartbeat({ agentId, line, instanceId, ttlMs: leaseTtlMs })
    const rows = this.store.claim({
      agentId,
      line,
      instanceId,
      limit: this.config.claimBatch,
      claimTimeoutMs: this.config.claimTimeoutMs,
    })
    for (const row of rows) {
      if (this.stopping) break
      await this.deliver(row, { agentId, line, instanceId, maxAttempts })
    }
  }

  async deliver(row, { agentId, line, instanceId, maxAttempts }) {
    const text = formatEnvelope(row)
    try {
      const signal = AbortSignal.timeout(this.config.deliveryTimeoutMs)
      await this.ctx.sessionController.prompt({
        requestId: row.id,
        sessionId: this.config.sessionId,
        mode: 'steer',
        content: [{ type: 'text', text }],
      }, signal)
      this.store.markDelivered(row.id, instanceId)
      this.logger?.info?.('agent-lines: delivered %s from %s#%s', row.id, row.from_agent, row.from_line)
    } catch (error) {
      const code = errorCode(error)
      const permanent = code === 'session/not-found' || code === 'LINE_NOT_FOUND'
      const terminal = permanent || row.attempts >= maxAttempts
      const nextAttemptAt = terminal ? undefined : Date.now() + backoffMs(row.attempts)
      this.store.markError(row.id, instanceId, `${code || 'error'}: ${error?.message ?? String(error)}`, {
        nextAttemptAt,
        maxAttempts,
      })
      this.logger?.warn?.('agent-lines: delivery %s failed (%s, attempt %d/%d)%s',
        row.id, code || 'error', row.attempts, maxAttempts, terminal ? ' terminal' : '')
    }
  }
}

export { backoffMs, errorCode, RETRYABLE }
