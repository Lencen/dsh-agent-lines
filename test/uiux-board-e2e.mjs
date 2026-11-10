#!/usr/bin/env node
/* UIUX 0.6.6 browser E2E: bento + data/view/interaction matrix */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { LineStore } from '../lib/store.js'
import { startBoardServer } from '../lib/board-server.js'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/xiaoqi/lions/node_modules/playwright')

const dir = mkdtempSync(join(tmpdir(), 'agent-lines-e2e-'))
const db = join(dir, 'lines.db')
const store = new LineStore(db)
const now = Date.now()
store.acquire({ agentId: 'agent-lines', line: 'manager', sessionId: 's-manager', instanceId: 'i', ttlMs: 60000 })
store.acquire({ agentId: 'agent-lines', line: 'writer', sessionId: 's-writer', instanceId: 'i', ttlMs: 60000 })
store.send({ agentId: 'agent-lines', fromLine: 'manager', to: 'writer', text: '写第一章', kind: 'task', taskRef: 'task-1', taskScope: 'writer', subteamPolicy: 'ask', maxMembers: 2 })
const pending = store.send({ agentId: 'agent-lines', fromLine: 'writer', to: 'manager', text: '请审批', kind: 'task', requireApproval: true })

const board = {
  schemaVersion: 1, available: true, generatedAt: now,
  manager: { line: 'manager', sessionId: 's-manager', role: 'lead' },
  tasks: [
    { id: 'task-1', subject: '总任务', status: 'in_progress', ownerName: 'writer', ownerLine: 'writer', parentTaskId: null, blockedBy: [] },
    { id: 'task-2', subject: '阻塞任务', status: 'pending', ownerName: null, parentTaskId: 'task-1', blockedBy: ['task-1'] },
  ],
  lines: [
    { label: 'manager', status: 'online', lifecycle: 'active', generation: 1, officialTeamAvailable: true, officialTeamLead: true, deptSummary: { total: 2, done: 0, inProgress: 1, blocked: 1, stale: 0 }, subteamPolicy: null, maxMembers: null },
    { label: 'writer', status: 'online', lifecycle: 'active', generation: 1, officialTeamAvailable: true, officialTeamLead: true, deptSummary: { total: 2, done: 1, inProgress: 1, blocked: 0, stale: 0 }, subteamPolicy: 'ask', maxMembers: 2 },
    { label: 'reviewer', status: 'offline', lifecycle: 'active', generation: 1, officialTeamAvailable: false, officialTeamLead: false, deptSummary: null, subteamPolicy: null, maxMembers: null },
  ],
  messages: [{ id: 'msg-1', from: 'manager', to: 'writer', kind: 'task', state: 'acked', taskRef: 'task-1', at: now, summary: '写第一章' }],
  inbox: [{ id: pending.id, type: 'pending_approval', summary: '请审批' }],
  quality: [], deliveries: [],
}
const dept = {
  schemaVersion: 1, available: true, line: 'writer',
  officialTeam: { leadName: 'lead', members: [{ name: 'lead', role: 'lead' }, { name: 'writer-sub', role: 'teammate' }] },
  summary: { total: 2, done: 1, inProgress: 1, blocked: 0, stale: 0 },
  subteamAudit: { members: 2, tasks: 2, policies: ['ask'], maxMembers: 2, overLimit: false },
  tasks: [{ id: 'task-1', subject: 'W1', status: 'in_progress', parentTaskId: null, subteamPolicy: 'ask', maxMembers: 2 }, { id: 'task-2', subject: 'W2', status: 'completed', parentTaskId: null }],
  messages: [{ id: 'msg-2', from: 'writer', to: 'manager', kind: 'info', state: 'acked', at: now, summary: '完成' }],
}
const metrics = {
  schemaVersion: 1, generatedAt: now,
  tasks: { manager: { total: 2, done: 0, inProgress: 1, blocked: 1, stale: 0 }, byLine: [{ line: 'manager', total: 2, done: 0, inProgress: 1, blocked: 1 }, { line: 'writer', total: 2, done: 1, inProgress: 1, blocked: 0 }] },
  sessions: { lines: 3, officialMembers: 3 },
  messages: { total: 2, byKind: [{ kind: 'task', n: 2 }], byState: [{ state: 'acked', n: 2 }], trend: [{ day: '2026-11-10', n: 2 }] },
  tokens: { byLine: [{ line: 'manager', decodeTokens: 100 }, { line: 'writer', decodeTokens: 200 }], total: 300, basis: 'session-level; not per task' },
  lines: [{ label: 'manager', activity: { decodeTokens: 100 } }, { label: 'writer', activity: { decodeTokens: 200 } }],
  limitations: ['official tasks have no timestamps', 'tokens are session-level'],
}
for (const [name, data] of [['team-board.json', board], ['team-board.writer.json', dept], ['team-metrics.json', metrics]]) writeFileSync(join(dir, name), JSON.stringify(data))

const { server, url } = await startBoardServer({ dir, host: '127.0.0.1', port: 0, db, token: 'e2e', agentId: 'agent-lines', from: 'manager' })
let browser
const fails = []
const check = (ok, msg) => { if (!ok) fails.push(msg) }
const assertText = async (page, sel, text) => { const t = await page.locator(sel).innerText(); check(t.includes(text), 'text '+sel+' expected '+text+' got '+t) }
try {
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#tree .node', { timeout: 5000 })
  check(await page.locator('.card').count() === 4, '4 cards')
  check(await page.locator('.slot-title').count() === 4, '4 title slots')
  check(await page.locator('.slot-meta .slot-owner').count() === 4, '4 owner slots')
  check(await page.locator('.slot-meta .slot-time').count() === 4, '4 time slots')
  check(await page.locator('.slot-actions').count() === 4, '4 action slots')
  check(await page.locator('[data-level]').count() >= 4, 'data-level')
  await assertText(page, '#mainBody', '各线摘要')
  await page.click('[data-view="tasks"]'); await assertText(page, '#mainTitle', '任务')
  await page.click('[data-view="dept"]'); await assertText(page, '#mainBody', '该线未接官方团队')
  await page.click('#tree .node[data-id="writer"]'); await page.waitForTimeout(300)
  await assertText(page, '#sideBody', 'writer')
  await page.click('[data-view="dept"]'); await assertText(page, '#mainBody', 'writer-sub')
  await page.click('[data-view="comm"]'); await assertText(page, '#mainBody', '完成')
  await page.click('[data-view="metrics"]'); await assertText(page, '#mainBody', '300')
  await page.fill('#token', 'e2e'); await page.fill('#to', 'writer'); await page.fill('#text', 'E2E 消息'); await page.click('#send')
  await page.waitForTimeout(1800); await assertText(page, '#toast', 'OK')
  await page.click('#approve'); await page.waitForTimeout(300)
  check(errors.length === 0, 'page errors: '+errors.join('; '))
  await page.setViewportSize({ width: 768, height: 900 })
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'mobile no horizontal overflow')
  await page.screenshot({ path: '/tmp/uiux-board-066-1440.png', fullPage: true })
  console.log('E2E-066 '+(fails.length ? 'FAIL' : 'PASS'))
  for (const f of fails) console.log(' - '+f)
  process.exitCode = fails.length ? 1 : 0
} catch (e) {
  console.error('E2E-066 ERROR', e)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.close(r))
  try { store.close() } catch {}
  rmSync(dir, { recursive: true, force: true })
}