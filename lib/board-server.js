import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LineStore } from './store.js'

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk; if (raw.length > 65536) req.destroy() })
    req.on('end', () => { try { resolve(raw === '' ? {} : JSON.parse(raw)) } catch (error) { reject(error) } })
    req.on('error', reject)
  })
}

export function startBoardServer({ dir, host = '127.0.0.1', port = 4090, db = null, token = null, agentId = 'agent-deepseek', from = 'manager' } = {}) {
  if (!dir) throw new Error('snapshot directory is required')
  const store = db === null ? null : new LineStore(db)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'POST' && url.pathname.startsWith('/api/actions/')) {
        if (store === null) return sendJson(res, 503, { error: 'actions disabled: start with --db' })
        if (token === null || req.headers['x-board-token'] !== token) return sendJson(res, 403, { error: 'invalid board token' })
        const body = await readBody(req)
        if (url.pathname === '/api/actions/send') {
          const to = String(body.to ?? '').trim()
          const text = String(body.text ?? '').trim()
          if (to === '' || text === '') return sendJson(res, 400, { error: 'to and text are required' })
          const kind = ['info', 'request', 'task', 'alert'].includes(body.kind) ? body.kind : 'info'
          const row = store.send({ agentId, fromLine: from, to, text, kind })
          return sendJson(res, 200, { ok: true, id: row.id, state: row.state })
        }
        if (url.pathname === '/api/actions/approve' || url.pathname === '/api/actions/reject') {
          const messageId = String(body.messageId ?? '').trim()
          if (messageId === '') return sendJson(res, 400, { error: 'messageId is required' })
          const decision = url.pathname.endsWith('approve') ? 'approve' : 'reject'
          const row = store.approveMessage({ messageId, decision, actor: from })
          return sendJson(res, 200, { ok: true, id: row.id, state: row.state, approved: row.approved })
        }
        if (url.pathname === '/api/actions/handoff') {
          const line = String(body.line ?? '').trim()
          if (line === '') return sendJson(res, 400, { error: 'line is required' })
          return sendJson(res, 200, { ok: true, handoff: store.handoff({ agentId, line }) })
        }
        return sendJson(res, 404, { error: 'unknown action' })
      }
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
    server.once('close', () => { try { store?.close() } catch { /* best effort */ } })
    server.listen(port, host, () => resolve({ server, url: 'http://' + host + ':' + server.address().port + '/', token }))
  })
}