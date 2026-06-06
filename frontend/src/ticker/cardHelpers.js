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

// ── Runtime game enrichment ────────────────────────────────────────────────────
// Pure functions that transform normalized game data into display-ready objects.
// All consumed by prepareDisplayGames(); nothing here has React or side-effects.

export function formatRuntimeStatus(game) {
  const state = String(game?.state || '').toLowerCase()
  if (state === 'pre') return 'Scheduled'
  const detail = String(game?.status?.shortDetail || game?.status?.detail || '').trim()
  if (detail) return detail
  if (state === 'in') return 'Live'
  if (state === 'post') return 'Final'
  return 'Scheduled'
}

export function formatRuntimeDate(game) {
  const start = String(game?.startTimeUtc || '').trim()
  if (!start) return ''
  const date = new Date(start)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function leagueStatToggleEnabled(league, field, fallback = true) {
  if (!league || typeof league !== 'object') return fallback
  if (typeof league[field] === 'boolean') return league[field]
  return fallback
}

export function hasLiveGameMode(league) {
  if (!league || typeof league !== 'object') return false
  return Boolean(league.liveGameMode)
}

export function extractEventOdds(rawEvent) {
  const competition = rawEvent?.competitions?.[0] || {}
  const odds = competition?.odds
  if (!Array.isArray(odds) || !odds.length) return ''
  const first = odds[0] || {}
  return String(first?.details || first?.displayValue || '').trim()
}

export function buildRuntimeDetailStats({ rawEvent, game, league, baseballSituationText, venueText, hasBaseballLivePanel = false }) {
  const stats = []
  const state = String(game?.state || '').toLowerCase()
  const hasLiveMode = hasLiveGameMode(league)

  if (hasLiveMode && leagueStatToggleEnabled(league, 'showStatClock', true)) {
    const isLive = state === 'in'
    if (isLive) {
      const period = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
      const clockRaw = String(game?.status?.clock || '').trim()
      const clock = clockRaw && clockRaw !== '0:00' ? clockRaw : ''
      const periodText = period ? `P${period}` : ''
      const value = [periodText, clock].filter(Boolean).join(' • ')
      if (value) stats.push({ label: 'Clock', value })
    }
  }

  if (hasLiveMode && leagueStatToggleEnabled(league, 'showStatSituation', true)) {
    if (!hasBaseballLivePanel) {
      const downDistance = String(game?.liveState?.downDistanceText || '').trim()
      const liveDetail = String(game?.liveState?.detail || '').trim()
      const situationText = baseballSituationText || downDistance || liveDetail
      if (situationText) stats.push({ label: 'Situation', value: situationText })
    }
  }

  if (leagueStatToggleEnabled(league, 'showStatVenue', false)) {
    const venue = venueText
      || [game?.venue?.name, game?.venue?.city, game?.venue?.state].filter(Boolean).join(', ')
    if (venue) stats.push({ label: 'Venue', value: venue })
  }

  if (leagueStatToggleEnabled(league, 'showStatOdds', false)) {
    const oddsRaw = extractEventOdds(rawEvent) || String(game?.odds?.details || '').trim()
    if (oddsRaw) stats.push({ label: 'Odds', value: oddsRaw })
  }

  return stats.slice(0, 3)
}

export function isRacingGame(game) {
  return String(game?.sport || '').toLowerCase() === 'racing'
}

export function formatRacingCalendarDate(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function nextRacingCalendarEvent(payload, game) {
  const calendar = payload?.scoreboard?.leagues?.[0]?.calendar
  if (!Array.isArray(calendar) || !calendar.length) return null
  const gameStart = String(game?.startTimeUtc || '').trim()
  const gameTimestamp = gameStart ? new Date(gameStart).getTime() : Number.NaN
  const nowTimestamp = Date.now()
  const threshold = Number.isNaN(gameTimestamp) ? nowTimestamp : Math.max(nowTimestamp, gameTimestamp)
  const nextItem = calendar.find((item) => {
    const startDate = String(item?.startDate || '').trim()
    if (!startDate) return false
    const timestamp = new Date(startDate).getTime()
    return !Number.isNaN(timestamp) && timestamp > threshold
  })
  if (!nextItem) return null
  return {
    label: String(nextItem?.label || '').trim(),
    dateText: formatRacingCalendarDate(nextItem?.startDate),
  }
}

export function formatBaseballSituation(rawEvent, game) {
  const sportId = String(
    rawEvent?.competitions?.[0]?.sport?.id
    || rawEvent?.competitions?.[0]?.sport?.slug
    || rawEvent?.sport?.id
    || rawEvent?.sport?.slug
    || game?.liveState?.sport
    || game?.sport
    || game?.sport?.id
    || game?.sport?.slug
    || '',
  ).toLowerCase()

  if (!sportId.includes('baseball') || String(game?.state || '').toLowerCase() !== 'in') return ''

  const situation = rawEvent?.competitions?.[0]?.situation || {}
  const onFirst = Boolean(situation.onFirst)
  const onSecond = Boolean(situation.onSecond)
  const onThird = Boolean(situation.onThird)
  const outs = Number.isInteger(Number(situation.outs)) ? Number(situation.outs) : null
  const balls = Number.isInteger(Number(situation.balls)) ? Number(situation.balls) : null
  const strikes = Number.isInteger(Number(situation.strikes)) ? Number(situation.strikes) : null

  const occupiedBases = []
  if (onFirst) occupiedBases.push('1st')
  if (onSecond) occupiedBases.push('2nd')
  if (onThird) occupiedBases.push('3rd')

  const parts = []
  if (outs !== null) parts.push(`${outs} out${outs === 1 ? '' : 's'}`)
  if (balls !== null && strikes !== null) parts.push(`Count ${balls}-${strikes}`)
  if (occupiedBases.length) parts.push(`Bases ${occupiedBases.join(', ')}`)

  return parts.join(' • ')
}

export function extractBaseballLiveSituation(rawEvent, game) {
  const sportId = String(
    rawEvent?.competitions?.[0]?.sport?.id
    || rawEvent?.competitions?.[0]?.sport?.slug
    || rawEvent?.sport?.id
    || rawEvent?.sport?.slug
    || game?.liveState?.sport
    || game?.sport
    || game?.sport?.id
    || game?.sport?.slug
    || '',
  ).toLowerCase()

  if (!sportId.includes('baseball') || String(game?.state || '').toLowerCase() !== 'in') return null

  // rawEvent situation has the most current ESPN data; game.liveState is derived from the same
  // request but may fall back to empty if ESPN omitted the situation block
  const rawSituation = rawEvent?.competitions?.[0]?.situation
  const liveState = game?.liveState || {}
  const situation = (rawSituation && typeof rawSituation === 'object') ? rawSituation : liveState
  const outs = Number.isInteger(Number(situation?.outs)) ? Number(situation.outs) : (Number.isInteger(liveState.outs) ? liveState.outs : null)
  const balls = Number.isInteger(Number(situation?.balls)) ? Number(situation.balls) : (Number.isInteger(liveState.balls) ? liveState.balls : null)
  const strikes = Number.isInteger(Number(situation?.strikes)) ? Number(situation.strikes) : (Number.isInteger(liveState.strikes) ? liveState.strikes : null)

  const detailSources = [
    game?.liveState?.detail,
    game?.status?.detail,
    game?.status?.shortDetail,
    rawEvent?.status?.type?.detail,
    rawEvent?.status?.type?.shortDetail,
    rawEvent?.competitions?.[0]?.status?.type?.detail,
  ].filter(Boolean).map((s) => String(s))

  let inning = null
  let halfInning = ''
  const combined = detailSources.join(' ').toLowerCase()

  const rawInning = Number(situation?.inning ?? game?.liveState?.inning)
  if (Number.isInteger(rawInning) && rawInning > 0) inning = rawInning

  const topMatch = combined.match(/\b(?:top|t)\s*(?:of\s*(?:the\s*)?)?(\d+)/i)
  const botMatch = combined.match(/\b(?:bottom|bot|b)\s*(?:of\s*(?:the\s*)?)?(\d+)/i)
  const shortT = combined.match(/\bT\s*(\d+)/i)
  const shortB = combined.match(/\bB\s*(\d+)/i)

  if (topMatch || shortT) {
    halfInning = 'top'
    const m = topMatch || shortT
    if (!inning) inning = parseInt(m[1], 10)
  } else if (botMatch || shortB) {
    halfInning = 'bottom'
    const m = botMatch || shortB
    if (!inning) inning = parseInt(m[1], 10)
  }

  if (!inning) {
    const anyInning = combined.match(/(?:^|[\s(])(\d{1,2})(?:st|nd|rd|th|\s|$)/)
    if (anyInning) inning = parseInt(anyInning[1], 10)
  }

  return {
    outs,
    balls,
    strikes,
    onFirst: Boolean(situation?.onFirst),
    onSecond: Boolean(situation?.onSecond),
    onThird: Boolean(situation?.onThird),
    inning: inning || null,
    halfInning: halfInning || '',
  }
}

export function resolveBaseballBattingSide(rawEvent, game) {
  if (String(game?.state || '').toLowerCase() !== 'in') return null

  const halfInningToken = String(game?.liveState?.halfInning || '').trim().toLowerCase()
  if (halfInningToken) {
    if (halfInningToken.startsWith('top') || halfInningToken === 't') return 'away'
    if (halfInningToken.startsWith('bottom') || halfInningToken.startsWith('bot') || halfInningToken === 'b') return 'home'
  }

  const detailText = [
    game?.liveState?.detail,
    game?.status?.detail,
    game?.status?.shortDetail,
    rawEvent?.status?.type?.detail,
    rawEvent?.status?.type?.shortDetail,
  ]
    .map((item) => String(item || '').toLowerCase())
    .join(' ')

  if (detailText.includes('top')) return 'away'
  if (detailText.includes('bottom') || detailText.includes('bot')) return 'home'
  if (/\bT\s*\d+/i.test(detailText) || /\bTop\s*\d+/i.test(detailText)) return 'away'
  if (/\bB\s*\d+/i.test(detailText) || /\bBot\s*\d+/i.test(detailText) || /\bBottom\s*\d+/i.test(detailText)) return 'home'

  return null
}

export function runtimeLiveTheme(game, rawEvent) {
  const token = String(
    rawEvent?.competitions?.[0]?.sport?.id
    || rawEvent?.competitions?.[0]?.sport?.slug
    || rawEvent?.sport?.id
    || rawEvent?.sport?.slug
    || game?.liveState?.sport
    || game?.sport
    || game?.sport?.id
    || game?.sport?.slug
    || '',
  ).toLowerCase()

  if (token.includes('football')) return 'football'
  if (token.includes('baseball')) return 'baseball'
  if (token.includes('basketball')) return 'basketball'
  if (token.includes('hockey')) return 'hockey'
  return 'generic'
}

export function resolveEventTeamLogo(rawEvent, homeAway) {
  const competitors = Array.isArray(rawEvent?.competitions?.[0]?.competitors)
    ? rawEvent.competitions[0].competitors
    : []
  const team = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === homeAway)?.team || {}
  if (Array.isArray(team?.logos) && team.logos.length) {
    const href = String(team.logos[0]?.href || '').trim()
    if (href) return href
  }
  return String(team?.logo || '').trim()
}

export function resolveEventTeamPalette(rawEvent, homeAway) {
  const competitors = Array.isArray(rawEvent?.competitions?.[0]?.competitors)
    ? rawEvent.competitions[0].competitors
    : []
  const team = competitors.find((c) => String(c?.homeAway || '').toLowerCase() === homeAway)?.team || {}
  return {
    primary: sanitizeHexColor(team?.color),
    alternate: sanitizeHexColor(team?.alternateColor),
  }
}

export function prepareDisplayGames(games, rawEventsById, displayLeague, leagueLogoMeta, payload) {
  return games.map((game, index) => {
    const rawEvent = rawEventsById.get(String(game?.id || '').trim())
    const oddsText = extractEventOdds(rawEvent) || String(game?.odds?.details || '').trim()
    const baseballSituationText = formatBaseballSituation(rawEvent, game)
    const awayLogoRaw = resolveEventTeamLogo(rawEvent, 'away')
    const homeLogoRaw = resolveEventTeamLogo(rawEvent, 'home')
    const awayPaletteRaw = resolveEventTeamPalette(rawEvent, 'away')
    const homePaletteRaw = resolveEventTeamPalette(rawEvent, 'home')

    const awayCached = leagueLogoMeta?.teams?.[String(game?.teams?.away?.id || '').trim()]
    const homeCached = leagueLogoMeta?.teams?.[String(game?.teams?.home?.id || '').trim()]
    const broadcastText = Array.isArray(game?.broadcasts)
      ? game.broadcasts
        .map((item) => String(item || '').trim())
        .filter((item) => item && item !== '[' && item !== ']')
        .slice(0, 2)
        .join(' / ')
      : ''
    const venueText = String(game?.venue?.name || '').trim()
    const isRacing = isRacingGame(game)
    const useTeamCardColors = leagueStatToggleEnabled(displayLeague, 'useTeamCardColors', false)
    const hasLiveMode = hasLiveGameMode(displayLeague)
    const nextRace = isRacing ? nextRacingCalendarEvent(payload, game) : null
    const liveTheme = runtimeLiveTheme(game, rawEvent)
    const baseballLiveData = hasLiveMode && liveTheme === 'baseball'
      ? extractBaseballLiveSituation(rawEvent, game)
      : null
    const baseballBattingSide = baseballLiveData ? resolveBaseballBattingSide(rawEvent, game) : null
    const runtimeDateText = formatRuntimeDate(game)
    const detailStats = buildRuntimeDetailStats({
      rawEvent,
      game,
      league: displayLeague,
      baseballSituationText,
      venueText,
      hasBaseballLivePanel: Boolean(hasLiveMode && baseballLiveData),
    })
    const isPreRaceNoEntries = isRacing
      && String(game?.state || '').toLowerCase() === 'pre'
      && (!game?.racingEntries || game.racingEntries.length === 0)
    const racingTopPrimaryLabel = nextRace?.label || isPreRaceNoEntries
      ? 'NEXT RACE'
      : String(game?.state || '').toLowerCase() === 'post'
        ? 'FINAL'
        : 'RACE STATUS'
    const racingTopPrimaryText = nextRace?.label
      ? `${nextRace.label}${nextRace.dateText ? ` • ${nextRace.dateText}` : ''}`
      : isPreRaceNoEntries
        ? (game?.runtimeDateText || formatRuntimeStatus(game) || String(game?.title || '').trim())
        : formatRuntimeStatus(game)
    const racingTopTvText = hasLiveMode && displayLeague?.showTV && broadcastText
      ? `TV ${broadcastText}`
      : ''

    let finalInfoParts = []
    const isLargeLogoLiveBaseball = (displayLeague?.cardStyle || 'standard') === 'large-logo' && baseballLiveData

    if (isLargeLogoLiveBaseball) {
      if (displayLeague?.showTV && broadcastText && !isRacing) finalInfoParts.push(`TV ${broadcastText}`)
      if (displayLeague?.showOdds && oddsText) finalInfoParts.push(`Odds ${oddsText}`)
      if (displayLeague?.showNews && venueText) finalInfoParts.push(venueText)
    } else {
      finalInfoParts = [formatRuntimeStatus(game)].filter(Boolean).filter((s) => s !== 'Scheduled')
      if (hasLiveMode && baseballSituationText && !baseballLiveData) finalInfoParts.push(baseballSituationText)
      if (displayLeague?.showTV && broadcastText && !isRacing) finalInfoParts.push(`TV ${broadcastText}`)
      if (displayLeague?.showOdds && oddsText) finalInfoParts.push(`Odds ${oddsText}`)
      if (displayLeague?.showNews && venueText) finalInfoParts.push(venueText)
      if (isPreRaceNoEntries && runtimeDateText) finalInfoParts.push(runtimeDateText)
    }

    return {
      ...game,
      isLiveFeatured:
        Boolean(displayLeague?.liveGameMode) && String(game?.state || '').toLowerCase() === 'in',
      liveTheme,
      isRacing,
      useTeamCardColors,
      showLiveState: hasLiveMode,
      showStatRecords: leagueStatToggleEnabled(displayLeague, 'showStatRecords', true),
      nextRace,
      baseballLiveData,
      baseballBattingSide,
      runtimeDateText,
      detailStats,
      racingTopInfo: {
        label: racingTopPrimaryLabel,
        value: racingTopPrimaryText,
        tv: racingTopTvText,
      },
      teams: {
        ...game.teams,
        away: {
          ...(game?.teams?.away || {}),
          logo: String(game?.teams?.away?.logo || awayLogoRaw || '').trim(),
          palette: {
            primary: sanitizeHexColor(awayCached?.color) || awayPaletteRaw.primary || sanitizeHexColor(game?.teams?.away?.color),
            alternate: sanitizeHexColor(awayCached?.alternate_color) || awayPaletteRaw.alternate || sanitizeHexColor(game?.teams?.away?.alternateColor),
          },
        },
        home: {
          ...(game?.teams?.home || {}),
          logo: String(game?.teams?.home?.logo || homeLogoRaw || '').trim(),
          palette: {
            primary: sanitizeHexColor(homeCached?.color) || homePaletteRaw.primary || sanitizeHexColor(game?.teams?.home?.color),
            alternate: sanitizeHexColor(homeCached?.alternate_color) || homePaletteRaw.alternate || sanitizeHexColor(game?.teams?.home?.alternateColor),
          },
        },
      },
      cardInfo: finalInfoParts.join(' • '),
      cardStyle: displayLeague?.cardStyle || 'standard',
      slateOrder: index,
    }
  })
  .sort((left, right) => {
    if (Boolean(displayLeague?.liveGameMode)) {
      const leftLive = left?.isLiveFeatured ? 0 : 1
      const rightLive = right?.isLiveFeatured ? 0 : 1
      if (leftLive !== rightLive) return leftLive - rightLive
    }
    const leftStart = Number.isFinite(Number(left?.startsInMinutes)) ? Number(left.startsInMinutes) : Number.MAX_SAFE_INTEGER
    const rightStart = Number.isFinite(Number(right?.startsInMinutes)) ? Number(right.startsInMinutes) : Number.MAX_SAFE_INTEGER
    if (leftStart !== rightStart) return leftStart - rightStart
    return (left?.slateOrder || 0) - (right?.slateOrder || 0)
  })
}
