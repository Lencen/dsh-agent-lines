import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

export function startBoardServer({ dir, host = '127.0.0.1', port = 4090 } = {}) {
  if (!dir) throw new Error('snapshot directory is required')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'read-only' })

      if (url.pathname === '/') return sendText(res, 200, await readFile(HTML_PATH, 'utf8'), 'text/html; charset=utf-8')
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, readOnly: true })
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