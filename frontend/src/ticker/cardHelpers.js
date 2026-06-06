// Shared pure helpers used by card components

export function sanitizeHexColor(value) {
  const token = String(value || '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(token)) return `#${token}`
  if (/^[0-9a-fA-F]{6}$/.test(token)) return `#${token}`
  return ''
}

export function hexToRgb(hex) {
  const cleaned = sanitizeHexColor(hex).replace('#', '')
  if (!cleaned) return null
  const normalized = cleaned.length === 3
    ? cleaned.split('').map((c) => `${c}${c}`).join('')
    : cleaned
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return null
  return { r, g, b }
}

export function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : ''
}

export function readableTextForColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#f5fbff'
  const luma = (0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b)
  return luma > 162 ? '#061018' : '#f5fbff'
}

export function teamRecordText(team) {
  return String(team?.record || '').trim()
}

export function runtimeTeamName(team) {
  if (!team) return 'TBD'
  return team.abbreviation || team.name || team.slug || 'TBD'
}

export function teamRowStyle(team) {
  const primary = sanitizeHexColor(team?.palette?.primary || team?.color)
  if (!primary) return undefined
  const alternate = sanitizeHexColor(team?.palette?.alternate || team?.alternateColor)
  const textColor = readableTextForColor(primary)
  const base = rgbaFromHex(primary, 0.84)
  const blend = alternate ? rgbaFromHex(alternate, 0.74) : rgbaFromHex(primary, 0.62)
  return {
    '--team-row-bg': `linear-gradient(115deg, ${base}, ${blend})`,
    '--team-row-border': rgbaFromHex(primary, 0.6),
    '--team-row-text': textColor,
    '--team-row-score': textColor,
    '--team-row-glow': rgbaFromHex(primary, 0.48),
  }
}

// ── Racing helpers ────────────────────────────────────────────────────────────
// These consume the normalized game shape produced by the backend normalizer.
// RacingCard does not reference raw ESPN fields directly — swapping the data
// source only requires updating the backend normalizer, not these helpers.

export function racingCardTitle(game, league) {
  const explicitTitle = String(game?.title || '').trim()
  if (explicitTitle) return explicitTitle
  return String(league?.name || 'Race').trim()
}

export function racingEntrySummary(entry) {
  const statItems = Array.isArray(entry?.stats) ? entry.stats : []
  const summary = statItems
    .slice(0, 2)
    .map((item) => {
      const label = String(item?.label || '').trim()
      const value = String(item?.value || '').trim()
      if (!value) return ''
      return label ? `${label} ${value}` : value
    })
    .filter(Boolean)
  if (summary.length) return summary.join(' • ')
  const score = String(entry?.score || '').trim()
  return score || ''
}

export function racingHasTelemetry(entries) {
  if (!Array.isArray(entries) || !entries.length) return false
  return entries.some((entry) => {
    const score = String(entry?.score || '').trim()
    if (score) return true
    const statItems = Array.isArray(entry?.stats) ? entry.stats : []
    return statItems.some((item) => String(item?.value || '').trim())
  })
}

export function racingTelemetryFallback(game, entries) {
  const parts = ['Running Order']
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) parts.push(`Lap ${lap}`)
  const leader = entries?.[0]
  const leaderName = String(leader?.shortName || leader?.name || '').trim()
  if (leaderName) parts.push(`Leader ${leaderName}`)
  return parts.join(' • ')
}

export function racingLiveHeader(game) {
  const detail = String(game?.liveState?.detail || game?.status?.detail || game?.status?.shortDetail || '').trim()
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) return detail ? `Lap ${lap} • ${detail}` : `Lap ${lap}`
  if (detail) return detail
  return 'Race in progress'
}
