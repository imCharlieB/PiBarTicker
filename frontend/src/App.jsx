import { useEffect, useState } from 'react'
import './App.css'
import { DARK_PRESET, deriveThemeTokens, LIGHT_PRESET } from './themeTokens'
import TickerRuntime from './ticker/TickerRuntime'
import { useAppContext, parseLeagueApiParams, isIndividualSport } from './AppContext'

function parseList(value) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function listToText(items) {
  return items.join('\n')
}

function pickerValue(value, fallback) {
  return value && value.trim() ? value : fallback
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isHttpUrl(value) {
  if (!value || !value.trim()) {
    return true
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getLeagueEntityType(league) {
  const params = parseLeagueApiParams(league?.url || '')
  const sport = (params.sport || '').toLowerCase()
  const leagueSlug = (params.league || league?.id || '').toLowerCase()

  const isRacing = sport === 'racing' || sport === 'motorsports' || 
    /racing|motorsport|motogp|nascar|indy|indycar|wec|imsa|supercars|rally|f2|f3/.test(leagueSlug)
  const isGolf = sport === 'golf' || /golf|pga|lpga/.test(leagueSlug)
  const isMma = sport === 'mma' || /mma|ufc|bellator|pfl|mixed martial/.test(leagueSlug)
  const isCombat = sport === 'boxing' || /boxing/.test(leagueSlug)
  const isTennis = sport === 'tennis' || /tennis|atp|wta/.test(leagueSlug)

  if (isRacing) {
    // F1 is special: it has constructor teams + 2 drivers per team.
    // Most other racing (NASCAR etc.) is primarily driver-focused.
    if (leagueSlug.includes('f1') || leagueSlug.includes('formula')) {
      return { kind: 'hybrid', label: 'Teams & Drivers', singular: 'Entity' }
    }
    return { kind: 'individual', label: 'Drivers', singular: 'Driver' }
  }

  if (isGolf) {
    return { kind: 'individual', label: 'Players', singular: 'Player' }
  }

  if (isMma) {
    return { kind: 'individual', label: 'Fighters', singular: 'Fighter' }
  }

  if (isCombat) {
    return { kind: 'individual', label: 'Boxers', singular: 'Boxer' }
  }

  if (isTennis) {
    return { kind: 'individual', label: 'Players', singular: 'Player' }
  }

  // Default = traditional team sport
  return { kind: 'team', label: 'Teams', singular: 'Team' }
}


function getLogoVariantLabel(logo, index) {
  const alt = typeof logo?.alt === 'string' ? logo.alt.trim() : ''
  if (alt) {
    return alt
  }

  const rel = Array.isArray(logo?.rel)
    ? logo.rel.filter(Boolean).join(' / ')
    : typeof logo?.rel === 'string'
      ? logo.rel.trim()
      : ''
  if (rel) {
    return rel
  }

  const href = typeof logo?.href === 'string' ? logo.href : ''
  if (href) {
    try {
      const parsed = new URL(href)
      const fileName = parsed.pathname.split('/').filter(Boolean).pop() || ''
      const withoutExt = fileName.replace(/\.[a-z0-9]+$/i, '')
      const cleaned = decodeURIComponent(withoutExt).replace(/[-_]+/g, ' ').trim()
      if (cleaned) {
        return cleaned
      }
    } catch {
      // Fall through to default label.
    }
  }

  return `Variant ${index + 1}`
}

const DIRECT_SPORT_FILTERS = new Set([
  'football',
  'basketball',
  'baseball',
  'hockey',
  'soccer',
  'golf',
  'tennis',
  'mma',
  'boxing',
  'motorsports',
  'cricket',
  'rugby',
  'lacrosse',
])


const LEAGUE_CATALOG_SPORT_OPTIONS = [
  { value: 'all', label: 'All sports' },
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'baseball', label: 'Baseball' },
  { value: 'hockey', label: 'Hockey' },
  { value: 'soccer', label: 'Soccer' },
  { value: 'golf', label: 'Golf' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'mma', label: 'MMA' },
  { value: 'boxing', label: 'Boxing' },
  { value: 'motorsports', label: 'Motorsports' },
  { value: 'cricket', label: 'Cricket' },
  { value: 'rugby', label: 'Rugby' },
  { value: 'lacrosse', label: 'Lacrosse' },
  { value: 'us-major', label: 'US major pro leagues' },
  { value: 'college', label: 'College / NCAA' },
  { value: 'women', label: "Women's leagues" },
]

const LEAGUE_CATALOG_REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'us', label: 'United States' },
  { value: 'europe', label: 'Europe' },
  { value: 'americas', label: 'Americas (non-US)' },
  { value: 'asia', label: 'Asia' },
  { value: 'oceania', label: 'Oceania' },
  { value: 'africa', label: 'Africa' },
  { value: 'global', label: 'Global / International' },
]

function normalizeCatalogText(value) {
  return String(value || '').trim().toLowerCase()
}

function matchesLeagueCatalogSportFilter(entry, filterValue) {
  const filter = normalizeCatalogText(filterValue)
  if (!filter || filter === 'all') {
    return true
  }

  const sport = normalizeCatalogText(entry?.sport)
  const league = normalizeCatalogText(entry?.league)
  const leagueName = normalizeCatalogText(entry?.leagueName)
  const abbreviation = normalizeCatalogText(entry?.abbreviation)
  const haystack = `${sport} ${league} ${leagueName} ${abbreviation}`

  if (filter === 'motorsports') {
    return (
      sport === 'racing'
      || sport === 'motorsports'
      || /f1|formula\s*1|nascar|indycar|motogp|rally|wec|imsa|supercars|racing/.test(haystack)
    )
  }

  if (filter === 'boxing') {
    return sport === 'boxing' || /boxing|wbc|wba|ibf|wbo/.test(haystack)
  }

  if (filter === 'mma') {
    return sport === 'mma' || /mma|mixed martial|ufc|pfl|bellator/.test(haystack)
  }

  if (DIRECT_SPORT_FILTERS.has(filter)) {
    return sport === filter
  }

  if (filter === 'us-major') {
    return ['nfl', 'nba', 'wnba', 'mlb', 'nhl', 'mls', 'nwsl'].includes(league)
  }

  if (filter === 'college') {
    return /\bncaa\b|college/.test(haystack)
  }

  if (filter === 'women') {
    return /women|\bwnba\b|\bnwsl\b|\bwta\b|\blpga\b/.test(haystack)
  }

  return true
}

function matchesLeagueCatalogRegionFilter(entry, filterValue) {
  const filter = normalizeCatalogText(filterValue)
  if (!filter || filter === 'all') {
    return true
  }

  const sport = normalizeCatalogText(entry?.sport)
  const league = normalizeCatalogText(entry?.league)
  const leagueName = normalizeCatalogText(entry?.leagueName)
  const abbreviation = normalizeCatalogText(entry?.abbreviation)
  const haystack = `${sport} ${league} ${leagueName} ${abbreviation}`

  if (filter === 'us') {
    return /\bnfl\b|\bnba\b|\bwnba\b|\bmlb\b|\bnhl\b|\bmls\b|\bnwsl\b|\bncaa\b|college|united states|\busa\b/.test(haystack)
  }

  if (filter === 'europe') {
    return /uefa|europe|premier league|laliga|bundesliga|serie a|ligue 1|eredivisie/.test(haystack)
  }

  if (filter === 'americas') {
    return /concacaf|conmebol|copa|liga mx|argentina|brasil|brazil|canada|cfl|libertadores/.test(haystack)
  }

  if (filter === 'asia') {
    return /\bafc\b|asia|j league|k league|ipl|india|japan|korea|china/.test(haystack)
  }

  if (filter === 'oceania') {
    return /oceania|a-league|australia|new zealand/.test(haystack)
  }

  if (filter === 'africa') {
    return /\bcaf\b|africa/.test(haystack)
  }

  if (filter === 'global') {
    return /world|international|fifa|olympic|formula\s*1|f1|atp|wta|davis cup|fiba/.test(haystack)
  }

  return true
}

function resolveTeamPrimaryLogo(team, leagueId) {
  const logos = Array.isArray(team?.logos) ? team.logos : []
  if (!logos.length) {
    return ''
  }

  const leagueToken = String(leagueId || '').trim().toLowerCase()
  const abbreviation = String(team?.abbreviation || '').trim().toLowerCase()

  const ranked = logos
    .filter((logo) => typeof logo?.href === 'string' && logo.href.trim())
    .map((logo) => {
      const href = logo.href.trim()
      const lowerHref = href.toLowerCase()
      let score = 0

      if (leagueToken && lowerHref.includes(`/teamlogos/${leagueToken}/`)) {
        score += 5
      }

      if (abbreviation) {
        try {
          const path = new URL(href).pathname.toLowerCase()
          if (path.includes(`/${abbreviation}.`)) {
            score += 4
          }
        } catch {
          if (lowerHref.includes(`/${abbreviation}.`)) {
            score += 4
          }
        }
      }

      if (lowerHref.includes('/500/')) {
        score += 1
      }

      if (lowerHref.includes('/scoreboard/')) {
        score -= 1
      }

      return { href, score }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.href || ''
}

function findBoardByType(cfg, type) {
  return cfg?.boards?.find((board) => board.type === type) || null
}

function getSectionSnapshots(cfg) {
  const homeAssistantBoard = findBoardByType(cfg, 'home-assistant')
  const sportsBoard = findBoardByType(cfg, 'sports')

  return {
    display: {
      monitor: cfg.monitor,
      kiosk: cfg.kiosk,
    },
    theme: {
      theme: cfg.theme,
    },
    services: {
      homeAssistant: cfg.homeAssistant,
      http: cfg.http,
      haSensors: homeAssistantBoard?.haSensors || [],
    },
    ticker: {
      sportsBoard,
    },
  }
}

function formatRuntimeStatus(game) {
  const state = String(game?.state || '').toLowerCase()
  if (state === 'pre') {
    return 'Scheduled'
  }

  const detail = String(game?.status?.shortDetail || game?.status?.detail || '').trim()
  if (detail) {
    return detail
  }

  if (state === 'in') {
    return 'Live'
  }
  if (state === 'post') {
    return 'Final'
  }
  return 'Scheduled'
}

function formatRuntimeDate(game) {
  const start = String(game?.startTimeUtc || '').trim()
  if (!start) {
    return ''
  }

  const date = new Date(start)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function leagueStatToggleEnabled(league, field, fallback = true) {
  if (!league || typeof league !== 'object') {
    return fallback
  }

  if (typeof league[field] === 'boolean') {
    return league[field]
  }

  return fallback
}

/**
 * Live game mode drives the entire enhanced live card experience
 * (baseball diamond with runners, outs/count panel, extra live headers, etc.).
 *
 * There is now only ONE control for this: the "Live game mode" checkbox.
 * The old separate "show live state" toggle has been removed.
 */
function hasLiveGameMode(league) {
  if (!league || typeof league !== 'object') {
    return false
  }
  return Boolean(league.liveGameMode)
}

function buildRuntimeDetailStats({ rawEvent, game, league, baseballSituationText, venueText, hasBaseballLivePanel = false }) {
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
      if (value) {
        stats.push({ label: 'Clock', value })
      }
    }
  }

  if (hasLiveMode && leagueStatToggleEnabled(league, 'showStatSituation', true)) {
    if (!hasBaseballLivePanel) {
      const downDistance = String(game?.liveState?.downDistanceText || '').trim()
      const liveDetail = String(game?.liveState?.detail || '').trim()
      const situationText = baseballSituationText || downDistance || liveDetail
      if (situationText) {
        stats.push({ label: 'Situation', value: situationText })
      }
    }
  }

  if (leagueStatToggleEnabled(league, 'showStatVenue', false)) {
    const venue = venueText
      || [game?.venue?.name, game?.venue?.city, game?.venue?.state]
        .filter(Boolean)
        .join(', ')
    if (venue) {
      stats.push({ label: 'Venue', value: venue })
    }
  }

  if (leagueStatToggleEnabled(league, 'showStatOdds', false)) {
    const oddsRaw = extractEventOdds(rawEvent) || String(game?.odds?.details || '').trim()
    if (oddsRaw) {
      stats.push({ label: 'Odds', value: oddsRaw })
    }
  }

  return stats.slice(0, 3)
}

function sanitizeHexColor(value) {
  const token = String(value || '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(token)) {
    return `#${token}`
  }
  if (/^[0-9a-fA-F]{6}$/.test(token)) {
    return `#${token}`
  }
  return ''
}

function hexToRgb(hex) {
  const cleaned = sanitizeHexColor(hex).replace('#', '')
  if (!cleaned) {
    return null
  }

  const normalized = cleaned.length === 3
    ? cleaned.split('').map((char) => `${char}${char}`).join('')
    : cleaned

  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null
  }

  return { r, g, b }
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return ''
  }

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function readableTextForColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return '#f5fbff'
  }

  const luma = (0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b)
  return luma > 162 ? '#061018' : '#f5fbff'
}

function isRacingGame(game) {
  return String(game?.sport || '').toLowerCase() === 'racing'
}

function formatRacingCalendarDate(value) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function nextRacingCalendarEvent(payload, game) {
  const calendar = payload?.scoreboard?.leagues?.[0]?.calendar
  if (!Array.isArray(calendar) || !calendar.length) {
    return null
  }

  const gameStart = String(game?.startTimeUtc || '').trim()
  const gameTimestamp = gameStart ? new Date(gameStart).getTime() : Number.NaN
  const nowTimestamp = Date.now()
  const threshold = Number.isNaN(gameTimestamp) ? nowTimestamp : Math.max(nowTimestamp, gameTimestamp)

  const nextItem = calendar.find((item) => {
    const startDate = String(item?.startDate || '').trim()
    if (!startDate) {
      return false
    }
    const timestamp = new Date(startDate).getTime()
    return !Number.isNaN(timestamp) && timestamp > threshold
  })

  if (!nextItem) {
    return null
  }

  return {
    label: String(nextItem?.label || '').trim(),
    dateText: formatRacingCalendarDate(nextItem?.startDate),
  }
}

function extractEventOdds(rawEvent) {
  const competition = rawEvent?.competitions?.[0] || {}
  const odds = competition?.odds
  if (!Array.isArray(odds) || !odds.length) {
    return ''
  }

  const first = odds[0] || {}
  return String(first?.details || first?.displayValue || '').trim()
}

function formatBaseballSituation(rawEvent, game) {
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

  if (!sportId.includes('baseball') || String(game?.state || '').toLowerCase() !== 'in') {
    return ''
  }

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
  if (outs !== null) {
    parts.push(`${outs} out${outs === 1 ? '' : 's'}`)
  }
  if (balls !== null && strikes !== null) {
    parts.push(`Count ${balls}-${strikes}`)
  }
  if (occupiedBases.length) {
    parts.push(`Bases ${occupiedBases.join(', ')}`)
  }

  return parts.join(' • ')
}

function extractBaseballLiveSituation(rawEvent, game) {
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

  if (!sportId.includes('baseball') || String(game?.state || '').toLowerCase() !== 'in') {
    return null
  }

  const situation = game?.liveState || rawEvent?.competitions?.[0]?.situation || {}
  const outs = Number.isInteger(Number(situation?.outs)) ? Number(situation.outs) : null
  const balls = Number.isInteger(Number(situation?.balls)) ? Number(situation.balls) : null
  const strikes = Number.isInteger(Number(situation?.strikes)) ? Number(situation.strikes) : null

  // Extract inning number and half (top/bottom) from common ESPN fields
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

  // Try explicit inning field if present
  const rawInning = Number(situation?.inning ?? game?.liveState?.inning)
  if (Number.isInteger(rawInning) && rawInning > 0) {
    inning = rawInning
  }

  // Parse half + inning from text like "Top of the 4th", "Bot 7", "T5", "B9th"
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

  // Fallback: try to find any number near common markers
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

function resolveBaseballBattingSide(rawEvent, game) {
  if (String(game?.state || '').toLowerCase() !== 'in') {
    return null
  }

  const halfInningToken = String(game?.liveState?.halfInning || '').trim().toLowerCase()
  if (halfInningToken) {
    if (halfInningToken.startsWith('top') || halfInningToken === 't') {
      return 'away'
    }
    if (halfInningToken.startsWith('bottom') || halfInningToken.startsWith('bot') || halfInningToken === 'b') {
      return 'home'
    }
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

  if (detailText.includes('top')) {
    return 'away'
  }
  if (detailText.includes('bottom') || detailText.includes('bot')) {
    return 'home'
  }

  // ESPN often uses abbreviated inning markers like "T7" or "B7".
  if (/\bT\s*\d+/i.test(detailText) || /\bTop\s*\d+/i.test(detailText)) {
    return 'away'
  }
  if (/\bB\s*\d+/i.test(detailText) || /\bBot\s*\d+/i.test(detailText) || /\bBottom\s*\d+/i.test(detailText)) {
    return 'home'
  }

  return null
}

function runtimeLiveTheme(game, rawEvent) {
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

  if (token.includes('football')) {
    return 'football'
  }
  if (token.includes('baseball')) {
    return 'baseball'
  }
  if (token.includes('basketball')) {
    return 'basketball'
  }
  if (token.includes('hockey')) {
    return 'hockey'
  }
  return 'generic'
}

function resolveEventTeamLogo(rawEvent, homeAway) {
  const competitors = Array.isArray(rawEvent?.competitions?.[0]?.competitors)
    ? rawEvent.competitions[0].competitors
    : []
  const team = competitors.find((competitor) => String(competitor?.homeAway || '').toLowerCase() === homeAway)?.team || {}

  if (Array.isArray(team?.logos) && team.logos.length) {
    const href = String(team.logos[0]?.href || '').trim()
    if (href) {
      return href
    }
  }

  return String(team?.logo || '').trim()
}

function resolveEventTeamPalette(rawEvent, homeAway) {
  const competitors = Array.isArray(rawEvent?.competitions?.[0]?.competitors)
    ? rawEvent.competitions[0].competitors
    : []
  const team = competitors.find((competitor) => String(competitor?.homeAway || '').toLowerCase() === homeAway)?.team || {}

  return {
    primary: sanitizeHexColor(team?.color),
    alternate: sanitizeHexColor(team?.alternateColor),
  }
}

function findNextLeagueIndexInOrder(currentIndex, leagues, payloadByLeagueId, loadStateByLeagueId = {}) {
  if (!Array.isArray(leagues) || leagues.length <= 1) {
    return 0
  }

  const leagueCount = leagues.length
  const safeCurrent = Math.max(0, currentIndex % leagueCount)

  let firstUnknown = -1
  let firstWithGames = -1

  // Walk forward in configured order.
  // Skip known error/empty leagues, prefer probing unknown leagues, otherwise use known leagues with games.
  for (let offset = 1; offset < leagueCount; offset += 1) {
    const candidate = (safeCurrent + offset) % leagueCount
    const league = leagues[candidate]
    const loadState = loadStateByLeagueId?.[league.id] || {}
    if (loadState.error) {
      continue
    }

    const payload = payloadByLeagueId?.[league.id]
    if (!payload || !Array.isArray(payload?.normalizedGames)) {
      if (firstUnknown < 0) {
        firstUnknown = candidate
      }
      continue
    }

    const gameCount = Array.isArray(payload?.normalizedGames) ? payload.normalizedGames.length : 0
    if (gameCount === 0) {
      continue
    }

    if (firstWithGames < 0) {
      firstWithGames = candidate
    }
  }

  // Prefer known leagues with games (to show content in ticker) over unknown (probing).
  // Only probe unknowns if no known good ahead in the order.
  if (firstWithGames >= 0) {
    return firstWithGames
  }

  if (firstUnknown >= 0) {
    return firstUnknown
  }

  return safeCurrent
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const explicitView = String(searchParams.get('view') || '').trim().toLowerCase()
  const isSetupRoute = pathname.startsWith('/setup') || explicitView === 'setup'
  const isTickerRoute =
    pathname === '/'
    || pathname.startsWith('/ticker')
    || pathname.startsWith('/runtime')
    || explicitView === 'ticker'
    || searchParams.get('kiosk') === '1'
  const isTickerRuntime = isTickerRoute && !isSetupRoute

  // Add a class to <html> when in kiosk/ticker runtime so we can reliably
  // hide scrollbars only in that mode (without affecting the setup UI).
  // Also force overflow hidden directly for maximum compatibility on Pi Chromium.
  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    if (isTickerRuntime) {
      root.classList.add('kiosk-mode')
      root.style.overflow = 'hidden'
      if (body) body.style.overflow = 'hidden'
    } else {
      root.classList.remove('kiosk-mode')
      root.style.overflow = ''
      if (body) body.style.overflow = ''
    }
    return () => {
      root.classList.remove('kiosk-mode')
      root.style.overflow = ''
      if (body) body.style.overflow = ''
    }
  }, [isTickerRuntime])

  const {
    config, savedConfig, isLoading, error, notice, setError, setNotice,
    isPending, startTransition, activePage, setActivePage,
    commitConfig, saveConfig, resetConfig,
    updateConfigSection, updateThemeTeam, applyThemeMode, setThemeOverride, clearThemeOverride,
    updateBoard, updateLeague, moveLeague, toggleLeagueIncludedGroup, toggleLeagueIncludedTeam,
    addLeagueFromCatalog,
    leagueLogoMetaById, logoSyncingLeagues, logoClearMessageById, setLogoClearMessageById,
    loadLeagueLogoMeta, enrichTeamsForLogoSync, triggerLogoCacheForLeague,
    downloadExtrasForTeam, getCachedOrRemoteLogo, tickerWatermarkUrl,
    runtimeLeagueIndex,
    runtimeVisibleLeagueId,
    runtimePayloadByLeagueId, runtimeLoadStateByLeagueId,
    initialPreFetchesComplete, setHandoffCheckKey,
    stableGoodGamesByLeagueId, runtimeLastStableLeagueId, runtimeLastStableMarqueeGames,
    refreshRuntimeLeaguePayload, handleRuntimeAdvance,
    handoffGraceRef, scrolledThisSlotRef, leagueSlotStartTimeRef, currentSlotLeagueIdRef,
    currentLeaguesLengthRef,
    leagueTeamsById, leagueLoadStateById, leagueGroupsById, leagueGroupsLoadStateById,
    teamLogoDetailsByKey, teamLogoLoadStateByKey,
    leagueTickerPreviewById, leagueTickerPreviewLoadStateById,
    leagueCatalog, leagueCatalogSport, setLeagueCatalogSport,
    leagueCatalogRegion, setLeagueCatalogRegion,
    leagueCatalogQuery, setLeagueCatalogQuery,
    leagueCatalogState, showLeagueCatalog, setShowLeagueCatalog,
    showBoardSettings, setShowBoardSettings,
    loadLeagueTeams, loadLeagueGroups, loadTeamLogosForLeagueTeam,
    loadLeagueTickerPreview, loadLeagueCatalog,
  } = useAppContext()

  const [selectedTickerLeagueId, setSelectedTickerLeagueId] = useState('')
  const [selectedTickerTeamId, setSelectedTickerTeamId] = useState('')

  const sportsBoard = config?.boards.find((board) => board.type === 'sports')
  const homeAssistantBoard = config?.boards.find(
    (board) => board.type === 'home-assistant',
  )
  const themeTokens = config ? deriveThemeTokens(config.theme, { sportsBoard, leagueLogoMetaById }) : null
  const runtimeLeagues = sportsBoard?.leagues.filter((league) => league.enabled) ?? []
  const runtimeLeagueIdsKey = runtimeLeagues.map((league) => league.id).join('|')
  const runtimeBoardWidth = Math.max(320, Number(config?.monitor?.width) || 1920)

  const activeRuntimeLeague = runtimeLeagues.length
    ? runtimeLeagues[runtimeLeagueIndex % runtimeLeagues.length]
    : null
  const runtimeVisibleLeague = runtimeLeagues.find((league) => league.id === runtimeVisibleLeagueId) || null
  const logicalDisplayLeague = runtimeVisibleLeague || activeRuntimeLeague
  // During initial pre-fetch phase (!initialPreFetchesComplete), force the display league (and thus
  // all content, track key, marquee games, brand logo, measurement, per-display refresh target, etc.)
  // to the user's *first* league in the exact configured order. This stops any visible flipping or
  // "landing on 4th/5th" during load. The settle (below) forces index to 0 (first in list) once data is ready.
  const runtimeDisplayLeague = initialPreFetchesComplete ? logicalDisplayLeague : (runtimeLeagues[0] || logicalDisplayLeague)
  const activeRuntimePayload = runtimeDisplayLeague
    ? runtimePayloadByLeagueId[runtimeDisplayLeague.id] || null
    : null
  const activeRuntimeGames = Array.isArray(activeRuntimePayload?.normalizedGames)
    ? activeRuntimePayload.normalizedGames
    : []
  const stableForDisplayLeague = runtimeDisplayLeague
    ? (stableGoodGamesByLeagueId[runtimeDisplayLeague.id] || [])
    : []
  const activeRuntimeLoadState = activeRuntimeLeague
    ? runtimeLoadStateByLeagueId[activeRuntimeLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const activeRuntimeRawEvents = Array.isArray(activeRuntimePayload?.scoreboard?.events)
    ? activeRuntimePayload.scoreboard.events
    : []
  const activeRuntimeRawEventsById = new Map(
    activeRuntimeRawEvents
      .map((event) => [String(event?.id || '').trim(), event])
      .filter(([id]) => id),
  )
  const runtimeDisplayGames = activeRuntimeGames.map((game, index) => {
    const rawEvent = activeRuntimeRawEventsById.get(String(game?.id || '').trim())
    const oddsText = extractEventOdds(rawEvent) || String(game?.odds?.details || '').trim()
    const baseballSituationText = formatBaseballSituation(rawEvent, game)
    const awayLogoRaw = resolveEventTeamLogo(rawEvent, 'away')
    const homeLogoRaw = resolveEventTeamLogo(rawEvent, 'home')
    const awayPaletteRaw = resolveEventTeamPalette(rawEvent, 'away')
    const homePaletteRaw = resolveEventTeamPalette(rawEvent, 'home')

    // Primary source: new local logo cache (team-meta + local logos)
    const cachedMeta = runtimeDisplayLeague ? leagueLogoMetaById[runtimeDisplayLeague.id] : null
    const awayCached = cachedMeta?.teams?.[String(game?.teams?.away?.id || '').trim()]
    const homeCached = cachedMeta?.teams?.[String(game?.teams?.home?.id || '').trim()]
    const broadcastText = Array.isArray(game?.broadcasts)
      ? game.broadcasts
        .map((item) => String(item || '').trim())
        .filter((item) => item && item !== '[' && item !== ']')
        .slice(0, 2)
        .join(' / ')
      : ''
    const venueText = String(game?.venue?.name || '').trim()
    const isRacing = isRacingGame(game)
    const useTeamCardColors = leagueStatToggleEnabled(runtimeDisplayLeague, 'useTeamCardColors', false)
    const hasLiveMode = hasLiveGameMode(runtimeDisplayLeague)
    const nextRace = isRacing ? nextRacingCalendarEvent(activeRuntimePayload, game) : null
    const liveTheme = runtimeLiveTheme(game, rawEvent)
    const baseballLiveData = hasLiveMode && liveTheme === 'baseball'
      ? (game?.liveState || extractBaseballLiveSituation(rawEvent, game))
      : null
    const baseballBattingSide = baseballLiveData
      ? resolveBaseballBattingSide(rawEvent, game)
      : null
    const runtimeDateText = formatRuntimeDate(game)
    const detailStats = buildRuntimeDetailStats({
      rawEvent,
      game,
      league: runtimeDisplayLeague,
      baseballSituationText,
      venueText,
      hasBaseballLivePanel: Boolean(hasLiveMode && baseballLiveData),
    })
    // For synthetic upcoming races we inject from calendar when ESPN "events" is empty (NASCAR "in a few days" etc.),
    // the game itself *is* the next race (state=pre, no entries/competitors yet). Label it as such so the card
    // data reflects "NEXT RACE <name> • <date>" instead of generic "RACE STATUS".
    const isPreRaceNoEntries = isRacing && String(game?.state || '').toLowerCase() === 'pre' && (!game?.racingEntries || game.racingEntries.length === 0)
    const racingTopPrimaryLabel = nextRace?.label
      ? 'NEXT RACE'
      : isPreRaceNoEntries
        ? 'NEXT RACE'
        : String(game?.state || '').toLowerCase() === 'post'
          ? 'FINAL'
          : 'RACE STATUS'
    const racingTopPrimaryText = nextRace?.label
      ? `${nextRace.label}${nextRace.dateText ? ` • ${nextRace.dateText}` : ''}`
      : isPreRaceNoEntries
        ? (game?.runtimeDateText || formatRuntimeStatus(game) || String(game?.title || '').trim())
        : formatRuntimeStatus(game)
    const racingTopTvText = hasLiveMode && runtimeDisplayLeague?.showTV && broadcastText
      ? `TV ${broadcastText}`
      : ''

    // For Large Logo cards with live baseball that have their own big custom inning/count/outs display,
    // keep the tiny bottom meta line 100% clean — only the extra toggled info (TV, Odds, Venue).
    // Never include status or inning text in the lower meta for these cards.
    let finalInfoParts = [];

    const isLargeLogoLiveBaseball = (runtimeDisplayLeague?.cardStyle || 'standard') === 'large-logo' && baseballLiveData;

    if (isLargeLogoLiveBaseball) {
      // Only the toggled extras, nothing else.
      if (runtimeDisplayLeague?.showTV && broadcastText && !isRacing) {
        finalInfoParts.push(`TV ${broadcastText}`);
      }
      if (runtimeDisplayLeague?.showOdds && oddsText) {
        finalInfoParts.push(`Odds ${oddsText}`);
      }
      if (runtimeDisplayLeague?.showNews && venueText) {
        finalInfoParts.push(venueText);
      }
    } else {
      // Normal behavior for everything else
      finalInfoParts = [formatRuntimeStatus(game)].filter(Boolean).filter(s => s !== 'Scheduled');
      if (hasLiveMode && baseballSituationText && !baseballLiveData) {
        finalInfoParts.push(baseballSituationText);
      }
      if (runtimeDisplayLeague?.showTV && broadcastText && !isRacing) {
        finalInfoParts.push(`TV ${broadcastText}`);
      }
      if (runtimeDisplayLeague?.showOdds && oddsText) {
        finalInfoParts.push(`Odds ${oddsText}`);
      }
      if (runtimeDisplayLeague?.showNews && venueText) {
        finalInfoParts.push(venueText);
      }
      // For calendar-sourced pre races (NASCAR future etc when no current event), make sure the date shows in the bottom meta line.
      if (isPreRaceNoEntries && runtimeDateText) {
        finalInfoParts.push(runtimeDateText);
      }
    }

    return {
      ...game,
      isLiveFeatured:
        Boolean(runtimeDisplayLeague?.liveGameMode)
        && String(game?.state || '').toLowerCase() === 'in',
      liveTheme,
      isRacing,
      useTeamCardColors,
      showLiveState: hasLiveMode,
      showStatRecords: leagueStatToggleEnabled(runtimeDisplayLeague, 'showStatRecords', true),
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
            primary: sanitizeHexColor(awayCached?.color)
              || awayPaletteRaw.primary
              || sanitizeHexColor(game?.teams?.away?.color),
            alternate: sanitizeHexColor(awayCached?.alternate_color)
              || awayPaletteRaw.alternate
              || sanitizeHexColor(game?.teams?.away?.alternateColor),
          },
        },
        home: {
          ...(game?.teams?.home || {}),
          logo: String(game?.teams?.home?.logo || homeLogoRaw || '').trim(),
          palette: {
            primary: sanitizeHexColor(homeCached?.color)
              || homePaletteRaw.primary
              || sanitizeHexColor(game?.teams?.home?.color),
            alternate: sanitizeHexColor(homeCached?.alternate_color)
              || homePaletteRaw.alternate
              || sanitizeHexColor(game?.teams?.home?.alternateColor),
          },
        },
      },
      cardInfo: finalInfoParts.join(' • '),
      cardStyle: runtimeDisplayLeague?.cardStyle || 'standard',
      slateOrder: index,
    }
  })
  .sort((left, right) => {
    if (Boolean(runtimeDisplayLeague?.liveGameMode)) {
      const leftLive = left?.isLiveFeatured ? 0 : 1
      const rightLive = right?.isLiveFeatured ? 0 : 1
      if (leftLive !== rightLive) {
        return leftLive - rightLive
      }
    }

    const leftStart = Number.isFinite(Number(left?.startsInMinutes)) ? Number(left.startsInMinutes) : Number.MAX_SAFE_INTEGER
    const rightStart = Number.isFinite(Number(right?.startsInMinutes)) ? Number(right.startsInMinutes) : Number.MAX_SAFE_INTEGER
    if (leftStart !== rightStart) {
      return leftStart - rightStart
    }

    return (left?.slateOrder || 0) - (right?.slateOrder || 0)
  })
  const runtimeMarqueeGames = runtimeDisplayGames.length
    ? runtimeDisplayGames
    : (stableForDisplayLeague && stableForDisplayLeague.length ? stableForDisplayLeague : []);
  const runtimeRenderLeague = runtimeVisibleLeague || (runtimeDisplayGames.length ? runtimeDisplayLeague : null)
  // The runtimeDisplayLeague is forced to the user's first during !complete, so use it (or the render one)
  // for the lower left brand. This keeps the logo stable on the configured first league throughout load,
  // no crazy flipping, and after the settle picker corrects the index it follows the proper start per order.
  const brandLeague = runtimeRenderLeague || runtimeDisplayLeague || runtimeLeagues[0] || null

  if (isLoading) {
    return (
      <main className="app-shell loading-shell">
        <p className="status-chip">Loading setup configuration...</p>
      </main>
    )
  }

  if (error && !config) {
    return (
      <main className="app-shell loading-shell">
        <p className="status-chip status-chip-error">{error}</p>
      </main>
    )
  }

  const shellStyle = {
    '--page-bg': themeTokens.pageBg,
    '--page-gradient': themeTokens.pageGradient,
    '--panel-bg': themeTokens.panelBg,
    '--panel-border': themeTokens.panelBorder,
    '--text-main': themeTokens.textMain,
    '--text-muted': themeTokens.textMuted,
    '--accent': themeTokens.accent,
    '--ticker-bg': themeTokens.tickerBg,
    '--ticker-text': themeTokens.tickerText,
    '--lower-bg': themeTokens.lowerBg,
    '--lower-text': themeTokens.lowerText,
    '--hero-eyebrow': themeTokens.heroEyebrow,
    '--button-text': themeTokens.buttonText,
    ...(tickerWatermarkUrl ? { '--ticker-watermark-url': `url(${tickerWatermarkUrl})` } : {}),
  }

  if (isTickerRuntime) {
    return (
      <TickerRuntime
        leagues={runtimeLeagues}
        displayLeague={runtimeDisplayLeague}
        renderLeague={runtimeRenderLeague}
        brandLeague={brandLeague}
        payloadByLeagueId={runtimePayloadByLeagueId}
        games={runtimeMarqueeGames}
        themeTokens={themeTokens}
        shellStyle={shellStyle}
        boardWidth={runtimeBoardWidth}
        config={config}
        watermarkUrl={tickerWatermarkUrl}
        homeAssistantBoard={homeAssistantBoard}
        initialPreFetchesComplete={initialPreFetchesComplete}
        sportsBoard={sportsBoard}
        sessionKey={runtimeLeagueIdsKey}
        handoffGraceRef={handoffGraceRef}
        scrolledThisSlotRef={scrolledThisSlotRef}
        leagueSlotStartTimeRef={leagueSlotStartTimeRef}
        currentSlotLeagueIdRef={currentSlotLeagueIdRef}
        onAdvance={handleRuntimeAdvance}
        onHandoffCheck={() => setHandoffCheckKey(k => k + 1)}
      />
    )
  }

  const defaultBackground = themeTokens?.pageBg || (config.theme.mode === 'light' ? LIGHT_PRESET.background : DARK_PRESET.background)
  const defaultAccent = themeTokens?.accent || (config.theme.mode === 'light' ? LIGHT_PRESET.accent : DARK_PRESET.accent)
  const enabledLeagues = sportsBoard?.leagues.filter((league) => league.enabled) ?? []
  const pages = [
    { id: 'overview', label: 'Overview' },
    { id: 'display', label: 'Display' },
    { id: 'theme', label: 'Theme' },
    { id: 'services', label: 'Services' },
    { id: 'ticker', label: 'Ticker' },
  ]

  const displayErrors = {
    mode: ['single', 'dual'].includes(config.monitor.mode)
      ? ''
      : 'Monitor mode must be single or dual.',
    width: isPositiveInteger(config.monitor.width)
      ? ''
      : 'Width must be a positive number.',
    height: isPositiveInteger(config.monitor.height)
      ? ''
      : 'Height must be a positive number.',
  }

  const themeErrors = {
    mode: ['dark', 'light', 'team'].includes(config.theme.mode)
      ? ''
      : 'Theme mode must be dark, light, or team.',
    teamLeague:
      config.theme.teamTheme.enabled && !config.theme.teamTheme.league.trim()
        ? 'Team league is required when team theme is enabled.'
        : '',
    teamCode:
      config.theme.teamTheme.enabled && !config.theme.teamTheme.team.trim()
        ? 'Team code is required when team theme is enabled.'
        : '',
  }

  const servicesErrors = {
    url: isHttpUrl(config.homeAssistant.url)
      ? ''
      : 'Home Assistant URL must start with http:// or https://.',
    port:
      !config.http.enabled ||
      (Number.isInteger(config.http.port) && config.http.port >= 1 && config.http.port <= 65535)
        ? ''
        : 'HTTP port must be between 1 and 65535 when HTTP is enabled.',
  }

  const sectionChecks = [
    {
      id: 'display',
      label: 'Display',
      errors: Object.values(displayErrors).filter(Boolean),
    },
    {
      id: 'theme',
      label: 'Theme',
      errors: Object.values(themeErrors).filter(Boolean),
    },
    {
      id: 'services',
      label: 'Services',
      errors: Object.values(servicesErrors).filter(Boolean),
    },
  ].map((check) => ({
    ...check,
    complete: check.errors.length === 0,
  }))

  const completedSetupSections = sectionChecks.filter((check) => check.complete).length
  const setupReady = completedSetupSections === sectionChecks.length
  const firstSetupError = sectionChecks.find((check) => !check.complete)?.errors[0] || ''
  const selectedTickerLeague =
    sportsBoard?.leagues.find((league) => league.id === selectedTickerLeagueId) || null
  const selectedTickerLeagueIndex =
    sportsBoard?.leagues.findIndex((league) => league.id === selectedTickerLeagueId) ?? -1
  const selectedLeagueTeams = selectedTickerLeague
    ? leagueTeamsById[selectedTickerLeague.id] || []
    : []
  const selectedLeagueLoadState = selectedTickerLeague
    ? leagueLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const selectedTickerTeam =
    selectedLeagueTeams.find((team) => team.id === selectedTickerTeamId) || null
  const selectedTeamLogoKey =
    selectedTickerLeague && selectedTickerTeam
      ? `${selectedTickerLeague.id}:${selectedTickerTeam.id}`
      : ''
  const selectedTeamLogoDetail = selectedTeamLogoKey ? teamLogoDetailsByKey[selectedTeamLogoKey] : null
  const selectedTeamLogoLoadState = selectedTeamLogoKey
    ? teamLogoLoadStateByKey[selectedTeamLogoKey] || { loading: false, error: '' }
    : { loading: false, error: '' }

  // New cached logo variants from our local system (declared early to avoid TDZ)
  const cachedTeamMeta = selectedTickerLeague && selectedTickerTeam
    ? leagueLogoMetaById[selectedTickerLeague.id]?.teams?.[String(selectedTickerTeam.id)]
    : null

  const cachedVariants = cachedTeamMeta?.logos
    ? Object.entries(cachedTeamMeta.logos).map(([variant, relativePath]) => ({
        variant,
        href: `/logos/${relativePath}`,
        isCached: true,
      }))
    : []

  // Team style/colors now come exclusively from the local logo cache (or raw ESPN data as fallback).
  const selectedTeamStyle = cachedTeamMeta || null
  // Color editing state removed — users can no longer override official team colors.
  const selectedTeamPrimaryLogos = selectedTeamLogoDetail?.primary || selectedTickerTeam?.logos || []
  const selectedTeamExtraLogos = selectedTeamLogoDetail?.extras || []
  const selectedTeamProfile = selectedTeamLogoDetail?.teamProfile || null
  const selectedTeamStandingsStats = selectedTeamProfile?.standings?.stats || {}
  const selectedTeamVenueLocation = selectedTeamProfile?.venue
    ? [
        selectedTeamProfile.venue.city,
        selectedTeamProfile.venue.state,
        selectedTeamProfile.venue.country,
      ]
        .filter(Boolean)
        .join(', ')
    : ''
  const selectedLeagueGroups = selectedTickerLeague ? leagueGroupsById[selectedTickerLeague.id] || [] : []
  const selectedLeagueGroupsLoadState = selectedTickerLeague
    ? leagueGroupsLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const selectedLeagueTickerPreview = selectedTickerLeague
    ? leagueTickerPreviewById[selectedTickerLeague.id] || null
    : null
  const selectedLeagueTickerPreviewLoadState = selectedTickerLeague
    ? leagueTickerPreviewLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const selectedLeaguePreviewMatchups = Array.from(
    new Set(
      (selectedLeagueTickerPreview?.scoreboard?.events || [])
        .map((event) => {
          const competitors = event?.competitions?.[0]?.competitors || []
          const home = competitors.find((competitor) => competitor?.homeAway === 'home')
          const away = competitors.find((competitor) => competitor?.homeAway === 'away')

          const homeTeam = home?.team || {}
          const awayTeam = away?.team || {}

          const homeName =
            homeTeam.shortDisplayName
            || homeTeam.displayName
            || homeTeam.name
            || homeTeam.abbreviation
            || ''
          const awayName =
            awayTeam.shortDisplayName
            || awayTeam.displayName
            || awayTeam.name
            || awayTeam.abbreviation
            || ''

          if (!homeName && !awayName) {
            return ''
          }

          if (homeName && awayName) {
            return `${homeName} vs ${awayName}`
          }

          return homeName || awayName
        })
        .filter(Boolean),
    ),
  )
  const selectedLeaguePreviewMatchupsText = selectedLeaguePreviewMatchups.slice(0, 8).join(', ')
  const themeLeagueToken = String(config?.theme?.teamTheme?.league || '').trim().toLowerCase()
  const themeLeagueOptions = Array.isArray(sportsBoard?.leagues)
    ? sportsBoard.leagues.map((league) => ({
      value: String(league?.id || '').trim(),
      label: String(league?.name || league?.id || '').trim(),
      league,
    })).filter((option) => option.value)
    : []
  const selectedThemeLeague = themeLeagueOptions.find((option) => {
    const optionName = String(option?.label || '').trim().toLowerCase()
    return option.value.toLowerCase() === themeLeagueToken || optionName === themeLeagueToken
  })?.league || null

  function buildThemeTeamOptions(league) {
    if (!league?.id) {
      return []
    }

    const byValue = new Map()
    const knownTeams = Array.isArray(leagueTeamsById[league.id]) ? leagueTeamsById[league.id] : []
    for (const team of knownTeams) {
      const abbreviation = String(team?.abbreviation || '').trim().toUpperCase()
      const fallbackId = String(team?.id || '').trim().toUpperCase()
      const value = abbreviation || fallbackId
      if (!value) {
        continue
      }

      const name = String(team?.name || team?.displayName || value).trim()
      const label = abbreviation && name.toUpperCase() !== abbreviation
        ? `${name} (${abbreviation})`
        : name

      byValue.set(value, { value, label })
    }

    // Supplement with any teams present in the new local logo cache (for teams that may not yet be in the live ESPN list).
    const cachedTeams = league ? (leagueLogoMetaById[league.id]?.teams || {}) : {}

    for (const [teamId, style] of Object.entries(cachedTeams)) {
      const abbreviation = String(style?.abbreviation || '').trim().toUpperCase()
      const fallbackId = String(teamId || '').trim().toUpperCase()
      const value = abbreviation || fallbackId
      if (!value || byValue.has(value)) {
        continue
      }

      const name = String(style?.display_name || style?.name || '').trim()
      const label = name
        ? `${name}${abbreviation ? ` (${abbreviation})` : ''}`
        : value

      byValue.set(value, { value, label })
    }

    return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  const themeTeamOptions = buildThemeTeamOptions(selectedThemeLeague)
  const selectedThemeTeamValue = String(config?.theme?.teamTheme?.team || '').trim().toUpperCase()

  const loadedLeagueCatalogCount = leagueCatalog.length
  const filteredLeagueCatalog = leagueCatalog.filter((entry) => {
    if (!matchesLeagueCatalogSportFilter(entry, leagueCatalogSport)) {
      return false
    }

    if (!matchesLeagueCatalogRegionFilter(entry, leagueCatalogRegion)) {
      return false
    }

    const query = leagueCatalogQuery.trim().toLowerCase()
    if (!query) {
      return true
    }

    return [entry.leagueName, entry.league, entry.sportName, entry.abbreviation]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
  const selectedCatalogSportLabel =
    LEAGUE_CATALOG_SPORT_OPTIONS.find((option) => option.value === leagueCatalogSport)?.label
    || 'Selected sport'
  const noFilteredLeagueMatches = leagueCatalog.length > 0 && filteredLeagueCatalog.length === 0
  const sectionSnapshots = getSectionSnapshots(config)
  const savedSectionSnapshots = savedConfig ? getSectionSnapshots(savedConfig) : null
  const dirtySections = {
    display: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.display) !== JSON.stringify(savedSectionSnapshots.display)
      : false,
    theme: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.theme) !== JSON.stringify(savedSectionSnapshots.theme)
      : false,
    services: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.services) !== JSON.stringify(savedSectionSnapshots.services)
      : false,
    ticker: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.ticker) !== JSON.stringify(savedSectionSnapshots.ticker)
      : false,
  }
  const dirtyPageIds = Object.entries(dirtySections)
    .filter(([, isDirty]) => isDirty)
    .map(([sectionId]) => sectionId)
  const hasUnsavedChanges = dirtyPageIds.length > 0
  const editablePageSequence = ['display', 'theme', 'services', 'ticker']

  function renderPage() {
    if (activePage === 'overview') {
      return (
        <article className="card page-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Overview</p>
              <h2>Current configuration snapshot</h2>
              <p className="setup-progress">
                Setup readiness: {completedSetupSections}/{sectionChecks.length} required sections complete
              </p>
            </div>
          </div>

          <div className="readiness-list" aria-label="Setup readiness checklist">
            {sectionChecks.map((check) => (
              <button
                key={check.id}
                type="button"
                className={`readiness-item ${check.complete ? 'is-complete' : 'is-incomplete'}`}
                onClick={() => setActivePage(check.id)}
              >
                <span className="readiness-title">{check.label}</span>
                <span className="readiness-state">{check.complete ? 'Complete' : 'Needs attention'}</span>
                {!check.complete && check.errors[0] ? (
                  <span className="readiness-error">{check.errors[0]}</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="overview-grid">
            <button type="button" className="overview-item" onClick={() => setActivePage('display')}>
              <h3>Display</h3>
              <p>Mode: {config.monitor.mode}</p>
              <p>Resolution: {config.monitor.width} x {config.monitor.height}</p>
              <p>Kiosk startup: {config.kiosk.autoStart}</p>
            </button>
            <button type="button" className="overview-item" onClick={() => setActivePage('theme')}>
              <h3>Theme</h3>
              <p>Mode: {config.theme.mode}</p>
              <p>Background override: {config.theme.background || 'None'}</p>
              <p>Accent override: {config.theme.accent || 'None'}</p>
            </button>
            <button type="button" className="overview-item" onClick={() => setActivePage('services')}>
              <h3>Services</h3>
              <p>HTTP: {config.http.enabled ? `Enabled on ${config.http.port}` : 'Disabled'}</p>
              <p>Home Assistant URL: {config.homeAssistant.url || 'Not set'}</p>
              <p>Sensors: {homeAssistantBoard?.haSensors.length || 0}</p>
            </button>
            <button type="button" className="overview-item" onClick={() => setActivePage('ticker')}>
              <h3>Ticker</h3>
              <p>Board: {sportsBoard?.enabled ? 'Enabled' : 'Disabled'}</p>
              <p>Leagues enabled: {enabledLeagues.length}</p>
              <p>Rotation: {sportsBoard?.rotateSeconds || 0}s</p>
            </button>
          </div>
        </article>
      )
    }

    if (activePage === 'display') {
      return (
        <article className="card page-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Display</p>
              <h2>Monitor and kiosk settings</h2>
            </div>
          </div>

          <div className="field-grid field-grid-2">
            <label className="field">
              <span>Monitor mode</span>
              <select value={config.monitor.mode} onChange={(event) => updateConfigSection('monitor', 'mode', event.target.value)}>
                <option value="single">Single</option>
                <option value="dual">Dual</option>
              </select>
              {displayErrors.mode ? <small className="field-error">{displayErrors.mode}</small> : null}
            </label>

            <label className="field">
              <span>Kiosk startup</span>
              <select value={config.kiosk.autoStart} onChange={(event) => updateConfigSection('kiosk', 'autoStart', event.target.value)}>
                <option value="autostart">Autostart</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>

            <label className="field">
              <span>Width</span>
              <input type="number" value={config.monitor.width} onChange={(event) => updateConfigSection('monitor', 'width', Number(event.target.value))} />
              {displayErrors.width ? <small className="field-error">{displayErrors.width}</small> : null}
            </label>

            <label className="field">
              <span>Height</span>
              <input type="number" value={config.monitor.height} onChange={(event) => updateConfigSection('monitor', 'height', Number(event.target.value))} />
              {displayErrors.height ? <small className="field-error">{displayErrors.height}</small> : null}
            </label>

            <label className="field field-full">
              <span>Chromium flags</span>
              <textarea rows="6" value={listToText(config.kiosk.chromiumFlags)} onChange={(event) => updateConfigSection('kiosk', 'chromiumFlags', parseList(event.target.value))} />
              <small className="field-help" style={{ marginTop: '4px', display: 'block' }}>
                Flags passed to Chromium when launching kiosk mode. Recommended Pi flags are included by default for smooth scrolling and no scrollbars.
              </small>
            </label>
          </div>
        </article>
      )
    }

    if (activePage === 'theme') {
      return (
        <article className="card page-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Theme</p>
              <h2>Mode, team colors, and overrides</h2>
              <p className="section-note">Team mode colors are derived from saved team styles in Ticker setup.</p>
            </div>
            <span className="theme-preview" style={{ '--theme-accent': config.theme.accent || defaultAccent, '--theme-background': config.theme.background || defaultBackground }} />
          </div>

          <div className="field-grid field-grid-2">
            <label className="field">
              <span>Mode</span>
              <select value={config.theme.mode} onChange={(event) => applyThemeMode(event.target.value)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="team">Team</option>
              </select>
              {themeErrors.mode ? <small className="field-error">{themeErrors.mode}</small> : null}
            </label>

            <label className="field field-checkbox">
              <span>Ticker watermark</span>
              <input 
                type="checkbox" 
                checked={!!config.theme.tickerWatermarkEnabled} 
                onChange={(event) => updateConfigSection('theme', 'tickerWatermarkEnabled', event.target.checked)} 
              />
            </label>

            {/* Team Theme Section */}
            <div className="field" style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
              <label className="field-checkbox" style={{ marginBottom: '0.25rem' }}>
                <span style={{ fontWeight: 600 }}>Use team theme</span>
                <input type="checkbox" checked={config.theme.teamTheme.enabled} onChange={(event) => updateThemeTeam('enabled', event.target.checked)} />
              </label>
              <small className="field-help">Apply the selected team's colors to the entire UI (background, accents, text, etc).</small>
            </div>

            <label className="field">
              <span>Team league</span>
              <select
                value={selectedThemeLeague?.id || ''}
                onChange={(event) => {
                  const nextLeagueId = String(event.target.value || '').trim()
                  const nextLeague = themeLeagueOptions.find((option) => option.value === nextLeagueId)?.league || null
                  const nextTeamOptions = buildThemeTeamOptions(nextLeague)
                  const currentTeam = String(config?.theme?.teamTheme?.team || '').trim().toUpperCase()
                  const nextTeam = nextTeamOptions.some((option) => option.value === currentTeam)
                    ? currentTeam
                    : (nextTeamOptions[0]?.value || '')

                  if (nextLeague?.id && !leagueLogoMetaById[nextLeague.id]) {
                    loadLeagueLogoMeta(nextLeague.id)
                  }

                  commitConfig((current) => ({
                    ...current,
                    theme: {
                      ...current.theme,
                      teamTheme: {
                        ...current.theme.teamTheme,
                        league: nextLeagueId,
                        team: nextTeam,
                      },
                    },
                  }))
                }}
                disabled={!config.theme.teamTheme.enabled}
              >
                <option value="">Select league</option>
                {themeLeagueOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Team</span>
              <select
                value={selectedThemeTeamValue}
                onChange={(event) => updateThemeTeam('team', String(event.target.value || '').trim().toUpperCase())}
                disabled={!config.theme.teamTheme.enabled || !selectedThemeLeague}
              >
                <option value="">Select team</option>
                {themeTeamOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedThemeLeague && themeTeamOptions.length === 0 && config.theme.teamTheme.enabled ? (
                <small className="field-help">No saved team styles found. Sync logos for this league first.</small>
              ) : null}
            </label>

            <div className="field field-full">
              <span>Background override (optional)</span>
              <div className="color-control-row">
                <input type="color" value={pickerValue(config.theme.background, defaultBackground)} onChange={(event) => setThemeOverride('background', event.target.value)} />
                <input type="text" value={config.theme.background} placeholder="Blank uses mode default" onChange={(event) => setThemeOverride('background', event.target.value)} />
                <button type="button" className="button-link" onClick={() => clearThemeOverride('background')}>Clear</button>
              </div>
            </div>

            <div className="field field-full">
              <span>Primary override (optional)</span>
              <div className="color-control-row">
                <input type="color" value={pickerValue(config.theme.accent, defaultAccent)} onChange={(event) => setThemeOverride('accent', event.target.value)} />
                <input type="text" value={config.theme.accent} placeholder="Blank uses mode default" onChange={(event) => setThemeOverride('accent', event.target.value)} />
                <button type="button" className="button-link" onClick={() => clearThemeOverride('accent')}>Clear</button>
              </div>
            </div>
          </div>
        </article>
      )
    }

    if (activePage === 'services') {
      return (
        <article className="card page-card">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Services</p>
              <h2>Home Assistant and HTTP</h2>
            </div>
          </div>

          <div className="field-grid field-grid-2">
            <label className="field field-full">
              <span>Home Assistant URL</span>
              <input type="text" value={config.homeAssistant.url} onChange={(event) => updateConfigSection('homeAssistant', 'url', event.target.value)} />
              {servicesErrors.url ? <small className="field-error">{servicesErrors.url}</small> : null}
            </label>

            <label className="field field-full">
              <span>Home Assistant access token</span>
              <input type="password" value={config.homeAssistant.token} onChange={(event) => updateConfigSection('homeAssistant', 'token', event.target.value)} />
              <small className="field-help">Used only to fetch local Home Assistant sensor values.</small>
            </label>

            <label className="field field-checkbox">
              <span>HTTP enabled</span>
              <input type="checkbox" checked={config.http.enabled} onChange={(event) => updateConfigSection('http', 'enabled', event.target.checked)} />
            </label>

            <label className="field">
              <span>HTTP port</span>
              <input type="number" value={config.http.port} onChange={(event) => updateConfigSection('http', 'port', Number(event.target.value))} />
              {servicesErrors.port ? <small className="field-error">{servicesErrors.port}</small> : null}
            </label>

            {homeAssistantBoard ? (
              <label className="field field-full">
                <span>Lower-third sensors</span>
                <textarea rows="6" value={listToText(homeAssistantBoard.haSensors)} onChange={(event) => updateBoard('home-assistant', { haSensors: parseList(event.target.value) })} />
              </label>
            ) : null}
          </div>
        </article>
      )
    }

    return sportsBoard ? (
      <article className="card page-card">
        {!selectedTickerLeague ? (
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Ticker</p>
                <h2>Leagues</h2>
                <p className="section-note">Select a league to open detailed settings and team logos.</p>
              </div>
              <div className="ticker-top-actions">
                <button
                  type="button"
                  className="button-secondary ticker-action-button"
                  onClick={() => setShowBoardSettings((current) => !current)}
                >
                  {showBoardSettings
                    ? 'Hide board settings'
                    : `Board: ${sportsBoard.enabled ? 'On' : 'Off'} • ${sportsBoard.rotateSeconds}s/${sportsBoard.refreshSeconds}s`}
                </button>
                <button
                  type="button"
                  className="button-secondary ticker-action-button"
                  onClick={() => setShowLeagueCatalog((current) => !current)}
                >
                  {showLeagueCatalog
                    ? 'Hide league picker'
                    : `Add league${loadedLeagueCatalogCount ? ` (${loadedLeagueCatalogCount} loaded)` : ''}`}
                </button>
              </div>
            </div>

            {showBoardSettings ? (
              <div className="league-discovery-panel">
                <div className="league-discovery-header">
                  <h3>Board settings</h3>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => setShowBoardSettings(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="field-grid field-grid-3 compact-controls">
                  <label className="field field-checkbox">
                    <span>Board enabled</span>
                    <input type="checkbox" checked={sportsBoard.enabled} onChange={(event) => updateBoard('sports', { enabled: event.target.checked })} />
                  </label>
                  <label className="field">
                    <span>Rotate seconds</span>
                    <input type="number" value={sportsBoard.rotateSeconds} onChange={(event) => updateBoard('sports', { rotateSeconds: Number(event.target.value) })} />
                  </label>
                  <label className="field">
                    <span>Refresh seconds</span>
                    <input type="number" value={sportsBoard.refreshSeconds} onChange={(event) => updateBoard('sports', { refreshSeconds: Number(event.target.value) })} />
                  </label>
                </div>
              </div>
            ) : null}

            {showLeagueCatalog ? (
              <div className="league-discovery-panel">
                <div className="league-discovery-header">
                  <h3>Add league from ESPN catalog</h3>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button-secondary ticker-action-button"
                      onClick={() => loadLeagueCatalog(leagueCatalogSport)}
                      disabled={leagueCatalogState.loading}
                    >
                      {leagueCatalogState.loading ? 'Loading catalog...' : 'Load catalog'}
                    </button>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => {
                        setLeagueCatalog([])
                        setLeagueCatalogRegion('all')
                        setLeagueCatalogQuery('')
                      }}
                    >
                      Clear results
                    </button>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => setShowLeagueCatalog(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="field-grid field-grid-3">
                  <label className="field">
                    <span>Sport</span>
                    <select
                      value={leagueCatalogSport}
                      onChange={(event) => setLeagueCatalogSport(event.target.value)}
                    >
                      {LEAGUE_CATALOG_SPORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Region</span>
                    <select
                      value={leagueCatalogRegion}
                      onChange={(event) => setLeagueCatalogRegion(event.target.value)}
                    >
                      {LEAGUE_CATALOG_REGION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Search leagues</span>
                    <input
                      type="text"
                      placeholder="NFL, SEC, MLS, WNBA..."
                      value={leagueCatalogQuery}
                      onChange={(event) => setLeagueCatalogQuery(event.target.value)}
                    />
                  </label>
                </div>

                {loadedLeagueCatalogCount ? (
                  <div className="league-discovery-toolbar">
                    <span className="status-chip">{loadedLeagueCatalogCount} leagues loaded</span>
                  </div>
                ) : null}

                {leagueCatalogState.error ? <p className="field-error">{leagueCatalogState.error}</p> : null}

                {leagueCatalog.length ? (
                  <>
                    {noFilteredLeagueMatches ? (
                      <p className="field-help">
                        No leagues matched {selectedCatalogSportLabel}. ESPN may not currently expose discoverable leagues for this selection. Try All sports or adjust search terms.
                      </p>
                    ) : (
                      <>
                        <p className="field-help">
                          Showing {Math.min(filteredLeagueCatalog.length, 60)} of {filteredLeagueCatalog.length} matched leagues.
                        </p>
                        <div className="league-discovery-list">
                          {filteredLeagueCatalog.slice(0, 60).map((entry) => (
                            <div key={`${entry.sport}-${entry.league}`} className="league-discovery-item">
                              <div>
                                <p className="league-id">{entry.sportName}</p>
                                <p className="league-discovery-name">{entry.leagueName}</p>
                                <p className="league-discovery-meta">
                                  {entry.league}
                                  {entry.abbreviation ? ` • ${entry.abbreviation}` : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="button-link"
                                onClick={() => addLeagueFromCatalog(entry)}
                              >
                                Add
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="field-help">Load the catalog to browse addable leagues.</p>
                )}
              </div>
            ) : null}

            <div className="league-summary-grid">
              {sportsBoard.leagues.map((league, leagueIndex) => {
                const teams = leagueTeamsById[league.id] || []
                return (
                  <button
                    key={league.id}
                    type="button"
                    className="league-summary-card"
                    onClick={async () => {
                      setSelectedTickerLeagueId(league.id)
                      setSelectedTickerTeamId('')
                      if (!leagueTeamsById[league.id]) {
                        await loadLeagueTeams(league)
                      }
                      if (!leagueGroupsById[league.id]) {
                        await loadLeagueGroups(league)
                      }
                      if (!leagueTickerPreviewById[league.id]) {
                        await loadLeagueTickerPreview(league)
                      }
                      // Always refresh logo meta when opening a league so we pick up any new sync results
                      loadLeagueLogoMeta(league.id);
                    }}
                  >
                    <div className="league-order-controls" aria-label={`League order controls for ${league.name}`}>
                      <span className="league-order-label">Order #{leagueIndex + 1}</span>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="button-link"
                          disabled={leagueIndex === 0}
                          onClick={(event) => {
                            event.stopPropagation()
                            moveLeague(leagueIndex, -1)
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="button-link"
                          disabled={leagueIndex === sportsBoard.leagues.length - 1}
                          onClick={(event) => {
                            event.stopPropagation()
                            moveLeague(leagueIndex, 1)
                          }}
                        >
                          Down
                        </button>
                      </div>
                    </div>
                    <p className="league-id">{league.id}</p>
                    <h3>{league.name}</h3>
                    <p>{league.enabled ? 'Enabled' : 'Disabled'}</p>
                    <p>Teams loaded: {teams.length}</p>
                    <div className="league-logo-strip">
                      {teams.slice(0, 4).map((team) => {
                        // Prefer cached local logo for the league summary strip
                        const cached = getCachedOrRemoteLogo(league.id, team)
                        const primaryLogoHref = cached || resolveTeamPrimaryLogo(team, league.id)
                        return primaryLogoHref ? (
                          <img
                            key={`${league.id}-${team.id}`}
                            src={primaryLogoHref}
                            alt={team.abbreviation || team.name}
                          />
                        ) : null
                      })}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : !selectedTickerTeam ? (
          <>
            <div className="league-hero">
              <div className="league-hero-main">
                <p className="section-kicker">Ticker</p>
                <h2>{selectedTickerLeague.name}</h2>
                <p className="league-hero-meta">
                  {selectedLeagueTeams.length} teams loaded
                </p>
              </div>
              <div className="league-hero-actions">
                <button type="button" className="button-secondary" onClick={() => setSelectedTickerLeagueId('')}>
                  Back to leagues
                </button>
              </div>
            </div>

            {selectedTickerLeagueIndex >= 0 ? (
              <div className="league-settings-panel">
                <h3>League settings</h3>

                {/* Card Style - placed right below "League settings" and above the toggles/feed sections */}
                <label className="field" style={{ marginBottom: '12px' }}>
                  <span>Card style</span>
                  <select
                    value={selectedTickerLeague.cardStyle || 'standard'}
                    onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'cardStyle', event.target.value)}
                  >
                    <option value="standard">Standard</option>
                    <option value="large-logo">Large Logo</option>
                  </select>
                  <small className="field-help">
                    Visual preset for how this league's games appear in the ticker.
                  </small>
                </label>

                <div className="league-settings-layout">
                  <div className="league-checkbox-group">
                    <p className="league-checkbox-title">Card and Feed Toggles</p>
                    <div className="league-checkbox-grid">
                      <label className="field field-checkbox">
                        <span>League enabled</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.enabled}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'enabled', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Show TV</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.showTV}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showTV', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Show odds</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.showOdds}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showOdds', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Show location</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.showNews)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showNews', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Live game mode</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.liveGameMode)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'liveGameMode', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Use team card colors</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.useTeamCardColors)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'useTeamCardColors', event.target.checked)}
                        />
                      </label>

                      <label className="field field-checkbox">
                        <span>Card stat: team records</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.showStatRecords !== false}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatRecords', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Card stat: game clock/period</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.showStatClock !== false}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatClock', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Card stat: situation detail</span>
                        <input
                          type="checkbox"
                          checked={selectedTickerLeague.showStatSituation !== false}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatSituation', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Card stat: venue detail</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.showStatVenue)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatVenue', event.target.checked)}
                        />
                      </label>
                      <label className="field field-checkbox">
                        <span>Card stat: odds detail</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.showStatOdds)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatOdds', event.target.checked)}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Feed Filter - revives the powerful server-side filtering the backend already supports */}
                <div className="league-feed-filter">
                  <p className="league-checkbox-title">Feed Filter (server-side)</p>
                  <div className="league-filter-controls">
                    <label className="field">
                      <span>Game filter</span>
                      <select
                        value={selectedTickerLeague.gameFilter || 'all'}
                        onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'gameFilter', event.target.value)}
                      >
                        <option value="all">All (no filter)</option>
                        <option value="live">Live only</option>
                        <option value="today">Today</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="this-week">This week (football)</option>
                      </select>
                      <small className="field-help">
                        Filters at the ESPN API level for smaller, faster responses (especially useful for NFL / college football).
                        This only affects which games are fetched — it does not enable the enhanced live card visuals (those come from "Live game mode").
                      </small>
                    </label>

                    <label className="field field-checkbox" style={{ marginTop: 8 }}>
                      <span>Fallback if empty</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedTickerLeague.fallbackWhenEmpty)}
                        onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'fallbackWhenEmpty', event.target.checked)}
                      />
                      <small className="field-help" style={{ marginLeft: 8 }}>
                        If the strict filter returns no games, automatically broaden results (e.g. show upcoming) so the ticker stays useful instead of going blank.
                      </small>
                    </label>
                  </div>
                </div>

                <div className="league-groups-panel">
                  <div className="league-groups-header">
                    <p className="league-checkbox-title">Conference / Division / Group Filter</p>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => loadLeagueGroups(selectedTickerLeague)}
                      disabled={selectedLeagueGroupsLoadState.loading}
                    >
                      {selectedLeagueGroupsLoadState.loading ? 'Refreshing...' : 'Refresh groups'}
                    </button>
                  </div>

                  {selectedLeagueGroupsLoadState.error ? (
                    <p className="field-error">{selectedLeagueGroupsLoadState.error}</p>
                  ) : null}

                  {selectedLeagueGroups.length ? (
                    <div className="league-groups-grid">
                      {selectedLeagueGroups.map((group) => {
                        const id = String(group.id || '').trim()
                        if (!id) {
                          return null
                        }

                        const includedGroupIds = Array.isArray(selectedTickerLeague.includedGroups)
                          ? selectedTickerLeague.includedGroups
                          : []
                        const isChecked = includedGroupIds.includes(id)
                        const parentName = group.parent?.name ? ` (${group.parent.name})` : ''
                        const label = group.name || group.abbreviation || id

                        return (
                          <label key={`${selectedTickerLeague.id}-${id}`} className="field field-checkbox">
                            <span>{label}{parentName}</span>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(event) =>
                                toggleLeagueIncludedGroup(
                                  selectedTickerLeagueIndex,
                                  id,
                                  event.target.checked,
                                )
                              }
                            />
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="field-help">No group metadata returned for this league.</p>
                  )}
                </div>

                <div className="league-groups-panel">
                  <div className="league-groups-header">
                    <p className="league-checkbox-title">Ticker filter preview</p>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => loadLeagueTickerPreview(selectedTickerLeague)}
                      disabled={selectedLeagueTickerPreviewLoadState.loading}
                    >
                      {selectedLeagueTickerPreviewLoadState.loading ? 'Refreshing...' : 'Refresh preview'}
                    </button>
                  </div>
                  {selectedLeagueTickerPreviewLoadState.error ? (
                    <p className="field-error">{selectedLeagueTickerPreviewLoadState.error}</p>
                  ) : null}
                  {selectedLeagueTickerPreview ? (
                    <>
                      <p className="field-help">
                        Showing {selectedLeagueTickerPreview.eventCount} of {selectedLeagueTickerPreview.rawEventCount || selectedLeagueTickerPreview.eventCount} events after filters.
                        {selectedLeagueTickerPreview.appliedFilters?.gameFilter && selectedLeagueTickerPreview.appliedFilters.gameFilter !== 'all' && (
                          <> (filter: {selectedLeagueTickerPreview.appliedFilters.gameFilter})</>
                        )}
                      </p>
                      {selectedLeaguePreviewMatchups.length ? (
                        <p className="field-help">
                          Matchups: {selectedLeaguePreviewMatchupsText}
                          {selectedLeaguePreviewMatchups.length > 8
                            ? `, +${selectedLeaguePreviewMatchups.length - 8} more`
                            : ''}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="field-help">Load preview to verify week/team/group filters for this league.</p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="team-explorer-heading">
              <div>
                <h3 style={{ margin: 0 }}>{getLeagueEntityType(selectedTickerLeague).label}</h3>
                <p className="team-explorer-subtitle">
                  Select {getLeagueEntityType(selectedTickerLeague).label.toLowerCase()} to include and open details
                  {isIndividualSport(parseLeagueApiParams(selectedTickerLeague?.url || '').sport, parseLeagueApiParams(selectedTickerLeague?.url || '').league) ? ' (driver list is best-effort for now)' : ''}
                </p>
              </div>

              <button
                type="button"
                className="button-link"
                onClick={async () => {
                  await loadLeagueTeams(selectedTickerLeague);
                  let teams = leagueTeamsById[selectedTickerLeague.id] || [];

                  const params = parseLeagueApiParams(selectedTickerLeague.url || '');
                  const isRacingOrIndividual = isIndividualSport(params.sport, params.league);

                  // For racing leagues (NASCAR, F1, etc.), always try the dedicated racing harvester
                  // even if the normal load returned nothing.
                  if (isRacingOrIndividual) {
                    setLogoSyncingLeagues((prev) => ({
                      ...prev,
                      [selectedTickerLeague.id]: 'Harvesting drivers from scoreboard…'
                    }));

                    // Give immediate feedback
                    setNotice(`Syncing ${selectedTickerLeague.name} — harvesting drivers/teams...`);

                    try {
                      const racingEntities = await harvestRacingEntities(selectedTickerLeague);
                      if (racingEntities.length > 0) {
                        const byId = new Map(teams.map((t) => [String(t.id), t]));
                        for (const ent of racingEntities) {
                          const key = String(ent.id);
                          if (!byId.has(key)) {
                            byId.set(key, ent);
                          }
                        }
                        teams = Array.from(byId.values());
                      }
                    } catch (e) {
                      console.warn('Extra harvestRacingEntities during sync failed', e);
                    }

                    // Clear the harvesting message
                    setLogoSyncingLeagues((prev) => {
                      const copy = { ...prev };
                      if (copy[selectedTickerLeague.id] && typeof copy[selectedTickerLeague.id] === 'string' && copy[selectedTickerLeague.id].includes('Harvesting')) {
                        delete copy[selectedTickerLeague.id];
                      }
                      return copy;
                    });
                  }

                  if (teams.length > 0) {
                    const isFootball = params.sport === 'football';

                    if (isFootball || isRacingOrIndividual) {
                      // Enrichment still runs for football/racing to get better primary logo URLs + colors
                      // from the detailed ESPN core endpoint before the logo download step.
                      setLogoSyncingLeagues((prev) => ({
                        ...prev,
                        [selectedTickerLeague.id]: 'Enriching logos for drivers/teams…'
                      }));

                      teams = await enrichTeamsForLogoSync(selectedTickerLeague, teams);

                      // Clear the temporary enrichment message (the cache trigger will set its own)
                      setLogoSyncingLeagues((prev) => {
                        const copy = { ...prev };
                        if (copy[selectedTickerLeague.id] && typeof copy[selectedTickerLeague.id] === 'string' && copy[selectedTickerLeague.id].includes('Enriching')) {
                          delete copy[selectedTickerLeague.id];
                        }
                        return copy;
                      });
                    }

                    triggerLogoCacheForLeague(selectedTickerLeague.id, teams).catch((err) => {
                      console.warn('Logo cache failed:', err);
                    });

                    // For racing leagues, always reload meta after sync so any newly downloaded logos appear immediately
                    if (isRacingOrIndividual) {
                      setTimeout(() => {
                        loadLeagueLogoMeta(selectedTickerLeague.id);
                      }, 300);
                    }
                  } else {
                    if (isRacingOrIndividual) {
                      setNotice(`Sync for ${selectedTickerLeague.name} didn't find many drivers right now (common for NASCAR etc. depending on season/events). The live ticker still works. A better driver roster pull is planned for later.`);
                    } else {
                      setNotice(`Sync found no teams/drivers for ${selectedTickerLeague.name}. Try loading preview first or check the league URL.`);
                    }
                  }
                }}
                disabled={selectedLeagueLoadState.loading}
              >
                {selectedLeagueLoadState.loading ? 'Syncing...' : 'Sync Teams & Logos'}
              </button>

              <button
                type="button"
                className="button-link"
                onClick={async () => {
                  const leagueId = selectedTickerLeague.id;
                  const leagueName = selectedTickerLeague.name;
                  try {
                    await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, { method: 'DELETE' });
                    setNotice(`Cleared cached logos for ${leagueName} (folder deleted from disk).`);
                  } catch (e) {
                    // still clear local even if server had issues
                  }

                  // Local prominent confirmation that the folder was nuked
                  setLogoClearMessageById((prev) => ({
                    ...prev,
                    [leagueId]: `Cache cleared — logos folder + meta deleted from disk.`,
                  }));

                  // Auto-dismiss the local message after a few seconds
                  setTimeout(() => {
                    setLogoClearMessageById((prev) => {
                      const next = { ...prev };
                      delete next[leagueId];
                      return next;
                    });
                  }, 4500);

                  setLeagueLogoMetaById((current) => {
                    const copy = { ...current };
                    delete copy[leagueId];
                    return copy;
                  });
                }}
              >
                Clear Cached Logos
              </button>
            </div>

            {logoClearMessageById[selectedTickerLeague.id] && (
              <p style={{ color: '#4ade80', fontSize: '0.85em', margin: '4px 0 6px', fontWeight: 500 }}>
                {logoClearMessageById[selectedTickerLeague.id]}
              </p>
            )}

            {selectedLeagueLoadState.loading ? <p>Loading team data from ESPN...</p> : null}
            {selectedLeagueLoadState.error ? <p className="field-error">{selectedLeagueLoadState.error}</p> : null}

            {logoSyncingLeagues[selectedTickerLeague.id] && (
              <p style={{ color: '#666', fontStyle: 'italic' }}>
                {typeof logoSyncingLeagues[selectedTickerLeague.id] === 'string'
                  ? logoSyncingLeagues[selectedTickerLeague.id]
                  : 'Downloading logo variants… (large leagues like NCAA can take a couple minutes)'}
              </p>
            )}

            <div className="team-logo-grid">
              {selectedLeagueTeams.map((team) => {
                // Prefer locally cached logo when available
                const cachedLogo = getCachedOrRemoteLogo(selectedTickerLeague.id, team);
                const primaryLogoHref = cachedLogo || resolveTeamPrimaryLogo(team, selectedTickerLeague.id)
                const includedTeamIds = Array.isArray(selectedTickerLeague.includedTeams)
                  ? selectedTickerLeague.includedTeams
                  : []
                const isIncluded = includedTeamIds.includes(String(team.id))
                return (
                  <div
                    key={`${selectedTickerLeague.id}-${team.id}`}
                    className="team-logo-card"
                    onClick={() => {
                      setSelectedTickerTeamId(team.id)
                      const teamCacheKey = `${selectedTickerLeague.id}:${team.id}`
                      // Always (re)load the live ESPN team logo data when selecting a team.
                      // This ensures the "Download extra logos" button is available even after
                      // clearing cache or re-syncing.
                      loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                      loadLeagueLogoMeta(selectedTickerLeague.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedTickerTeamId(team.id)
                        const teamCacheKey = `${selectedTickerLeague.id}:${team.id}`
                        loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {primaryLogoHref ? (
                      <img src={primaryLogoHref} alt={team.abbreviation || team.name} />
                    ) : (
                      <div className="team-logo-fallback">No logo</div>
                    )}
                    <p>{team.name}</p>
                    <label className="field field-checkbox">
                      <span>Include in ticker</span>
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={(event) => {
                          event.stopPropagation()
                          toggleLeagueIncludedTeam(
                            selectedTickerLeagueIndex,
                            String(team.id),
                            event.target.checked,
                          )
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Team</p>
                <h2>{selectedTickerTeam.name}</h2>
                <p className="section-note">ESPN team info and logo variants.</p>
              </div>
              <button type="button" className="button-secondary" onClick={() => setSelectedTickerTeamId('')}>
                Back to {selectedTickerLeague.name}
              </button>
            </div>

            <div className="team-details-grid">
              <div className="team-meta-card">
                <h3>Team snapshot</h3>
                <div className="team-meta-grid">
                  <p><strong>League</strong><span>{selectedTickerLeague.name}</span></p>
                  <p><strong>Group</strong><span>{selectedTeamProfile?.group?.name || selectedTeamProfile?.standings?.group?.name || 'N/A'}</span></p>
                  <p><strong>Abbreviation</strong><span>{selectedTickerTeam.abbreviation || 'N/A'}</span></p>
                  <p><strong>Nickname</strong><span>{selectedTeamProfile?.nickname || 'N/A'}</span></p>
                  <p><strong>Location</strong><span>{selectedTickerTeam.location || 'N/A'}</span></p>
                  <p><strong>Slug</strong><span>{selectedTeamProfile?.slug || 'N/A'}</span></p>
                </div>

                <h3>Team colors (from cache)</h3>
                <div className="team-meta-grid">
                  <p><strong>Primary color</strong><span>{selectedTeamStyle?.color || selectedTickerTeam?.color || 'N/A'}</span></p>
                  <p><strong>Alternate color</strong><span>{selectedTeamStyle?.alternate_color || selectedTickerTeam?.alternateColor || 'N/A'}</span></p>
                </div>
                {/* Color editing removed — official team colors are now authoritative and come from the cache.
                    Users can no longer override them. */}

                <h3>Standings</h3>
                <div className="team-meta-grid">
                  <p><strong>Overall</strong><span>{selectedTeamProfile?.recordSummary || selectedTeamStandingsStats.overall || 'N/A'}</span></p>
                  <p><strong>Win %</strong><span>{selectedTeamStandingsStats.winPercent || 'N/A'}</span></p>
                  <p><strong>Division</strong><span>{selectedTeamStandingsStats.divisionRecord || 'N/A'}</span></p>
                  <p><strong>Conference</strong><span>{selectedTeamStandingsStats.conferenceRecord || 'N/A'}</span></p>
                  <p><strong>Home</strong><span>{selectedTeamStandingsStats.homeRecord || 'N/A'}</span></p>
                  <p><strong>Away</strong><span>{selectedTeamStandingsStats.awayRecord || 'N/A'}</span></p>
                  <p><strong>Streak</strong><span>{selectedTeamStandingsStats.streak || 'N/A'}</span></p>
                  <p><strong>Point diff</strong><span>{selectedTeamStandingsStats.pointDifferential || 'N/A'}</span></p>
                </div>

                <h3>Venue</h3>
                <div className="team-meta-grid">
                  <p><strong>Name</strong><span>{selectedTeamProfile?.venue?.name || 'N/A'}</span></p>
                  <p><strong>Location</strong><span>{selectedTeamVenueLocation || 'N/A'}</span></p>
                  <p><strong>Indoor</strong><span>{selectedTeamProfile?.venue?.indoor === true ? 'Yes' : selectedTeamProfile?.venue?.indoor === false ? 'No' : 'N/A'}</span></p>
                  <p><strong>Grass</strong><span>{selectedTeamProfile?.venue?.grass === true ? 'Yes' : selectedTeamProfile?.venue?.grass === false ? 'No' : 'N/A'}</span></p>
                </div>
              </div>

              {/* Right column - logo management for this team */}
              <div>
                {/* Download full logo set button - placed near the top as requested */}
                {selectedTickerTeam && (
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ marginBottom: 4 }}>More logo variants from ESPN</h3>
                    <p className="team-explorer-subtitle" style={{ marginBottom: 8 }}>
                      The full set of logo variants is available from ESPN. Download them for this team only.
                    </p>

                    {logoSyncingLeagues[selectedTickerLeague.id] &&
                    typeof logoSyncingLeagues[selectedTickerLeague.id] === 'string' &&
                    logoSyncingLeagues[selectedTickerLeague.id].includes('extra') ? (
                      <p style={{ color: '#666', fontStyle: 'italic' }}>
                        {logoSyncingLeagues[selectedTickerLeague.id]}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => downloadExtrasForTeam(selectedTickerLeague, selectedTickerTeam)}
                      >
                        Download all logo variants for this team
                      </button>
                    )}
                  </div>
                )}

                {cachedVariants.length > 0 ? (
                  <>
                    <h3>
                      Local Cached Logos
                      <button
                        type="button"
                        className="button-link"
                        style={{ marginLeft: '12px', fontSize: '0.75em' }}
                        onClick={() => loadLeagueLogoMeta(selectedTickerLeague.id)}
                      >
                        Refresh
                      </button>
                    </h3>
                    <p className="team-explorer-subtitle">
                      These are the logos downloaded locally for this team. Click one to use it as the preferred variant in the ticker.
                    </p>
                    <div className="team-logo-variants">
                      {cachedVariants.map(({ variant, href }) => {
                        const isPreferred = cachedTeamMeta?.preferred_variant === variant;
                        return (
                          <div
                            key={variant}
                            className="team-logo-variant"
                            onClick={() => {
                              fetch(`/api/v1/logos/meta/${selectedTickerLeague.id}/override/${selectedTickerTeam.id}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ variant }),
                              })
                                .then(() => loadLeagueLogoMeta(selectedTickerLeague.id))
                                .catch(() => {});
                            }}
                            style={{ cursor: 'pointer', border: isPreferred ? '2px solid var(--accent)' : '1px solid #444' }}
                          >
                            <img src={href} alt={variant} />
                            <p>{variant}{isPreferred ? ' ★' : ''}</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="team-explorer-subtitle">
                    {logoSyncingLeagues[selectedTickerLeague.id]
                      ? 'Logos are still downloading for this league…'
                      : `No locally cached logos yet for this ${getLeagueEntityType(selectedTickerLeague).singular.toLowerCase()}.`}
                    <br />
                    Use "Sync Teams &amp; Logos" above to download logos.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </article>
    ) : (
      <article className="card page-card">
        <p>No sports board found in config.</p>
      </article>
    )
  }

  return (
    <main className={`app-shell ${themeTokens.modeClass}`} style={shellStyle}>
      <div className="page-shell">
        <header className="topbar">
          <div className="topbar-brand">
            <img
              src="/pibarticker-logo-transparent.png"
              alt="PiBarTicker"
              className="topbar-logo"
            />
          </div>
          <div className="topbar-actions">
            <a className="button-secondary" href="/">
              Open ticker
            </a>
            <button
              type="button"
              className="button-primary"
              onClick={() => saveConfig({ continueToNextPage: false, setupReady, firstSetupError, hasUnsavedChanges })}
              disabled={!setupReady || isPending || !hasUnsavedChanges}
              title={!setupReady ? firstSetupError : ''}
            >
              {isPending ? 'Saving...' : 'Save changes'}
            </button>
            <button type="button" className="button-secondary" onClick={resetConfig}>
              Reset
            </button>
          </div>
        </header>

        <div className="status-bar" aria-live="polite">
          <span className={`status-item ${setupReady ? 'is-good' : 'is-incomplete'}`}>
            Setup {completedSetupSections}/{sectionChecks.length} complete
          </span>
          <span className="status-sep">•</span>
          <span className={`status-item ${hasUnsavedChanges ? 'is-dirty' : 'is-clean'}`}>
            {hasUnsavedChanges ? `${dirtyPageIds.length} unsaved` : 'All saved'}
          </span>

          {notice && (
            <>
              <span className="status-sep">•</span>
              <span className="status-item is-notice">{notice}</span>
            </>
          )}
          {error && (
            <>
              <span className="status-sep">•</span>
              <span className="status-item is-error">{error}</span>
            </>
          )}
        </div>

        <div className="workspace">
          <aside className="card setup-nav">
            <p className="section-kicker">Setup pages</p>
            <h2>Configuration</h2>
            <nav className="nav-list" aria-label="Setup sections">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`nav-link ${activePage === page.id ? 'active' : ''}`}
                  onClick={() => setActivePage(page.id)}
                >
                  <span>{page.label}</span>
                  {dirtySections[page.id] ? <span className="dirty-dot" aria-hidden="true" /> : null}
                </button>
              ))}
            </nav>
            <p className="sidebar-note">Edit one section at a time, then save.</p>

            <div className="system-info">
              <div>{config.monitor.width}×{config.monitor.height} • {enabledLeagues.length} leagues • {config.theme.mode}</div>
              <div className="api-status">API connected</div>
            </div>
          </aside>

          <section className="content-pane" aria-label="Setup controls">
            {renderPage()}
          </section>
        </div>
      </div>
    </main>
  )
  }

export default App
