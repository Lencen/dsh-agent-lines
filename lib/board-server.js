import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseCharter } from './team-workspace.js'
import { loadTeamWorkspace } from './team-workspace.js'
import { readTeamGoal, readDecisions } from './team-init.js'
import { fileURLToPath } from 'node:url'

const HTML_PATH = fileURLToPath(new URL('../web/board.html', import.meta.url))
const ECHARTS_PATH = fileURLToPath(new URL('../web/vendor/echarts.min.js', import.meta.url))
const VERSION = (() => { try { return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version } catch { return null } })()

/**
 * 0.11.0-29: accept either a team dir or a parent dir. A parent without TEAM.md/registry.json
 * resolves to the newest child team (mtime), so a board can follow the team a manager just created.
 */
function resolveTeamRoot(input) {
  if (input === null || input === undefined || String(input).trim() === '') return null
  const root = String(input).trim()
  try {
    if (existsSync(join(root, 'registry.json')) || existsSync(join(root, 'TEAM.md'))) return root
    const teams = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, entry.name))
      .filter(dir => existsSync(join(dir, 'registry.json')) || existsSync(join(dir, 'TEAM.md')))
    if (teams.length === 0) return root
    teams.sort((a, b) => { try { return statSync(b).mtimeMs - statSync(a).mtimeMs } catch { return 0 } })
    return teams[0]
  } catch { return root }
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

function safeLine(value) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function startBoardServer({ dir, dbPath = null, teamRoot = null, host = '127.0.0.1', port = 4090 } = {}) {
  if (!dir) throw new Error('snapshot directory is required')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'read-only' })

      if (url.pathname === '/') return sendText(res, 200, await readFile(HTML_PATH, 'utf8'), 'text/html; charset=utf-8')
      if (url.pathname === '/vendor/echarts.min.js') return sendText(res, 200, await readFile(ECHARTS_PATH, 'utf8'), 'application/javascript; charset=utf-8')
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, readOnly: true, version: VERSION })
      if (url.pathname === '/api/live') {
        if (dbPath === null || !existsSync(dbPath)) return sendJson(res, 503, { available: false, error: 'lines.db not found' })
        const boundTeamRoot = resolveTeamRoot(teamRoot)
        const db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          const lines = db.prepare('SELECT label, role, title, status, lifecycle, generation, last_seen FROM lines ORDER BY created_at').all()
          const byState = db.prepare('SELECT state, COUNT(*) AS count FROM messages GROUP BY state').all()
          const trend = db.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count FROM messages GROUP BY day ORDER BY day DESC LIMIT 7").all().reverse()
          let registryLines = null
          try { registryLines = JSON.parse(await readFile(join(boundTeamRoot, 'registry.json'), 'utf8')).lines ?? [] } catch {}
          const registryName = new Map((registryLines ?? []).map(line => [line.label, line.name]))
          const workspace = loadTeamWorkspace({ teamRoot: boundTeamRoot, lines: lines.map(line => ({ label: line.label })) })
          const teamGoal = readTeamGoal({ teamRoot: boundTeamRoot })
          const teamName = boundTeamRoot ? basename(String(boundTeamRoot)) : null
          const decisions = readDecisions({ teamRoot: boundTeamRoot })
          const data = {
            schemaVersion: 1, protocolVersion: '0.4', available: true,
            lines: lines.map(line => ({ label: line.label, role: line.role, title: line.title, registryName: registryName.get(line.label) ?? null, status: line.status, lifecycle: line.lifecycle, generation: line.generation, lastSeen: line.last_seen })),
            messages: { total: byState.reduce((sum, row) => sum + Number(row.count), 0), byState, trend },
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
            tokens: { available: false, reason: 'live token trend needs tokenSample aggregation (phase 2)' },
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
        return board === null ? sendJson(res, 404, { error: 'team-board.json not found' }) : sendJson(res, 200, board)
      }
      const match = url.pathname.match(/^\/api\/team-board\/([^/]+)$/)
      if (match) {
        const line = safeLine(decodeURIComponent(match[1]))
        const board = await readSnapshot(dir, 'team-board.' + line + '.json')
        return board === null ? sendJson(res, 404, { error: 'department snapshot not found', line }) : sendJson(res, 200, board)
      }
      return sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve({ server, url: 'http://' + host + ':' + server.address().port + '/' }))
  })
}