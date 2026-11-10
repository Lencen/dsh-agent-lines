#!/usr/bin/env node
/**
 * business-smoke.mjs — 0.8.0 业务冒烟（发版前必跑）
 * 覆盖：send -> claim -> fail -> 按状态查 -> trace -> redeliver -> deliver -> ack -> purge(dryRun) -> doctor
 * 用法：node scripts/business-smoke.mjs [--json]
 * 退出码：0 PASS / 1 FAIL
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LineStore } from '../lib/store.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = process.argv.includes('--json')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass, detail })

const dir = mkdtempSync(join(tmpdir(), 'agent-lines-smoke-'))
const dbPath = join(dir, 'lines.db')
const store = new LineStore(dbPath)
try {
  store.acquire({ agentId: 'agent-demo', line: 'manager', sessionId: 's-m', instanceId: 'i-m', ttlMs: 600000 })
  store.acquire({ agentId: 'agent-demo', line: 'worker', sessionId: 's-w', instanceId: 'i-w', ttlMs: 600000 })

  // 1) 正常投递 + ack
  const ok = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'task-ok' })
  store.claim({ agentId: 'agent-demo', line: 'worker', instanceId: 'i-w', limit: 10 })
  store.markDelivered(ok.id, 'i-w')
  store.markAck({ agentId: 'agent-demo', line: 'worker', messageId: ok.id })
  check('1 正常投递+ack', store.countsByState({ agentId: 'agent-demo', line: 'worker' }).acked === 1)

  // 2) 失败态 -> 可查
  const bad = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'task-fail' })
  store.claim({ agentId: 'agent-demo', line: 'worker', instanceId: 'i-w', limit: 10 })
  store.markError(bad.id, 'i-w', 'session/error', { maxAttempts: 1 })
  const failed = store.messagesByStates({ agentId: 'agent-demo', line: 'worker', states: ['failed'] })
  check('2 failed 可按状态查到', failed.length === 1 && failed[0].id === bad.id)

  // 3) trace 生命周期
  const states = store.eventsForMessage(bad.id).map(e => e.state)
  check('3 trace 事件序列', states.join(',') === 'queued,claimed,failed', states.join(','))

  // 4) redeliver 救回
  const re = store.redeliver({ agentId: 'agent-demo', messageId: bad.id, actor: 'manager' })
  check('4 redeliver 回到 queued', re.state === 'queued' && re.attempts === 0)
  store.claim({ agentId: 'agent-demo', line: 'worker', instanceId: 'i-w', limit: 10 })
  store.markDelivered(bad.id, 'i-w')
  store.markAck({ agentId: 'agent-demo', line: 'worker', messageId: bad.id })
  check('5 救回后完成 ack', store.countsByState({ agentId: 'agent-demo', line: 'worker' }).acked === 2)

  // 5) purge 默认 dryRun
  const dry = store.purge({ agentId: 'agent-demo', before: Date.now() + 1000 })
  check('6 purge 默认 dryRun', dry.dryRun === true && dry.deleted === 0 && dry.wouldDelete === 2)

  // 6) ackOverdue 只报数
  const late = store.send({ agentId: 'agent-demo', fromLine: 'manager', to: 'worker', text: 'task-late' })
  store.claim({ agentId: 'agent-demo', line: 'worker', instanceId: 'i-w', limit: 10 })
  store.markDelivered(late.id, 'i-w', Date.now() - 120000)
  const overdue = store.ackOverdue({ agentId: 'agent-demo', line: 'worker', timeoutMs: 60000 })
  check('7 ackOverdue 报数且不重投', overdue.length === 1 && store.inbox({ agentId: 'agent-demo', line: 'worker' })[0].state === 'delivered')

  // 7) doctor 输出 health
  store.close()
  const out = execFileSync(process.execPath, [join(ROOT, 'bin/dsh-agent-lines.js'), '--db', dbPath, '--json', '--agent', 'agent-demo', '--ack-timeout', '60000', 'doctor'], { encoding: 'utf8' })
  const doc = JSON.parse(out)
  check('8 doctor health 三类计数', doc.health && doc.health.failed !== undefined && doc.health.expired !== undefined && doc.health.ackOverdue !== undefined && Array.isArray(doc.hints))
  check('9 doctor 提示 ackOverdue', doc.health.ackOverdue === 1, 'ackOverdue=' + doc.health.ackOverdue)
} finally {
  try { store.close() } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true })
}

const failures = checks.filter(c => !c.pass)
if (json) console.log(JSON.stringify({ ok: failures.length === 0, checks }, null, 1))
else {
  for (const c of checks) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  ' + c.detail : ''))
  console.log('')
  console.log(failures.length === 0 ? 'BUSINESS_SMOKE: PASS (' + checks.length + ' checks)' : 'BUSINESS_SMOKE: FAIL (' + failures.length + '/' + checks.length + ')')
}
process.exit(failures.length === 0 ? 0 : 1)
