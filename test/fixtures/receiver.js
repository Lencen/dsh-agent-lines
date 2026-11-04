import { LineStore } from '../../lib/store.js'

const [db, instanceId, expectedRaw] = process.argv.slice(2)
const expected = Number(expectedRaw ?? 100)
const store = new LineStore(db)
const agentId = 'agent-demo'
const line = 'backend'

store.acquire({ agentId, line, sessionId: 'session-backend', instanceId, ttlMs: 30_000 })
process.stdout.write('READY\n')

let delivered = 0
const timer = setInterval(() => {
  try {
    store.heartbeat({ agentId, line, instanceId, ttlMs: 30_000 })
    const rows = store.claim({ agentId, line, instanceId, limit: 20, claimTimeoutMs: 60_000 })
    for (const row of rows) {
      store.markDelivered(row.id, instanceId)
      delivered += 1
    }
    if (delivered >= expected) {
      clearInterval(timer)
      process.stdout.write('DELIVERED=' + delivered + '\n')
      store.release({ agentId, line, instanceId })
      store.close()
      process.exit(0)
    }
  } catch (error) {
    process.stderr.write(String(error) + '\n')
    process.exit(1)
  }
}, 50)

process.on('SIGTERM', () => {
  clearInterval(timer)
  try { store.release({ agentId, line, instanceId }) } catch {}
  store.close()
  process.exit(0)
})
