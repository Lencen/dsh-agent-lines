/** Pure activity summarizer. Never claims a context-window percentage. */
export function activityLevel({ steps = 0, turns = 0 } = {}) {
  const n = Number(steps) || 0
  if (n >= 40) return 'high'
  if (n >= 15) return 'medium'
  return 'low'
}

export function summarizeActivity(stats, lastActivityAt = null) {
  if (stats === undefined || stats === null) return null
  const turns = Number(stats.turns) || 0
  const steps = Number(stats.steps) || 0
  return {
    turns, steps,
    decodeTokens: Number(stats.decodeTokens) || 0,
    level: activityLevel({ steps, turns }),
    lastActivityAt: lastActivityAt === null ? null : Number(lastActivityAt),
  }
}
