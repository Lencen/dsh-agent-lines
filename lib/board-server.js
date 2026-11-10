import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadTeamWorkspace } from './team-workspace.js'
import { fileURLToPath } from 'node:url'

const HTML_PATH = fileURLToPath(new URL('../web/board.html', import.meta.url))

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
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, readOnly: true })
      if (url.pathname === '/api/live') {
        if (dbPath === null || !existsSync(dbPath)) return sendJson(res, 503, { available: false, error: 'lines.db not found' })
        const db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          const lines = db.prepare('SELECT label, role, title, status, lifecycle, generation, last_seen FROM lines ORDER BY created_at').all()
          const byState = db.prepare('SELECT state, COUNT(*) AS count FROM messages GROUP BY state').all()
          const trend = db.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count FROM messages GROUP BY day ORDER BY day DESC LIMIT 7").all().reverse()
          const workspace = loadTeamWorkspace({ teamRoot, lines: lines.map(line => ({ label: line.label })) })
          const data = {
            schemaVersion: 1, protocolVersion: '0.4', available: true,
            lines: lines.map(line => ({ label: line.label, role: line.role, title: line.title, status: line.status, lifecycle: line.lifecycle, generation: line.generation, lastSeen: line.last_seen })),
            messages: { total: byState.reduce((sum, row) => sum + Number(row.count), 0), byState, trend },
            teamWorkspace: { enabled: workspace.enabled, root: workspace.root ?? null, lines: workspace.lines ?? [] },
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