#!/usr/bin/env node
/**
 * dsh-agent-lines CLI: inspect and drive the same SQLite queue the plugin uses.
 * It does not start DSH or load any Session.
 */
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { LineStore, defaultDbPath } from '../lib/store.js'
import { LineError, PROTOCOL_VERSION, lineId } from '../lib/protocol.js'
import { loadTeamWorkspace } from '../lib/team-workspace.js'
import { startBoardServer } from '../lib/board-server.js'

function usage() {
  console.error(`Usage:
  dsh-agent-lines [--db <path>] [--json] observe [--line <line>] [--since <epochMs>] [--limit N] [--agent <id>]
  dsh-agent-lines [--db <path>] [--json] list
  dsh-agent-lines [--db <path>] [--json] status [--team-root <dir>] [--agent <id>]
  dsh-agent-lines [--db <path>] [--json] send --from <line> --to <line|agent#line> --text <text> [--agent <id>] [--key <key>] [--reply-to <id>]
  dsh-agent-lines [--db <path>] [--json] inbox --line <line> [--agent <id>] [--limit N] [--all]
  dsh-agent-lines [--db <path>] [--json] ack --line <line> --id <messageId> [--agent <id>]
  dsh-agent-lines [--db <path>] [--json] claim --line <line> --session <sessionId> [--agent <id>]
  dsh-agent-lines [--db <path>] [--json] doctor
  dsh-agent-lines [--db <path>] [--json] tail --line <line> [--agent <id>]
  dsh-agent-lines board [--dir <snapshotDir>] [--host 127.0.0.1] [--port 4090]

Environment: DSH_AGENT_LINES_DB overrides the default DB path.
`)
}

function parse(argv) {
  const opts = { json: false, db: process.env.DSH_AGENT_LINES_DB ?? defaultDbPath() }
  const positional = []
  const args = [...argv]
  while (args.length > 0) {
    const token = args.shift()
    if (token === '--json') { opts.json = true; continue }
    if (token === '--db') { opts.db = args.shift() ?? ''; continue }
    if (token.startsWith('--db=')) { opts.db = token.slice(5); continue }
    if (token === '--help' || token === '-h') { usage(); process.exit(0) }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = args[0]
      opts[key] = next === undefined || next.startsWith('--') ? true : args.shift()
      continue
    }
    positional.push(token)
  }
  return { command: positional.shift(), rest: positional, opts }
}

function print(value, json) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + '\n')
  else if (typeof value === 'string') process.stdout.write(value + '\n')
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function need(value, name) {
  if (value === undefined || String(value).trim() === '') throw new LineError('LINE_INVALID_ARGUMENT', `--${name} is required`)
  return String(value)
}

async function main() {
  const { command, opts } = parse(process.argv.slice(2))
  if (command === undefined) { usage(); return 2 }
  if (command === 'board') {
    const dir = String(opts.dir ?? dirname(opts.db))
    const host = String(opts.host ?? '127.0.0.1')
    const port = Number(opts.port ?? 4090)
    const { server, url } = await startBoardServer({ dir, host, port })
    console.log(`[agent-lines] board: ${url}`)
    console.log(`[agent-lines] snapshots: ${dir}`)
    console.log('[agent-lines] read-only')
    process.on('SIGINT', () => { server.close(() => process.exit(0)) })
    return 0
  }
  if (!existsSync(opts.db) && command !== 'doctor') {
    console.error(`[agent-lines] database not found: ${opts.db}`)
    return 2
  }
  const store = new LineStore(opts.db)
  try {
    if (command === 'observe') {
      const result = store.observe({
        agentId: String(opts.agent ?? 'agent-deepseek'),
        line: opts.line === undefined ? null : String(opts.line),
        since: Number(opts.since ?? 0),
        limit: Number(opts.limit ?? 100),
      })
      print({ db: store.dbPath, ...result }, opts.json)
      return 0
    }
    if (command === 'list') {
      print({ db: store.dbPath, lines: store.listLines(), counts: store.counts() }, opts.json)
      return 0
    }
    if (command === 'status') {
      const lines = store.listLines()
      const agent = opts.agent !== undefined ? String(opts.agent) : (lines.length > 0 ? String(lines[0].agent_id ?? 'agent-deepseek') : 'agent-deepseek')
      const stats = store.messageStats({ agentId: agent })
      const counts = store.counts()
      const trend = store.messageTrend({ agentId: agent, days: 7 })
      const tokenTrend = store.tokenTrend({ agentId: agent, lines: lines.map(line => line.label), days: 7 })
      const teamRoot = opts['team-root'] !== undefined ? String(opts['team-root']) : process.env.DSH_AGENT_LINES_TEAM_ROOT
      const workspace = teamRoot === undefined || String(teamRoot).trim() === '' ? { enabled: false } : loadTeamWorkspace({ teamRoot, lines })
      const payload = {
        schemaVersion: 1,
        protocolVersion: PROTOCOL_VERSION,
        generatedAt: Date.now(),
        agent,
        db: store.dbPath,
        counts,
        lines: lines.map(line => ({
          label: line.label, role: line.role, title: line.title, lifecycle: line.lifecycle, status: line.status,
          pending: line.pending, generation: line.generation, lastActivityAt: line.lastActivityAt,
        })),
        messages: { total: stats.total, byKind: stats.byKind, byState: stats.byState, trend },
        tokens: { total: tokenTrend.lines.reduce((sum, item) => sum + (item.latest ?? 0), 0), today: tokenTrend.today, perDay: tokenTrend.perDay, byLine: tokenTrend.lines, basis: tokenTrend.basis },
        teamWorkspace: { enabled: workspace.enabled, root: workspace.root ?? null, error: workspace.error ?? null, registryError: workspace.registryError ?? null, lines: workspace.lines ?? [] },
      }
      print(payload, opts.json)
      return 0
    }
    if (command === 'doctor') {
      const agent = String(opts.agent ?? 'agent-deepseek')
      const counts = store.counts()
      const lines = store.listLines()
      const ackTimeoutMs = Number(opts['ack-timeout'] ?? 600000)
      const failed = Number(counts.failed ?? 0)
      const expired = Number(counts.expired ?? 0)
      let stale = 0
      for (const line of lines) stale += store.ackOverdue({ agentId: agent, line: line.label, timeoutMs: ackTimeoutMs }).length
      const hints = []
      if (failed > 0) hints.push('failed=' + failed + ': in the manager session run line_messages({states:["failed"]}), then line_redeliver({messageId}) to retry or line_purge({before,...}) to clean')
      if (expired > 0) hints.push('expired=' + expired + ': in the manager session run line_messages({states:["expired"]}); redeliver if still wanted, otherwise line_purge({before,...})')
      if (stale > 0) hints.push('ackOverdue=' + stale + ' (delivered older than ' + ackTimeoutMs + 'ms): check the target Session; line_ack when handled, or line_redeliver if a deliberate repeat is intended (never auto-retried)')
      if (failed === 0 && expired === 0 && stale === 0) hints.push('no failed/expired/ack-overdue messages')
      print({
        db: store.dbPath,
        exists: existsSync(store.dbPath),
        counts,
        health: { failed, expired, ackOverdue: stale, ackTimeoutMs },
        hints,
        lines,
      }, opts.json)
      return 0
    }
    if (command === 'send') {
      const from = need(opts.from, 'from')
      const to = need(opts.to, 'to')
      const text = need(opts.text, 'text')
      const row = store.send({
        agentId: String(opts.agent ?? 'agent-deepseek'),
        fromLine: from,
        to,
        text,
        idempotencyKey: opts.key,
        replyTo: opts['reply-to'],
      })
      print({ id: row.id, from: `${row.from_agent}#${row.from_line}`, to: `${row.to_agent}#${row.to_line}`, state: row.state, deduplicated: row.deduplicated === true }, opts.json)
      return 0
    }
    if (command === 'inbox') {
      const line = need(opts.line, 'line')
      const messages = store.inbox({
        agentId: String(opts.agent ?? 'agent-deepseek'),
        line,
        limit: Number(opts.limit ?? 20),
        includeAcked: opts.all === '' || opts.all === true,
      })
      print({ line, messages }, opts.json)
      return 0
    }
    if (command === 'claim') {
      const line = need(opts.line, 'line')
      const sessionId = need(opts.session, 'session')
      const agentId = String(opts.agent ?? 'agent-deepseek')
      const claim = store.requestClaim({ agentId, lineId: lineId(agentId, line), sessionId })
      print({
        claimId: claim.id,
        lineId: claim.line_id,
        sessionId: claim.session_id,
        state: claim.state,
        reused: claim.reused === true,
        note: 'The running plugin will claim this request; ensure allowClaim: true.',
      }, opts.json)
      return 0
    }
    if (command === 'ack') {
      const line = need(opts.line, 'line')
      const id = need(opts.id, 'id')
      const row = store.markAck({ agentId: String(opts.agent ?? 'agent-deepseek'), line, messageId: id })
      print({ id: row.id, state: row.state, acked: true, alreadyAcked: row.alreadyAcked === true }, opts.json)
      return 0
    }
    if (command === 'tail') {
      const line = need(opts.line, 'line')
      const agentId = String(opts.agent ?? 'agent-deepseek')
      let seen = new Set()
      const tick = () => {
        const messages = store.messagesForLine({ agentId, line, limit: 100 })
        for (const row of messages) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          print({ id: row.id, from: `${row.from_agent}#${row.from_line}`, state: row.state, text: row.body }, opts.json)
        }
      }
      opts.keepOpen = true
      tick()
      setInterval(tick, 1000)
      process.on('SIGINT', () => { store.close(); process.exit(0) })
      return 0
    }
    console.error(`[agent-lines] unknown command: ${command}`)
    usage()
    return 2
  } catch (error) {
    console.error(`[agent-lines] ${error?.code ?? 'ERROR'}: ${error?.message ?? String(error)}`)
    return error?.code === 'LINE_LEASE_HELD' ? 3 : 1
  } finally {
    if (opts.keepOpen !== true) store.close()
  }
}

process.exitCode = await main()