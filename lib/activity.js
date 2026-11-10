/** Pure activity summarizer. Never claims a context-window percentage. */
export function activityLevel({ steps = 0, turns = 0 } = {}) {
  const n = Number(steps) || 0
  if (n >= 40) return 'high'
  if (n >= 15) return 'medium'
  return 'low'
}

export function summarizeActivity(stats, lastActivityAt = null, tokenUsage = null) {
  if ((stats === undefined || stats === null) && (tokenUsage === undefined || tokenUsage === null)) return null
  const t = stats ?? {}
  const u = tokenUsage ?? null
  const output = u === null ? Number(t.decodeTokens) || 0 : Number(u.outputTokens) || 0
  const input = u === null ? null : Number(u.uncachedInputTokens) || 0
  const cacheRead = u === null ? null : Number(u.cacheReadTokens) || 0
  const cacheWrite = u === null ? null : Number(u.cacheWriteTokens) || 0
  const total = u === null ? null : input + output + cacheRead + cacheWrite
  const turns = Number(t.turns) || 0
  const steps = Number(t.steps) || 0
  const activity = { turns, steps, decodeTokens: output, level: activityLevel({ steps, turns }), lastActivityAt: lastActivityAt === null ? null : Number(lastActivityAt) }
  if (u !== null) {
    activity.outputTokens = output
    activity.inputTokens = input
    activity.cacheReadTokens = cacheRead
    activity.cacheWriteTokens = cacheWrite
    activity.totalTokens = total
  }
  return activity
}
