import { useEffect } from 'react'
import './App.css'
import { DARK_PRESET, deriveThemeTokens, LIGHT_PRESET } from './themeTokens'
import TickerRuntime from './ticker/TickerRuntime'
import { useAppContext, parseLeagueApiParams, isIndividualSport } from './AppContext'
import { computeSectionChecks } from './setup/helpers'
import OverviewPage from './setup/OverviewPage'
import DisplayPage from './setup/DisplayPage'
import ServicesPage from './setup/ServicesPage'
import ThemePage from './setup/ThemePage'
import TickerPage from './setup/TickerPage'

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

  const enabledLeagues = sportsBoard?.leagues.filter((league) => league.enabled) ?? []
  const pages = [
    { id: 'overview', label: 'Overview' },
    { id: 'display', label: 'Display' },
    { id: 'theme', label: 'Theme' },
    { id: 'services', label: 'Services' },
    { id: 'ticker', label: 'Ticker' },
  ]

  const sectionChecks = computeSectionChecks(config)
  const completedSetupSections = sectionChecks.filter((check) => check.complete).length
  const setupReady = completedSetupSections === sectionChecks.length
  const firstSetupError = sectionChecks.find((check) => !check.complete)?.errors[0] || ''
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
    if (activePage === 'overview') return <OverviewPage />
    if (activePage === 'display') return <DisplayPage />
    if (activePage === 'theme') return <ThemePage />
    if (activePage === 'services') return <ServicesPage />
    return <TickerPage />
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
