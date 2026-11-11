/**
 * dsh-agent-lines host plugin.
 *
 * A DSH process can host one or more lines. Each line is bound to an ordinary
 * DSH Session; only this process writes that Session. A manager line with
 * `allowCreate: true` can create additional lines at runtime with line_create.
 */
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { DeliveryLoop } from './delivery.js'
import { initTeamWorkspace } from './team-init.js'
import { defaultDbPath, expandHome } from './store.js'
import { createTransport, TRANSPORTS } from './transport.js'
import { bindAgentPrompt } from './prompt.js'
import { activityOf, registerClaimTool, registerStatusTool, registerToolsForAgent } from './tools.js'
import { LineError, lineId, validateAgentId, validateLineLabel } from './protocol.js'
import { probeCapabilities, requireCapability } from './capabilities.js'

export const name = 'agent-lines'
export const inject = ['tools', 'sessionController', 'agents']

function integer(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new LineError('LINE_INVALID_CONFIG', `Expected an integer from ${min} to ${max}, got ${JSON.stringify(value)}`)
  }
  return number
}

function normalizeLine(entry, agentId, index) {
  if (entry === null || typeof entry !== 'object') {
    throw new LineError('LINE_INVALID_CONFIG', `lines[${index}] must be an object`)
  }
  const label = validateLineLabel(entry.label)
  const sessionId = String(entry.sessionId ?? '').trim()
  if (sessionId.length === 0) throw new LineError('LINE_INVALID_CONFIG', `lines[${index}].sessionId is required`)
  const role = entry.role === undefined || entry.role === null ? null : String(entry.role).trim() || null
  const title = entry.title === undefined || entry.title === null ? null : String(entry.title).trim() || null
  return { agentId, label, sessionId, lineId: lineId(agentId, label), role, title }
}

/** Validate and normalize plugin config. Exported for tests and the CLI. */
export function normalizeConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object') throw new LineError('LINE_INVALID_CONFIG', 'Plugin config must be an object')
  const legacy = raw.line !== undefined && raw.sessionId !== undefined
    ? [{ label: raw.line, sessionId: raw.sessionId }]
    : []
  const rawLines = Array.isArray(raw.lines) ? raw.lines : legacy
  const zeroConfig = rawLines.length === 0 && raw.lines === undefined && raw.line === undefined
  const agentId = raw.agentId === undefined && zeroConfig
    ? 'agent-lines'
    : validateAgentId(raw.agentId)
  if (rawLines.length === 0 && !zeroConfig) throw new LineError('LINE_INVALID_CONFIG', 'At least one line is required (lines[] or line/sessionId)')
  const lines = zeroConfig
    ? [{ agentId, label: 'manager', sessionId: '', lineId: lineId(agentId, 'manager'), role: '负责人' }]
    : rawLines.map((entry, index) => normalizeLine(entry, agentId, index))
  const labels = new Set()
  const sessions = new Set()
  for (const line of lines) {
    if (labels.has(line.label)) throw new LineError('LINE_INVALID_CONFIG', `Duplicate line label: ${line.label}`)
    if (line.sessionId !== '' && sessions.has(line.sessionId)) throw new LineError('LINE_INVALID_CONFIG', `Duplicate sessionId: ${line.sessionId}`)
    labels.add(line.label)
    if (line.sessionId !== '') sessions.add(line.sessionId)
  }
  const createFrom = raw.createFrom === undefined ? lines[0].label : validateLineLabel(raw.createFrom)
  if (!labels.has(createFrom)) throw new LineError('LINE_INVALID_CONFIG', `createFrom must name a configured line: ${createFrom}`)
  const transport = raw.transport === undefined ? 'sqlite' : String(raw.transport)
  if (!TRANSPORTS.includes(transport)) throw new LineError('LINE_INVALID_CONFIG', `Unsupported transport: ${transport}`, { transports: TRANSPORTS })
  const dbPath = expandHome(raw.dbPath ?? process.env.DSH_AGENT_LINES_DB ?? defaultDbPath())
  return {
    agentId,
    dbPath,
    transport,
    lines,
    createFrom,
    maxLines: integer(raw.maxLines, 16, { min: Math.max(1, lines.length), max: 256 }),
    allowCreate: raw.allowCreate === undefined ? zeroConfig : raw.allowCreate === true,
    allowClaim: raw.allowClaim === undefined ? zeroConfig : raw.allowClaim === true,
    bootstrapOnCreate: raw.bootstrapOnCreate === undefined ? true : raw.bootstrapOnCreate === true,
    allowSelfSend: raw.allowSelfSend === true,
    dedupeWindowMs: integer(raw.dedupeWindowMs ?? (process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS === undefined ? undefined : process.env.DSH_AGENT_LINES_DEDUPE_WINDOW_MS), 5_000, { min: 0, max: 3_600_000 }),
    maxReplyDepth: integer(raw.maxReplyDepth, 8, { min: 1, max: 100 }),
    childPreset: String(raw.childPreset ?? 'standard'),
    pollMs: integer(raw.pollMs, 500, { min: 100, max: 60_000 }),
    leaseTtlMs: integer(raw.leaseTtlMs, 30_000, { min: 3_000, max: 3_600_000 }),
    claimBatch: integer(raw.claimBatch, 20, { min: 1, max: 100 }),
    claimTimeoutMs: integer(raw.claimTimeoutMs, 30_000, { min: 5_000, max: 3_600_000 }),
    deliveryTimeoutMs: integer(raw.deliveryTimeoutMs, 30_000, { min: 1_000, max: 300_000 }),
    ackTimeoutMs: integer(raw.ackTimeoutMs, 600_000, { min: 60_000, max: 86_400_000 }),
    tokenSampleMs: integer(raw.tokenSampleMs, 60_000, { min: 5_000, max: 3_600_000 }),
    tokenRetentionDays: integer(raw.tokenRetentionDays, 30, { min: 1, max: 365 }),
    teamRoot: (() => { const value = raw.teamRoot !== undefined ? raw.teamRoot : process.env.DSH_AGENT_LINES_TEAM_ROOT; return value === undefined || value === null || String(value).trim() === '' ? null : expandHome(String(value).trim()) })(),
    maxAttempts: integer(raw.maxAttempts, 8, { min: 1, max: 100 }),
    maxMessageBytes: integer(raw.maxMessageBytes, 65_536, { min: 256, max: 1_048_576 }),
    instanceId: String(raw.instanceId ?? process.env.DSH_AGENT_LINES_INSTANCE ?? randomUUID()),
  }
}

function loopConfig(config, def) {
  return {
    agentId: config.agentId,
    line: def.label,
    lineId: def.lineId,
    sessionId: def.sessionId,
    role: def.role,
    instanceId: config.instanceId,
    pollMs: config.pollMs,
    leaseTtlMs: config.leaseTtlMs,
    claimBatch: config.claimBatch,
    claimTimeoutMs: config.claimTimeoutMs,
    deliveryTimeoutMs: config.deliveryTimeoutMs,
    maxAttempts: config.maxAttempts,
    maxMessageBytes: config.maxMessageBytes,
  }
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} rawConfig
 */
export async function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const store = createTransport(config)
  const lineDefs = new Map()
  const loops = []
  const bindings = new Map()
  const cleanupFns = []
  let statusDisposer
  let claimDisposer
  let claimTimer
  let tokenTimer
  let lastTokenPruneAt = 0
  let claiming = false
  let closed = false

  const bindAgent = (agent) => {
    const def = lineDefs.get(agent.session.id)
    if (def === undefined || bindings.has(agent.session.id)) return
    const binding = {
      prompt: bindAgentPrompt(agent, def),
      tools: registerToolsForAgent(agent, def, { config, store, lineDefs, createLine, moveLineWorkspace, retireLine, rebindLine, renameLine, hibernateLine, wakeLine, setRoleLine, initTeam }),
    }
    bindings.set(agent.session.id, binding)
  }

  const unbindAgent = (agent) => {
    const binding = bindings.get(agent.session.id)
    if (binding !== undefined) {
      for (const dispose of binding.tools.reverse()) {
        try { dispose?.() } catch { /* best effort */ }
      }
      try { binding.prompt() } catch { /* best effort */ }
      bindings.delete(agent.session.id)
    }
  }

  const renameTitle = async (def) => {
    if (def.sessionId === undefined || def.sessionId === '') return
    const title = String(def.title || def.role || def.label || 'agent line').slice(0, 120)
    try {
      await ctx.sessionController?.rename?.({ sessionId: def.sessionId, title })
    } catch (error) {
      ctx.logger?.warn?.('agent-lines: rename %s failed: %s', def.label, String(error))
    }
  }

  const startLoop = (def) => {
    const loop = new DeliveryLoop({ ctx, config: loopConfig(config, def), store, logger: ctx.logger })
    loops.push(loop)
    loop.start()
    void renameTitle(def)
  }

  const sessionExists = async (sessionId) => {
    if (ctx.agents.get(sessionId) !== undefined) return true
    const persistence = ctx.get?.('sessionPersistence')
    if (persistence?.stat === undefined) return true
    try { return (await persistence.stat(sessionId)) !== undefined } catch { return false }
  }

  const resolveWorkspace = async (ref, { soft = false } = {}) => {
    const text = String(ref ?? '').trim()
    if (text.length === 0) throw new LineError('WORKSPACE_NOT_FOUND', 'workspace is required')
    const registry = ctx.get?.('workspaceRegistry')
    if (registry === undefined) { if (soft) return undefined; throw new LineError('WORKSPACE_UNAVAILABLE', 'workspaceRegistry is not mounted in this profile') }
    const byId = registry.get?.(text)
    if (byId !== undefined) return byId
    if (typeof registry.resolveByPath !== 'function') throw new LineError('WORKSPACE_NOT_FOUND', `No workspace: ${text}`)
    try {
      const byPath = await registry.resolveByPath(text)
      if (byPath !== undefined) return byPath
    } catch { /* fall through to not-found */ }
    throw new LineError('WORKSPACE_NOT_FOUND', `No workspace at path or id: ${text}`, { workspace: text })
  }

  const managerWorkspace = async (cwd) => {
    const registry = ctx.get?.('workspaceRegistry')
    if (registry?.resolveByPath === undefined) return undefined
    try { return await registry.resolveByPath(cwd) } catch { return undefined }
  }

  const moveLineWorkspace = async (args) => {
    const label = validateLineLabel(args.line)
    const target = await resolveWorkspace(args.workspace)
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    try {
      await target.attachSession(row.session_id)
    } catch (error) {
      throw new LineError('WORKSPACE_ATTACH_FAILED', `Cannot attach ${row.session_id} to ${target.path}: ${error?.message ?? String(error)}`, {
        line: label, sessionId: row.session_id, workspaceId: target.id, path: target.path,
      })
    }
    return { line: label, sessionId: row.session_id, workspaceId: target.id, path: target.path, attached: true }
  }

  const stopLoopFor = async (label) => {
    const index = loops.findIndex(loop => loop.config.line === label)
    if (index < 0) return
    const [loop] = loops.splice(index, 1)
    try { await loop.stop() } catch (error) { ctx.logger?.warn?.('agent-lines: stop old loop %s failed: %s', label, String(error)) }
  }

  const rebindManager = async (agent) => {
    const managerLabel = config.createFrom
    const managerLine = lineId(config.agentId, managerLabel)
    const targetId = agent.session.id
    const oldDef = [...lineDefs.values()].find(line => line.label === managerLabel)
    if (oldDef?.sessionId === targetId) {
      bindAgent(agent)
      return oldDef
    }
    const existing = lineDefs.get(targetId)
    if (existing !== undefined && existing.label !== managerLabel) {
      throw new LineError('LINE_SESSION_BOUND', `Session ${targetId} is already bound to ${existing.label}`, { sessionId: targetId, line: existing.label })
    }
    const oldAgent = oldDef === undefined ? undefined : ctx.agents.get(oldDef.sessionId)
    if (oldAgent !== undefined && oldAgent !== agent) unbindAgent(oldAgent)
    await stopLoopFor(managerLabel)
    const role = oldDef?.role ?? null
    const createdBy = oldDef?.createdBy ?? null
    store.acquire({
      agentId: config.agentId,
      line: managerLabel,
      sessionId: targetId,
      instanceId: config.instanceId,
      ttlMs: config.leaseTtlMs,
      role,
      createdBy,
    })
    if (oldDef !== undefined) lineDefs.delete(oldDef.sessionId)
    const def = { agentId: config.agentId, label: managerLabel, sessionId: targetId, lineId: managerLine, role, createdBy }
    store.setManagerBinding({ agentId: config.agentId, lineId: managerLine, sessionId: targetId })
    lineDefs.set(targetId, def)
    startLoop(def)
    bindAgent(agent)
    return def
  }

  const processClaims = async () => {
    if (closed || claiming || !config.allowClaim) return
    claiming = true
    try {
      const managerLine = lineId(config.agentId, config.createFrom)
      for (const claim of store.pendingClaims(config.agentId)) {
        try {
          if (claim.line_id !== managerLine) {
            store.resolveClaim(claim.id, 'rejected', 'NOT_MANAGER_LINE')
            continue
          }
          const agent = ctx.agents.get(claim.session_id)
          if (agent === undefined) {
            store.resolveClaim(claim.id, 'rejected', 'SESSION_NOT_LIVE')
            continue
          }
          if (!ctx.agents.roots().includes(agent)) {
            store.resolveClaim(claim.id, 'rejected', 'NOT_ROOT')
            continue
          }
          await rebindManager(agent)
          store.resolveClaim(claim.id, 'claimed', null)
          ctx.logger?.info?.('agent-lines: manager line claimed by Session %s', claim.session_id)
        } catch (error) {
          const code = error?.code ?? 'CLAIM_FAILED'
          store.resolveClaim(claim.id, 'rejected', `${code}: ${error?.message ?? String(error)}`)
          ctx.logger?.warn?.('agent-lines: claim %s rejected: %s', claim.id, String(error))
        }
      }
    } finally {
      claiming = false
    }
  }

  // systemd restarts can exit before Cordis runs async cleanup; release leases synchronously.
  const releaseAll = () => {
    for (const def of lineDefs.values()) {
      try { store.release({ agentId: config.agentId, line: def.label, instanceId: config.instanceId }) } catch { /* best effort */ }
    }
  }
  process.once('exit', releaseAll)

  const rebinding = new Set()

  const lineTitle = (def, row) => String((row && row.title) || (def && def.title) || (def && def.role) || (def && def.label) || 'agent line').slice(0, 120)

  const rebindLine = async ({ label, sessionId, actor, reason, migrate = 'queued', force = false, notify = true }) => {
    if (label === config.createFrom) throw new LineError('LINE_MANAGER_REBIND_UNSUPPORTED', 'The manager line is rebound with line_claim_manager, not line_rebind', { line: label })
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    if (rebinding.has(label) || row.lifecycle === 'rebinding') throw new LineError('LINE_REBIND_BUSY', `Line ${label} is already rebinding`, { line: label })
    if (row.lifecycle === 'hibernating') throw new LineError('LINE_HIBERNATING', `Line ${label} is hibernating; wake it with line_wake first`, { line: label })
    if (!(await sessionExists(sessionId))) throw new LineError('LINE_SESSION_NOT_FOUND', `Session is not live or persisted: ${sessionId}`, { sessionId })
    const target = lineDefs.get(sessionId)
    if (target !== undefined && target.label !== label) throw new LineError('LINE_SESSION_BOUND', `Session ${sessionId} is already bound to ${target.label}`, { sessionId, line: target.label })
    const oldDef = [...lineDefs.values()].find(line => line.label === label)
    if (oldDef !== undefined && oldDef.sessionId === sessionId) {
      return { line: label, oldSessionId: row.session_id, newSessionId: sessionId, generation: row.generation, counts: store.messageCounts({ agentId: config.agentId, line: label }), already: true }
    }
    const oldLifecycle = row.lifecycle || 'active'
    const oldAgent = oldDef === undefined ? undefined : ctx.agents.get(oldDef.sessionId)
    rebinding.add(label)
    let locked = false
    try {
      store.setLifecycle({ agentId: config.agentId, line: label, lifecycle: 'rebinding', actor, reason })
      locked = true
      await stopLoopFor(label)
      if (oldDef !== undefined) lineDefs.delete(oldDef.sessionId)
      if (oldAgent !== undefined) unbindAgent(oldAgent)
      const updated = store.rebind({
        agentId: config.agentId, line: label, sessionId, actor, reason, migrate, locked: true,
      })
      // F1 fix: rebind deliberately clears the old lease; the new line must acquire one
      // before startLoop, otherwise heartbeat throws LINE_LEASE_LOST and messages stay queued.
      store.acquire({
        agentId: config.agentId, line: label, sessionId,
        instanceId: config.instanceId, ttlMs: config.leaseTtlMs,
        role: (oldDef && oldDef.role) || row.role || null,
        createdBy: row.created_by || (oldDef && oldDef.createdBy) || null,
      })
      const def = {
        agentId: config.agentId, label, sessionId, lineId: lineId(config.agentId, label),
        role: (oldDef && oldDef.role) || row.role || null,
        title: lineTitle(oldDef, updated), createdBy: row.created_by || (oldDef && oldDef.createdBy) || null,
        lifecycle: 'active', generation: updated.generation,
      }
      lineDefs.set(sessionId, def)
      startLoop(def)
      const agent = ctx.agents.get(sessionId)
      if (agent !== undefined) bindAgent(agent)
      if (notify !== false) {
        try {
          store.send({
            agentId: config.agentId, fromLine: config.createFrom, to: label,
            text: `[Agent Line] ${label} switched to a fresh Session. old=${row.session_id} new=${sessionId} migrated=${JSON.stringify(updated.counts)}. Read the handoff file before continuing.`,
            noReply: true, maxReplyDepth: config.maxReplyDepth, maxMessageBytes: config.maxMessageBytes,
          })
        } catch (error) { ctx.logger?.warn?.('agent-lines: rebind notification failed: %s', String(error)) }
      }
      return { line: label, oldSessionId: row.session_id, newSessionId: sessionId, generation: updated.generation, counts: updated.counts }
    } catch (error) {
      try { await stopLoopFor(label) } catch { /* best effort */ }
      if (oldDef !== undefined) {
        lineDefs.set(oldDef.sessionId, oldDef)
        startLoop(oldDef)
        const agent = ctx.agents.get(oldDef.sessionId)
        if (agent !== undefined) bindAgent(agent)
      }
      if (locked) {
        try { store.setLifecycle({ agentId: config.agentId, line: label, lifecycle: oldLifecycle === 'rebinding' ? 'active' : oldLifecycle, actor, reason: 'rebind rollback' }) } catch { /* best effort */ }
      }
      throw error
    } finally {
      rebinding.delete(label)
    }
  }

  /** 0.11.2 P1-02: tag the old Session on replace/retire via the official session controller. */
  const retirementStamp = () => {
    const d = new Date()
    return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  }
  const tagRetiredSession = async (sessionId, title) => {
    if (sessionId === undefined || sessionId === null || sessionId === '') return false
    if (typeof ctx.sessionController?.rename !== 'function') return false
    const base = String(title ?? '').trim() || String(sessionId)
    if (base.startsWith('【退役')) return false
    try {
      await ctx.sessionController.rename({ sessionId: String(sessionId), title: '【退役' + retirementStamp() + '】' + base })
      return true
    } catch (error) {
      ctx.logger?.warn?.('agent-lines: retitle old Session %s failed: %s', String(sessionId), String(error?.message ?? error))
      return false
    }
  }
  const retireLine = async ({ label, actor, reason }) => {
    if (label === config.createFrom) throw new LineError('LINE_MANAGER_RETIRE_UNSUPPORTED', 'The manager line cannot be retired', { line: label })
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    const def = [...lineDefs.values()].find(line => line.label === label)
    if (def !== undefined) def.lifecycle = 'retired'
    await stopLoopFor(label)
    const updated = store.retire({ agentId: config.agentId, line: label, actor, reason })
    const retiredTitleTagged = row.lifecycle === 'retired' ? false : await tagRetiredSession(row.session_id, row.title ?? row.role ?? label)
    return { line: label, lifecycle: updated.lifecycle, counts: updated.counts, already: row.lifecycle === 'retired', retiredTitleTagged }
  }

  const hibernateLine = async ({ label: rawLabel, actor, reason }) => {
    const label = validateLineLabel(rawLabel)
    if (label === config.createFrom) throw new LineError('LINE_MANAGER_HIBERNATE_UNSUPPORTED', 'The manager line cannot be hibernated', { line: label })
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    if (row.lifecycle === 'retired') throw new LineError('LINE_RETIRED', `Line ${label} is retired`, { line: label })
    if (row.lifecycle === 'rebinding') throw new LineError('LINE_REBIND_BUSY', `Line ${label} is rebinding; try again after the rebind finishes`, { line: label })
    if (row.lifecycle === 'hibernating') return { line: label, lifecycle: 'hibernating', already: true }
    const def = [...lineDefs.values()].find(line => line.label === label)
    if (def !== undefined) def.lifecycle = 'hibernating'
    await stopLoopFor(label)
    try { store.release({ agentId: config.agentId, line: label, instanceId: config.instanceId }) } catch { /* loop may not have held a lease */ }
    const updated = store.setLifecycle({ agentId: config.agentId, line: label, lifecycle: 'hibernating', actor, reason: reason === undefined ? 'line_hibernate' : String(reason) })
    return { line: label, lifecycle: updated.lifecycle, already: false, counts: store.messageCounts({ agentId: config.agentId, line: label }) }
  }

  const wakeLine = async ({ label: rawLabel, actor, reason }) => {
    const label = validateLineLabel(rawLabel)
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    if (row.lifecycle === 'retired') throw new LineError('LINE_RETIRED', `Line ${label} is retired; create or replace it instead`, { line: label })
    if (row.lifecycle !== 'hibernating') return { line: label, lifecycle: row.lifecycle, already: true, sessionId: row.session_id }
    if (!(await sessionExists(row.session_id))) throw new LineError('LINE_SESSION_NOT_FOUND', `Session is not live or persisted: ${row.session_id}`, { sessionId: row.session_id })
    store.acquire({ agentId: config.agentId, line: label, sessionId: row.session_id, instanceId: config.instanceId, ttlMs: config.leaseTtlMs, role: row.role })
    store.setLifecycle({ agentId: config.agentId, line: label, lifecycle: 'active', actor, reason: reason === undefined ? 'line_wake' : String(reason) })
    const def = [...lineDefs.values()].find(line => line.label === label) ?? {
      agentId: config.agentId, label, sessionId: row.session_id, lineId: lineId(config.agentId, label), role: row.role, title: row.title ?? row.role ?? label,
    }
    def.lifecycle = 'active'
    lineDefs.set(def.sessionId, def)
    startLoop(def)
    const live = ctx.agents.get(def.sessionId)
    if (live !== undefined) bindAgent(live)
    return { line: label, lifecycle: 'active', already: false, sessionId: def.sessionId }
  }

  const renameLine = async ({ label, title, actor }) => {
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    const updated = store.setTitle({ agentId: config.agentId, line: label, title, actor })
    const def = [...lineDefs.values()].find(line => line.label === label)
    if (def !== undefined) def.title = updated.title
    try { await ctx.sessionController?.rename?.({ sessionId: row.session_id, title: updated.title || title }) } catch { /* blank session can rename later */ }
    return { line: label, title: updated.title }
  }

  const initTeam = async ({ overwrite = false, teamRoot = null, teamName = null, exec = null } = {}) => {
    let root
    const tr = teamRoot === null || teamRoot === undefined ? '' : String(teamRoot).trim()
    const tn = teamName === null || teamName === undefined ? '' : String(teamName).trim()
    if (tr !== '' && tn !== '') root = join(tr, tn)
    else if (tr !== '') root = tr
    else if (tn !== '') {
      let base = config.teamRoot === null || config.teamRoot === undefined ? '' : String(config.teamRoot).trim()
      if (base === '') base = String(exec?.agent?.session?.header?.cwd ?? '').trim()
      if (base === '') throw new LineError('LINE_TEAM_ROOT_REQUIRED', 'teamRoot is not configured and the manager Session has no cwd')
      root = join(base, tn)
    } else throw new LineError('LINE_TEAM_NAME_REQUIRED', 'teamRoot or teamName is required: pass the final team dir (teamRoot) or the team name (teamName); with both, teamRoot is the parent and teamName is the subdir (do not initialize the workspace root)')
    const lines = [...lineDefs.values()].map(line => ({ label: line.label, role: line.role, title: line.title }))
    return { ...initTeamWorkspace({ teamRoot: root, lines, managerLabel: config.createFrom, overwrite }), teamName: basename(root) }
  }

  const setRoleLine = async ({ label, role, actor }) => {
    const row = store.getLineRow(config.agentId, label)
    if (row === undefined) throw new LineError('LINE_NOT_FOUND', `No such line: ${config.agentId}#${label}`)
    const updated = store.setRole({ agentId: config.agentId, line: label, role, actor })
    const def = [...lineDefs.values()].find(line => line.label === label)
    if (def !== undefined) def.role = updated.role
    return { line: label, role: updated.role }
  }

  /** 0.11.0-28: wait until the new Session's list projection flips blank=false (first turn started). */
  const waitForVisible = async (ctx, sessionId, timeoutMs = 4000) => {
    const projections = ctx.get?.('sessionProjections')
    if (projections?.snapshot === undefined) return false
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const agent = ctx.agents.get(sessionId)
      if (agent !== undefined) {
        try {
          const meta = projections.snapshot(agent.session, ['sessionListMetadata'])?.values?.sessionListMetadata
          if (meta === undefined) return false
          if (meta.blank === false) return true
        } catch { return false }
      }
      await new Promise(resolve => setTimeout(resolve, 120))
    }
    return false
  }
  const replaceLine = async (existing, args, exec) => {
    if (existing.label === config.createFrom) throw new LineError('LINE_MANAGER_REBIND_UNSUPPORTED', 'The manager line cannot be replaced', { line: existing.label })
    const existingRow = store.getLineRow(config.agentId, existing.label)
    if ((existingRow?.lifecycle ?? existing.lifecycle) === 'hibernating') {
      throw new LineError('LINE_HIBERNATING', `Line ${existing.label} is hibernating; wake it with line_wake first`, { line: existing.label })
    }
    if (existing.lifecycle === 'active' && args.force !== true) {
      throw new LineError('LINE_REPLACE_ACTIVE', `Line ${existing.label} is active; pass force:true to replace it`, { line: existing.label, lifecycle: existing.lifecycle })
    }
    if (args.migrate === 'none') {
      const backlog = store.messageCounts({ agentId: config.agentId, line: existing.label })
      if (backlog.queued + backlog.claimed > 0) {
        throw new LineError('LINE_BACKLOG_NOT_EMPTY', `Line ${existing.label} has ${backlog.queued + backlog.claimed} queued/claimed messages`, { line: existing.label, counts: backlog })
      }
    }
    const baseCwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
    if (args.workspace !== undefined && args.cwd !== undefined) throw new LineError('LINE_INVALID_ARGUMENT', 'workspace and cwd are mutually exclusive')
    const cwd = args.cwd === undefined || String(args.cwd).trim() === '' ? baseCwd : resolve(baseCwd, String(args.cwd).trim())
    const targetWorkspace = args.workspace !== undefined ? await resolveWorkspace(args.workspace, { soft: true }) : await managerWorkspace(baseCwd)
    const role = args.role === undefined || args.role === null ? null : String(args.role).trim() || null
    const title = args.title === undefined || args.title === null ? (role || existing.title || existing.role || existing.label) : String(args.title).trim().slice(0, 120)
    const sessionId = `session-${randomUUID()}`
    const created = await ctx.sessionController.create({
      sessionId,
      ...(targetWorkspace === undefined ? { cwd } : { workspaceId: targetWorkspace.id }),
      agentPreset: args.agentPreset === undefined ? config.childPreset : String(args.agentPreset),
    })
    const actualSessionId = created.sessionId
    const result = await rebindLine({
      label: existing.label, sessionId: actualSessionId, actor: (exec && exec.agent && exec.agent.session && exec.agent.session.id) || null,
      reason: String(args.reason || 'line_create replace'), migrate: args.migrate === 'none' ? 'none' : 'queued', force: args.force === true, notify: false,
    })
    const effectiveRole = role ?? existing.role ?? existing.label
    const newDef = lineDefs.get(actualSessionId)
    if (newDef !== undefined) {
      newDef.role = effectiveRole
      newDef.title = title
      try { store.setTitle({ agentId: config.agentId, line: existing.label, title }) } catch { /* best effort */ }
    }
    let bootstrapQueued = false
    const wantBootstrap = config.bootstrapOnCreate !== false
    if (wantBootstrap) {
      const creator = lineDefs.get(exec.agent.session.id)
      if (creator !== undefined) {
        try {
          store.send({
            agentId: config.agentId, fromLine: creator.label, to: existing.label,
            text: `[Agent Line] ${existing.label} replaced. You are ${role ?? existing.role ?? existing.label}. Read the handoff file before starting; this is an identity message, do not modify files yet.`,
            noReply: true, maxReplyDepth: config.maxReplyDepth, maxMessageBytes: config.maxMessageBytes,
          })
          bootstrapQueued = true
        } catch (error) { ctx.logger?.warn?.('agent-lines: replace bootstrap failed: %s', String(error)) }
      }
    }
    const retiredTitleTagged = await tagRetiredSession(result.oldSessionId, existing.title ?? existing.role ?? existing.label)
    return {
      line: existing.label, sessionId: actualSessionId, oldSessionId: result.oldSessionId,
      role: effectiveRole, title, created: true, replaced: true, generation: result.generation, counts: result.counts,
      retiredTitleTagged,
      cwd: targetWorkspace?.path ?? cwd, workspaceId: targetWorkspace?.id ?? null, bootstrapQueued,
      bootstrapForced: args.bootstrap === false && wantBootstrap,
      visibleInSidebar: bootstrapQueued ? await waitForVisible(ctx, actualSessionId, 4000) : false,
      workspaceFallback: args.workspace !== undefined && targetWorkspace === undefined ? 'registry-unavailable' : null,
    }
  }

  const createLine = async (args, exec) => {
    requireCapability(probeCapabilities(ctx), 'session.create')
    if (closed) throw new LineError('LINE_CLOSED', 'The agent-lines plugin is shutting down')
    if (!config.allowCreate) throw new LineError('LINE_CREATE_DISABLED', 'line_create is disabled by config')
    const label = validateLineLabel(args.label)
    const existing = store.getLineRow(config.agentId, label)
    if (existing !== undefined) {
      if (args.replace === true) return replaceLine(existing, args, exec)
      return { line: existing.label, sessionId: existing.session_id, role: existing.role, title: existing.title ?? existing.role ?? existing.label, lifecycle: existing.lifecycle, created: false }
    }
    if (store.countLines(config.agentId) >= config.maxLines) {
      throw new LineError('LINE_LIMIT', `Line limit reached: ${config.maxLines}`, { maxLines: config.maxLines })
    }
    const baseCwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
    if (args.workspace !== undefined && args.cwd !== undefined) {
      throw new LineError('LINE_INVALID_ARGUMENT', 'workspace and cwd are mutually exclusive')
    }
    const cwd = args.cwd === undefined || String(args.cwd).trim() === ''
      ? baseCwd
      : resolve(baseCwd, String(args.cwd).trim())
    const targetWorkspace = args.workspace !== undefined
      ? await resolveWorkspace(String(args.workspace), { soft: true })
      : await managerWorkspace(baseCwd)
    const role = args.role === undefined || args.role === null ? null : String(args.role).trim() || null
    const title = args.title === undefined || args.title === null ? (role || label) : String(args.title).trim().slice(0, 120)
    const sessionId = `session-${randomUUID()}`
    const created = await ctx.sessionController.create({
      sessionId,
      ...(targetWorkspace === undefined ? { cwd } : { workspaceId: targetWorkspace.id }),
      agentPreset: args.agentPreset === undefined ? config.childPreset : String(args.agentPreset),
    })
    const creator = lineDefs.get(exec.agent.session.id)
    const actualSessionId = created.sessionId
    const def = { agentId: config.agentId, label, sessionId: actualSessionId, lineId: lineId(config.agentId, label), role, title, createdBy: creator?.lineId ?? null, lifecycle: 'active', generation: 1 }
    try {
      store.acquire({
        agentId: config.agentId,
        line: label,
        sessionId: actualSessionId,
        instanceId: config.instanceId,
        ttlMs: config.leaseTtlMs,
        role,
        createdBy: def.createdBy,
      })
    } catch (error) {
      if (error !== null && typeof error === 'object') {
        error.detail = { ...(error.detail ?? {}), sessionId: actualSessionId }
      }
      ctx.logger?.warn?.('agent-lines: created Session %s but failed to register line %s', actualSessionId, label)
      throw error
    }
    try { store.setTitle({ agentId: config.agentId, line: label, title }) } catch { /* title is best-effort after acquire */ }
    lineDefs.set(actualSessionId, def)
    startLoop(def)
    const agent = ctx.agents.get(actualSessionId)
    if (agent !== undefined) bindAgent(agent)
    let bootstrapQueued = false
    const wantBootstrap = config.bootstrapOnCreate !== false
    if (wantBootstrap && creator !== undefined) {
      try {
        store.send({
          agentId: config.agentId,
          fromLine: creator.label,
          to: label,
          text: `[Agent Line] ${label} onboarding. You are ${role ?? label}. This is an identity message: do not start work and do not modify files. Acknowledge briefly if needed, then wait for the manager's first task.`,
          noReply: true,
          maxReplyDepth: config.maxReplyDepth,
          maxMessageBytes: config.maxMessageBytes,
        })
        bootstrapQueued = true
      } catch (error) {
        ctx.logger?.warn?.('agent-lines: line %s created but onboarding bootstrap failed: %s', label, String(error))
      }
    }
    return {
      line: label,
      sessionId: actualSessionId,
      role,
      title,
      lifecycle: 'active',
      cwd: targetWorkspace?.path ?? cwd,
      workspaceId: targetWorkspace?.id ?? null,
      created: true,
      materialized: false,
      bootstrapForced: args.bootstrap === false && wantBootstrap,
      visibleInSidebar: bootstrapQueued ? await waitForVisible(ctx, actualSessionId, 4000) : false,
      bootstrapQueued,
      workspaceFallback: args.workspace !== undefined && targetWorkspace === undefined ? 'registry-unavailable' : null,
      hint: bootstrapQueued
        ? 'Onboarding message queued; the Session becomes visible after its first turn.'
        : 'No bootstrap queued; send a standby message or refresh after the first delivery.',
    }
  }

  try {
    const binding = store.getManagerBinding(config.agentId)
    const startupLines = []
    for (const def of config.lines) {
      let effective = def
      if (def.label === config.createFrom && binding !== undefined && await sessionExists(binding.session_id)) {
        effective = { ...def, sessionId: binding.session_id }
      }
      startupLines.push(effective)
    }
    for (const def of startupLines) {
      if (def.sessionId === '') {
        ctx.logger?.info?.('agent-lines: manager %s is unbound; waiting for claim', def.label)
        continue
      }
      const stored = store.getLineRow(config.agentId, def.label)
      if (stored !== undefined && stored.lifecycle !== 'active') {
        ctx.logger?.info?.('agent-lines: line %s is %s; skipping delivery loop', def.label, stored.lifecycle)
        continue
      }
      if (!(await sessionExists(def.sessionId))) {
        ctx.logger?.warn?.('agent-lines: Session %s for line %s is missing; line stays unbound until claimed', def.sessionId, def.label)
        lineDefs.set(def.sessionId, { ...def, missing: true })
        continue
      }
      store.acquire({
        agentId: config.agentId,
        line: def.label,
        sessionId: def.sessionId,
        instanceId: config.instanceId,
        ttlMs: config.leaseTtlMs,
        role: def.role,
      })
      const effective = { ...def, title: lineTitle(def, stored), lifecycle: 'active', generation: Number(stored?.generation ?? 1) }
      lineDefs.set(def.sessionId, effective)
      startLoop(effective)
    }
    cleanupFns.push(ctx.on('agent/created', ({ agent }) => { bindAgent(agent) }))
    cleanupFns.push(ctx.on('agent/disposed', ({ agent }) => { unbindAgent(agent) }))
    if (config.allowCreate) {
      const managerLineId = lineId(config.agentId, config.createFrom)
      for (const row of store.listLines()) {
        if (row.created_by !== managerLineId || lineDefs.has(row.session_id)) continue
        if (row.lifecycle !== 'active') continue
        if (!(await sessionExists(row.session_id))) {
          ctx.logger?.warn?.('agent-lines: dynamic line %s has no persisted Session; skipped restore', row.label)
          continue
        }
        try {
          store.acquire({
            agentId: config.agentId,
            line: row.label,
            sessionId: row.session_id,
            instanceId: config.instanceId,
            ttlMs: config.leaseTtlMs,
            role: row.role,
            createdBy: row.created_by,
          })
          const def = { agentId: config.agentId, label: row.label, sessionId: row.session_id, lineId: row.line_id, role: row.role, title: lineTitle({ role: row.role, label: row.label }, row), createdBy: row.created_by, lifecycle: 'active', generation: Number(row.generation ?? 1) }
          lineDefs.set(row.session_id, def)
          startLoop(def)
        } catch (error) {
          ctx.logger?.warn?.('agent-lines: could not restore line %s: %s', row.label, String(error))
        }
      }
    }
    statusDisposer = registerStatusTool(ctx, { config, store, lineDefs })
    if (config.allowClaim) {
      claimDisposer = registerClaimTool(ctx, { config, lineDefs, rebindManager })
      claimTimer = setInterval(() => { void processClaims() }, Math.max(200, config.pollMs))
      claimTimer.unref?.()
      void processClaims()
    }
    tokenTimer = setInterval(() => {
      try {
        const now = Date.now()
        for (const def of lineDefs.values()) {
          if (def.missing === true) continue
          if (def.lifecycle !== undefined && def.lifecycle !== 'active') continue
          const activity = activityOf(ctx, def.sessionId)
          if (activity === null) continue
          try {
            store.recordTokenSampleIfChanged({ agentId: config.agentId, line: def.label, decodeTokens: activity.decodeTokens, outputTokens: activity.outputTokens, inputTokens: activity.inputTokens, cacheReadTokens: activity.cacheReadTokens, cacheWriteTokens: activity.cacheWriteTokens, totalTokens: activity.totalTokens, turns: activity.turns, steps: activity.steps, sessionId: def.sessionId, now })
          } catch { /* best effort: sampling must never break delivery */ }
        }
        if (lastTokenPruneAt === 0 || now - lastTokenPruneAt >= 3_600_000) {
          lastTokenPruneAt = now
          try { store.pruneTokenSamples({ agentId: config.agentId, before: now - config.tokenRetentionDays * 86_400_000 }) } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
    }, config.tokenSampleMs)
    tokenTimer.unref?.()
    for (const agent of ctx.agents.list()) bindAgent(agent)
    ctx.effect(() => {
      return async () => {
        closed = true
        for (const dispose of cleanupFns.reverse()) {
          try { dispose?.() } catch { /* best effort */ }
        }
        for (const agent of ctx.agents.list()) unbindAgent(agent)
        bindings.clear()
        if (claimTimer !== undefined) clearInterval(claimTimer)
        if (tokenTimer !== undefined) clearInterval(tokenTimer)
        try { statusDisposer?.() } catch { /* best effort */ }
        try { claimDisposer?.() } catch { /* best effort */ }
        for (const loop of loops.reverse()) {
          try { await loop.stop() } catch (error) { ctx.logger?.warn?.('agent-lines: loop stop failed: %s', String(error)) }
        }
        try { process.off('exit', releaseAll) } catch { /* best effort */ }
        store.close()
      }
    })
    ctx.logger?.info?.('agent-lines: serving %d line(s) for %s (db %s)', lineDefs.size, config.agentId, config.dbPath)
  } catch (error) {
    closed = true
    if (claimTimer !== undefined) clearInterval(claimTimer)
    if (tokenTimer !== undefined) clearInterval(tokenTimer)
    try { statusDisposer?.() } catch { /* best effort */ }
    try { claimDisposer?.() } catch { /* best effort */ }
    try { process.off('exit', releaseAll) } catch { /* best effort */ }
    for (const dispose of cleanupFns.reverse()) { try { dispose?.() } catch { /* best effort */ } }
    for (const loop of loops.reverse()) { try { await loop.stop() } catch { /* best effort */ } }
    for (const def of config.lines) {
      try { store.release({ agentId: config.agentId, line: def.label, instanceId: config.instanceId }) } catch { /* best effort */ }
    }
    store.close()
    throw error
  }
}