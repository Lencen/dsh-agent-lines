#!/usr/bin/env node
/**
 * board-line-tasks-fixtures.mjs — PARENT-REF v0.4 fixture runner (read-only, isolated DB)
 * usage: node scripts/board-line-tasks-fixtures.mjs [--fixtures test/fixtures/parent-ref] [--require-all]
 * exit: 0 PASS / 1 FAIL / 2 fixture 缺失（--require-all 时）
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LineStore } from '../lib/store.js'
import { startBoardServer } from '../lib/board-server.js'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const requireAll = argv.includes('--require-all')
const dir = arg('--fixtures', 'test/fixtures/parent-ref')
const file = join(dir, 'cases.json')
if (!existsSync(file)) {
  console.log('PARENT_REF_FIXTURES: SKIP (no ' + file + ')')
  process.exit(requireAll ? 2 : 0)
}
const suite = JSON.parse(readFileSync(file, 'utf8'))
const cases = [...(suite.projectionCases ?? []).map(c => ({ ...c, kindOfCase: 'projection' })), ...(suite.liveCases ?? []).map(c => ({ ...c, kindOfCase: 'live' }))]
if (cases.length === 0) {
  console.log('PARENT_REF_FIXTURES: SKIP (empty suite)')
  process.exit(requireAll ? 2 : 0)
}
const failures = []
const check = (name, fn) => { try { fn(); console.log('PASS ' + name) } catch (error) { failures.push(name + ': ' + String(error?.message ?? error)); console.log('FAIL ' + name + '  ' + String(error?.message ?? error)) } }
const label = (v) => JSON.stringify(v)

function seed(workDir, messages) {
  const dbPath = join(workDir, 'lines.db')
  const store = new LineStore(dbPath)
  const acquired = new Set()
  const acquire = (agentId, line) => {
    const key = agentId + '/' + line
    if (acquired.has(key)) return
    acquired.add(key)
    store.acquire({ agentId, line, sessionId: 's-' + agentId + '-' + line, instanceId: 'i', ttlMs: 600000 })
  }
  acquire('agent-demo', 'manager')
  messages.forEach((m, i) => {
    const agentId = m.agent ?? 'agent-demo'
    acquire(agentId, 'manager')
    acquire(agentId, m.to)
    store.send({ agentId, fromLine: m.from, to: m.to, text: m.text ?? (i + ':' + (m.taskRef ?? '') + ':' + (m.parentTaskRef ?? '') + ':' + (m.now ?? 0)), kind: m.kind ?? 'task', taskRef: m.taskRef ?? null, parentTaskRef: m.parentTaskRef ?? null, taskScope: m.taskScope ?? null, now: m.now ?? 1000 + i })
  })
  return { store, dbPath }
}

for (const c of cases) {
  const workDir = mkdtempSync(join(tmpdir(), 'parent-ref-fixture-'))
  try {
    const { store, dbPath } = seed(workDir, c.messages)
    if (c.kindOfCase === 'projection') {
      // id 覆盖（tie 场景）在查询前写入 DB
      const overrides = c.messages.filter(m => typeof m.id === 'string')
      if (overrides.length) {
        store.close()
        const db = new DatabaseSync(dbPath)
        for (const m of overrides) db.prepare('UPDATE messages SET id = ? WHERE body = ?').run(m.id, m.text ?? (c.messages.indexOf(m) + ':' + (m.taskRef ?? '') + ':' + (m.parentTaskRef ?? '') + ':' + (m.now ?? 0)))
        db.close()
      } else {
        store.close()
      }
      const read = new LineStore(dbPath)
      try {
        const taskRef = c.messages[0].taskRef
        if (Object.prototype.hasOwnProperty.call(c.expect, 'parentTaskRef')) {
          check(c.id + ' parentTaskRef', () => assert.equal(read.parentTaskFor({ agentId: 'agent-demo', taskRef }), c.expect.parentTaskRef))
        }
        if (c.expect.map) {
          for (const [ref, want] of Object.entries(c.expect.map)) check(c.id + ' map ' + ref, () => assert.equal(read.parentTaskFor({ agentId: 'agent-demo', taskRef: ref }), want))
        }
        if (c.expect.perAgent) {
          for (const [agentId, want] of Object.entries(c.expect.perAgent)) check(c.id + ' agent ' + agentId, () => assert.equal(read.parentTaskFor({ agentId, taskRef }), want))
        }
      } finally { read.close() }
    } else {
      store.close()
      const { server, url } = await startBoardServer({ dir: workDir, dbPath, host: '127.0.0.1', port: 0 })
      try {
        const query = c.since !== undefined ? '?since=' + String(c.since) : ''
        const payload = await (await fetch(new URL('/api/live' + query, url))).json()
        const lt = payload.lineTasks ?? {}
        const byRef = Array.isArray(lt.byTaskRef) ? lt.byTaskRef : null
        const byLineTaskCount = Object.fromEntries((lt.byLine ?? []).map(row => [row.line, row.taskCount]))
        if (c.expect.total !== undefined) check(c.id + ' total', () => assert.equal(lt.total, c.expect.total))
        if (c.expect.taskCount !== undefined) check(c.id + ' taskCount', () => assert.equal(lt.taskCount, c.expect.taskCount))
        if (c.expect.nullTaskRefCount !== undefined) check(c.id + ' nullTaskRefCount', () => assert.equal(lt.nullTaskRefCount, c.expect.nullTaskRefCount))
        if (c.expect.byTaskRefLength !== undefined) check(c.id + ' byTaskRef.length', () => { assert.ok(byRef, 'byTaskRef 缺失'); assert.equal(byRef.length, c.expect.byTaskRefLength) })
        if (c.expect.byTaskRefMessageCountSum !== undefined) check(c.id + ' byTaskRef Σ messageCount', () => assert.equal(byRef.reduce((n, r) => n + r.messageCount, 0), c.expect.byTaskRefMessageCountSum))
        if (c.expect.byLineTaskCount) for (const [line, want] of Object.entries(c.expect.byLineTaskCount)) check(c.id + ' byLine.taskCount ' + line, () => assert.equal(byLineTaskCount[line], want))
        if (c.expect.since !== undefined) check(c.id + ' since echo', () => assert.equal(lt.since, c.expect.since))
        if (c.expect.filteredCount !== undefined) check(c.id + ' filteredCount', () => assert.equal(lt.filteredCount, c.expect.filteredCount))
        if (c.expect.byTaskRefWindow !== undefined) check(c.id + ' byTaskRefWindow', () => assert.deepEqual(lt.byTaskRefWindow, c.expect.byTaskRefWindow))
        check(c.id + ' nextBefore/hasMore', () => { assert.equal(lt.nextBefore, null); assert.equal(lt.hasMore, false) })
      } finally { await new Promise(resolve => server.close(resolve)) }
    }
  } catch (error) {
    failures.push(c.id + ': ' + String(error?.message ?? error)); console.log('FAIL ' + c.id + '  ' + String(error?.message ?? error))
  } finally { rmSync(workDir, { recursive: true, force: true }) }
}
console.log('')
console.log(failures.length === 0 ? 'PARENT_REF_FIXTURES: PASS (' + cases.length + ')' : 'PARENT_REF_FIXTURES: FAIL (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
