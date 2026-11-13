import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseCharter } from './team-workspace.js'
import { loadTeamWorkspace } from './team-workspace.js'
import { readTeamGoal, readDecisions, resolveTeamRootDir } from './team-init.js'
import { fileURLToPath } from 'node:url'

const HTML_PATH = fileURLToPath(new URL('../web/board.html', import.meta.url))
const ECHARTS_PATH = fileURLToPath(new URL('../web/vendor/echarts.min.js', import.meta.url))
const VERSION = (() => { try { return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version } catch { return null } })()

/** BOARD2 feature flag (0.12.0 board integration). Default OFF: board.html behavior and all new routes stay unchanged. */
const BOARD2 = (() => {
  const raw = String(process.env.DSH_AGENT_LINES_BOARD2 ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
})()

/** Read the team-root sidecar written next to lines.db by the plugin (best-effort). */
export function readTeamRootSidecar(dir) {
  try {
    const value = readFileSync(join(dir, 'team-root'), 'utf8').trim()
    return value === '' ? null : value
  } catch { return null }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(text)
}

async function readSnapshot(dir, name) {
  try { return JSON.parse(await readFile(join(dir, name), 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === 'object') {
    for (const key of ['items', 'rows', 'data', 'tasks']) if (Array.isArray(value[key])) return value[key]
    return Object.values(value)
  }
  return []
}

function normalizeTaskShape(raw) {
  const rawTasks = raw === null || typeof raw !== 'object' ? undefined : raw.tasks
  const tasks = asArray(rawTasks)
  let tasksShape = 'empty'
  if (Array.isArray(rawTasks)) tasksShape = 'array'
  else if (rawTasks !== null && typeof rawTasks === 'object') tasksShape = 'object'
  else if (typeof rawTasks === 'number') tasksShape = 'count'
  else if (rawTasks !== undefined) tasksShape = 'unknown'
  const tasksDiagnostic = tasksShape === 'count'
    ? '接口只返回任务计数 ' + rawTasks + '，缺少任务明细'
    : (tasksShape === 'unknown' ? 'tasks 结构无法识别' : null)
  return { tasks, tasksShape, tasksDiagnostic }
}

/** 0.11.2 P1-04: normalize snapshot shapes at the source (array / wrapped / object map / count). */
export function normalizeBoardSnapshot(raw) {
  if (raw === null || typeof raw !== 'object') {
    return { available: false, tasks: [], tasksShape: 'unknown', tasksDiagnostic: 'team-board snapshot is not an object', lines: [], members: [], messages: [], deliveries: [], inbox: [] }
  }
  return {
    ...raw,
    ...normalizeTaskShape(raw),
    members: asArray(raw.members),
    lines: asArray(raw.lines),
    messages: asArray(raw.messages),
    deliveries: asArray(raw.deliveries),
    inbox: asArray(raw.inbox),
  }
}

function safeLine(value) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function startBoardServer({ dir, dbPath = null, teamRoot = null, host = '127.0.0.1', port = 4090 } = {}) {
  if (!dir) throw new Error('snapshot directory is required')
  const explicitTeamRoot = teamRoot !== null && teamRoot !== undefined && String(teamRoot).trim() !== '' ? String(teamRoot) : null
  const boundTeamRoot = resolveTeamRootDir(explicitTeamRoot ?? readTeamRootSidecar(dir))
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'read-only' })

      if (url.pathname === '/') return sendText(res, 200, await readFile(HTML_PATH, 'utf8'), 'text/html; charset=utf-8')
      if (url.pathname === '/vendor/echarts.min.js') return sendText(res, 200, await readFile(ECHARTS_PATH, 'utf8'), 'application/javascript; charset=utf-8')
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, readOnly: true, version: VERSION })
      if (url.pathname === '/api/board-config') {
        if (!BOARD2) return sendJson(res, 404, { error: 'not found' })
        return sendJson(res, 200, { available: true, board2: true, version: VERSION, pages: { workitem: '/workitem', member: '/member' } })
      }
      if (url.pathname === '/api/live') {
        if (dbPath === null || !existsSync(dbPath)) return sendJson(res, 503, { available: false, error: 'lines.db not found' })
        const db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          const lines = db.prepare('SELECT label, role, title, status, lifecycle, generation, last_seen FROM lines ORDER BY created_at').all()
          const byState = db.prepare('SELECT state, COUNT(*) AS count FROM messages GROUP BY state').all()
          const counts = Object.fromEntries(byState.map(row => [row.state, Number(row.count)]))
          const rebindByLabel = new Map()
          for (const row of db.prepare(`SELECT line_id, old_session_id, new_session_id, reason, created_at FROM (
              SELECT line_id, old_session_id, new_session_id, reason, created_at,
                     ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY created_at DESC, rowid DESC) AS rn
              FROM line_events WHERE action='rebind'
            ) WHERE rn <= 10 ORDER BY created_at DESC`).all()) {
            const label = String(row.line_id ?? '')
            const at = label.lastIndexOf('#')
            const key = at >= 0 ? label.slice(at + 1) : label
            const list = rebindByLabel.get(key) ?? []
            if (list.length < 10) list.push({ at: row.created_at, from: row.old_session_id, to: row.new_session_id, reason: row.reason ?? null })
            rebindByLabel.set(key, list)
          }
          const trend = db.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count FROM messages GROUP BY day ORDER BY day DESC LIMIT 7").all().reverse()
          const sinceRaw = url.searchParams.get('since')
          const since = sinceRaw === null || String(sinceRaw).trim() === '' ? null : (Number.isFinite(Number(sinceRaw)) && Number(sinceRaw) >= 0 ? Number(sinceRaw) : null)
          const lineTaskRows = db.prepare("SELECT id, from_line, to_line, state, task_ref, parent_task_ref, body, created_at FROM (SELECT id, from_line, to_line, state, task_ref, parent_task_ref, body, created_at FROM messages INDEXED BY messages_kind_created WHERE kind = 'task' UNION ALL SELECT id, from_line, to_line, state, task_ref, parent_task_ref, body, created_at FROM messages INDEXED BY messages_task_ref_created WHERE task_ref IS NOT NULL AND kind <> 'task') ORDER BY created_at DESC, id DESC").all()
          const lineTasks = (() => {
            const byState = {}
            let total = 0
            let nullTaskRefCount = 0
            const byLineMap = new Map()
            const byTaskRefMap = new Map()
            for (const row of lineTaskRows) {
              total += 1
              byState[row.state] = (byState[row.state] ?? 0) + 1
              const line = String(row.to_line ?? '')
              const lineItem = byLineMap.get(line) ?? { line, total: 0, open: 0, acked: 0, failed: 0, latestAt: null, _refs: new Set() }
              lineItem.total += 1
              if (row.state === 'queued' || row.state === 'claimed' || row.state === 'delivered' || row.state === 'pending_approval') lineItem.open += 1
              else if (row.state === 'acked') lineItem.acked += 1
              else if (row.state === 'failed' || row.state === 'expired') lineItem.failed += 1
              const ref = row.task_ref === null || row.task_ref === undefined ? null : String(row.task_ref)
              if (ref !== null) lineItem._refs.add(ref)
              if (lineItem.latestAt === null || row.created_at > lineItem.latestAt) lineItem.latestAt = row.created_at
              byLineMap.set(line, lineItem)
              if (ref === null) { nullTaskRefCount += 1; continue }
              const item = byTaskRefMap.get(ref) ?? { taskRef: ref, parentTaskRef: null, messageCount: 0, byState: {}, byLineMap: new Map(), firstAt: row.created_at, latestAt: row.created_at }
              item.messageCount += 1
              item.byState[row.state] = (item.byState[row.state] ?? 0) + 1
              item.byLineMap.set(line, (item.byLineMap.get(line) ?? 0) + 1)
              if (row.created_at < item.firstAt) item.firstAt = row.created_at
              if (row.created_at > item.latestAt) item.latestAt = row.created_at
              if (item.parentTaskRef === null && row.parent_task_ref !== null && row.parent_task_ref !== undefined) item.parentTaskRef = String(row.parent_task_ref)
              byTaskRefMap.set(ref, item)
            }
            for (const item of byLineMap.values()) item.taskCount = item._refs.size
            const byTaskRefAll = [...byTaskRefMap.values()].map(item => ({
              taskRef: item.taskRef,
              parentTaskRef: item.parentTaskRef,
              messageCount: item.messageCount,
              byState: item.byState,
              byLine: [...item.byLineMap.entries()].map(([line, count]) => ({ line, count })).sort((a, b) => b.count - a.count || String(a.line).localeCompare(String(b.line))),
              firstAt: item.firstAt,
              latestAt: item.latestAt,
            })).sort((a, b) => b.latestAt - a.latestAt || String(a.taskRef).localeCompare(String(b.taskRef)))
            const byTaskRef = since === null ? byTaskRefAll : byTaskRefAll.filter(item => item.latestAt >= since)
            const byTaskRefWindow = since === null ? null : { since, taskRefCount: byTaskRef.length, messageCount: byTaskRef.reduce((n, item) => n + item.messageCount, 0), latestAt: byTaskRef.length ? Math.max(...byTaskRef.map(item => item.latestAt)) : null }
            const byLine = [...byLineMap.values()].map(item => ({ line: item.line, total: item.total, taskCount: item.taskCount, open: item.open, acked: item.acked, failed: item.failed, latestAt: item.latestAt }))
            const recent = lineTaskRows.slice(0, 10).map(row => ({ id: row.id, from: row.from_line, to: row.to_line, state: row.state, taskRef: row.task_ref ?? null, parentTaskRef: row.parent_task_ref ?? null, createdAt: row.created_at, summary: String(row.body ?? '').replace(/\s+/g, ' ').slice(0, 120) }))
            return { available: true, total, taskCount: byTaskRefAll.length, nullTaskRefCount, byState, byLine, recent, byTaskRef, since, byTaskRefWindow, filteredCount: byTaskRef.length, nextBefore: null, hasMore: false }
          })()
          let registryLines = null
          try { registryLines = JSON.parse(await readFile(join(boundTeamRoot, 'registry.json'), 'utf8')).lines ?? [] } catch {}
          const registryName = new Map((registryLines ?? []).map(line => [line.label, line.name]))
          const workspace = loadTeamWorkspace({ teamRoot: boundTeamRoot, lines: lines.map(line => ({ label: line.label })) })
          const teamGoal = readTeamGoal({ teamRoot: boundTeamRoot })
          const teamName = boundTeamRoot ? basename(String(boundTeamRoot)) : null
          const decisions = readDecisions({ teamRoot: boundTeamRoot })
          const data = {
            schemaVersion: 1, protocolVersion: '0.4', available: true,
            lines: lines.map(line => {
              const rebinds = rebindByLabel.get(line.label) ?? []
              return {
                label: line.label, role: line.role, title: line.title, registryName: registryName.get(line.label) ?? null,
                status: line.status, lifecycle: line.lifecycle, generation: line.generation, lastSeen: line.last_seen,
                oldSessionId: rebinds.length ? (rebinds[0].from ?? null) : null,
                rebinds,
              }
            }),
            messages: { total: byState.reduce((sum, row) => sum + Number(row.count), 0), byState, counts, trend },
            lineTasks,
            counts,
            teamWorkspace: { enabled: workspace.enabled, root: workspace.root ?? null, lines: await Promise.all((workspace.lines ?? []).map(async line => {
              let sections = null
              let header = null
              let missingSections = null
              try {
                const md = await readFile(join(workspace.root, line.source), 'utf8')
                const parsed = parseCharter(md, { source: line.source, updatedAt: line.updatedAt })
                sections = parsed.sections ?? null
                header = parsed.header ?? null
                missingSections = parsed.missingSections ?? null
              } catch {}
              return { ...line, name: registryName.get(line.label) ?? null, sections, header, missingSections }
            })) },
            teamName,
            teamGoal,
            decisions,
          }
          const etag = '"' + createHash('sha1').update(JSON.stringify(data)).digest('hex') + '"'
          if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-store' }); res.end(); return }
          const body = JSON.stringify({ ...data, generatedAt: Date.now() })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag })
          res.end(body)
          return
        } finally { db.close() }
      }
      if (url.pathname === '/api/team-metrics') {
        const metrics = await readSnapshot(dir, 'team-metrics.json')
        return metrics === null ? sendJson(res, 404, { error: 'team-metrics.json not found' }) : sendJson(res, 200, metrics)
      }
      if (url.pathname === '/api/team-board') {
        const board = await readSnapshot(dir, 'team-board.json')
        return board === null ? sendJson(res, 404, { error: 'team-board.json not found' }) : sendJson(res, 200, normalizeBoardSnapshot(board))
      }
      const match = url.pathname.match(/^\/api\/team-board\/([^/]+)$/)
      if (match) {
        const line = safeLine(decodeURIComponent(match[1]))
        const board = await readSnapshot(dir, 'team-board.' + line + '.json')
        return board === null ? sendJson(res, 404, { error: 'department snapshot not found', line }) : sendJson(res, 200, normalizeBoardSnapshot(board))
      }
      return sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve({ server, url: 'http://' + host + ':' + server.address().port + '/', teamRoot: boundTeamRoot }))
  })
}