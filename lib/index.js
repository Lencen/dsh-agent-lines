/**
 * dsh-agent-lines host plugin.
 *
 * A DSH process can host one or more lines. Each line is bound to an ordinary
 * DSH Session; only this process writes that Session. A manager line with
 * `allowCreate: true` can create additional lines at runtime with line_create.
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { DeliveryLoop } from './delivery.js'
import { defaultDbPath, expandHome } from './store.js'
import { createTransport, TRANSPORTS } from './transport.js'
import { bindAgentPrompt } from './prompt.js'
import { registerClaimTool, registerStatusTool, registerToolsForAgent } from './tools.js'
import { LineError, lineId, validateAgentId, validateLineLabel } from './protocol.js'

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
  return { agentId, label, sessionId, lineId: lineId(agentId, label), role }
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
    ? [{ agentId, label: 'manager', sessionId: '', lineId: lineId(agentId, 'manager'), role: null }]
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
    allowSelfSend: raw.allowSelfSend === true,
    dedupeWindowMs: integer(raw.dedupeWindowMs, 5_000, { min: 0, max: 3_600_000 }),
    maxReplyDepth: integer(raw.maxReplyDepth, 8, { min: 1, max: 100 }),
    childPreset: String(raw.childPreset ?? 'standard'),
    pollMs: integer(raw.pollMs, 500, { min: 100, max: 60_000 }),
    leaseTtlMs: integer(raw.leaseTtlMs, 30_000, { min: 3_000, max: 3_600_000 }),
    claimBatch: integer(raw.claimBatch, 20, { min: 1, max: 100 }),
    claimTimeoutMs: integer(raw.claimTimeoutMs, 30_000, { min: 5_000, max: 3_600_000 }),
    deliveryTimeoutMs: integer(raw.deliveryTimeoutMs, 30_000, { min: 1_000, max: 300_000 }),
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
  let claiming = false
  let closed = false

  const bindAgent = (agent) => {
    const def = lineDefs.get(agent.session.id)
    if (def === undefined || bindings.has(agent.session.id)) return
    const binding = {
      prompt: bindAgentPrompt(agent, def),
      tools: registerToolsForAgent(agent, def, { config, store, lineDefs, createLine, moveLineWorkspace }),
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

  const startLoop = (def) => {
    const loop = new DeliveryLoop({ ctx, config: loopConfig(config, def), store, logger: ctx.logger })
    loops.push(loop)
    loop.start()
  }

  const sessionExists = async (sessionId) => {
    if (ctx.agents.get(sessionId) !== undefined) return true
    const persistence = ctx.get?.('sessionPersistence')
    if (persistence?.stat === undefined) return true
    try { return (await persistence.stat(sessionId)) !== undefined } catch { return false }
  }

  const resolveWorkspace = async (ref) => {
    const text = String(ref ?? '').trim()
    if (text.length === 0) throw new LineError('WORKSPACE_NOT_FOUND', 'workspace is required')
    const registry = ctx.get?.('workspaceRegistry')
    if (registry === undefined) throw new LineError('WORKSPACE_UNAVAILABLE', 'workspaceRegistry is not mounted in this profile')
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

  const createLine = async (args, exec) => {
    if (closed) throw new LineError('LINE_CLOSED', 'The agent-lines plugin is shutting down')
    if (!config.allowCreate) throw new LineError('LINE_CREATE_DISABLED', 'line_create is disabled by config')
    const label = validateLineLabel(args.label)
    const existing = store.getLineRow(config.agentId, label)
    if (existing !== undefined) {
      return { line: existing.label, sessionId: existing.session_id, role: existing.role, created: false }
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
      ? await resolveWorkspace(args.workspace)
      : await managerWorkspace(baseCwd)
    const role = args.role === undefined || args.role === null ? null : String(args.role).trim() || null
    const sessionId = `session-${randomUUID()}`
    const created = await ctx.sessionController.create({
      sessionId,
      ...(targetWorkspace === undefined ? { cwd } : { workspaceId: targetWorkspace.id }),
      agentPreset: args.agentPreset === undefined ? config.childPreset : String(args.agentPreset),
    })
    const creator = lineDefs.get(exec.agent.session.id)
    const actualSessionId = created.sessionId
    const def = { agentId: config.agentId, label, sessionId: actualSessionId, lineId: lineId(config.agentId, label), role, createdBy: creator?.lineId ?? null }
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
    lineDefs.set(actualSessionId, def)
    startLoop(def)
    const agent = ctx.agents.get(actualSessionId)
    if (agent !== undefined) bindAgent(agent)
    try {
      await ctx.sessionController.rename({ sessionId: actualSessionId, title: `line: ${label}` })
    } catch { /* a blank session may not materialize on rename; first delivery will */ }
    return { line: label, sessionId: actualSessionId, role, cwd: targetWorkspace?.path ?? cwd, workspaceId: targetWorkspace?.id ?? null, created: true }
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
      lineDefs.set(def.sessionId, def)
      startLoop(def)
    }
    cleanupFns.push(ctx.on('agent/created', ({ agent }) => { bindAgent(agent) }))
    cleanupFns.push(ctx.on('agent/disposed', ({ agent }) => { unbindAgent(agent) }))
    if (config.allowCreate) {
      const managerLineId = lineId(config.agentId, config.createFrom)
      for (const row of store.listLines()) {
        if (row.created_by !== managerLineId || lineDefs.has(row.session_id)) continue
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
          const def = { agentId: config.agentId, label: row.label, sessionId: row.session_id, lineId: row.line_id, role: row.role, createdBy: row.created_by }
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
