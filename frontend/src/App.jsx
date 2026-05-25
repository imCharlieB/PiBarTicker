import { useEffect, useRef, useState, useTransition } from 'react'
import './App.css'
import { DARK_PRESET, deriveThemeTokens, LIGHT_PRESET } from './themeTokens'

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

function normalizeTeamDataFromScoreboard(payload) {
  const teams = new Map()

  const events = Array.isArray(payload?.events) ? payload.events : []

  for (const event of events) {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : []

    for (const competition of competitions) {
      const competitors = Array.isArray(competition?.competitors)
        ? competition.competitors
        : []

      for (const competitor of competitors) {
        const team = competitor?.team || {}
        if (!team.id) {
          continue
        }

        const incomingLogos = Array.isArray(team.logos)
          ? team.logos
          : team.logo
            ? [{ href: team.logo, alt: team.displayName || team.name || team.abbreviation }]
            : []

        const existing = teams.get(team.id)
        if (existing) {
          const knownHrefs = new Set(existing.logos.map((logo) => logo.href))
          const mergedLogos = [
            ...existing.logos,
            ...incomingLogos.filter((logo) => logo?.href && !knownHrefs.has(logo.href)),
          ]
          teams.set(team.id, { ...existing, logos: mergedLogos })
          continue
        }

        teams.set(team.id, {
          id: team.id,
          name: team.displayName || team.shortDisplayName || team.name || team.abbreviation,
          shortName: team.shortDisplayName || team.abbreviation || team.name,
          abbreviation: team.abbreviation || '',
          location: team.location || '',
          color: team.color || '',
          alternateColor: team.alternateColor || '',
          logos: incomingLogos.filter((logo) => logo?.href),
        })
      }
    }
  }

  return Array.from(teams.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function selectTrustedTeamLogos(team, leagueId) {
  const rawLogos = Array.isArray(team?.logos)
    ? team.logos.filter((logo) => logo?.href)
    : team?.logo
      ? [{ href: team.logo, alt: team.displayName || team.name || team.abbreviation }]
      : []

  if (!rawLogos.length) {
    return {
      primary: [],
      extras: [],
    }
  }

  // ESPN's GUID-based logo variants are sometimes cross-team for NFL; prefer canonical teamlogos assets only there.
  const leagueToken = String(leagueId || '').trim().toLowerCase()
  if (leagueToken !== 'nfl') {
    return {
      primary: rawLogos,
      extras: [],
    }
  }

  const canonical = rawLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: canonical.length ? canonical : rawLogos,
    extras: canonical.length
      ? rawLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

function splitTeamLogosForDisplay(logos, leagueId) {
  const safeLogos = Array.isArray(logos) ? logos.filter((logo) => logo?.href) : []
  const leagueToken = String(leagueId || '').trim().toLowerCase()

  if (leagueToken !== 'nfl') {
    return {
      primary: safeLogos,
      extras: [],
    }
  }

  const primary = safeLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: primary.length ? primary : safeLogos,
    extras: primary.length
      ? safeLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

function parseLeagueApiParams(scoreboardUrl) {
  const match = String(scoreboardUrl || '').match(/\/sports\/([^/]+)\/([^/]+)\/scoreboard/i)
  if (!match) {
    return { sport: 'football', league: '' }
  }

  return {
    sport: match[1],
    league: match[2],
  }
}

function normalizeTeamDataFromTeamsEndpoint(payload) {
  const teams = []
  const league = payload?.sports?.[0]?.leagues?.[0]
  const leagueTeams = league?.teams || []
  const leagueId = league?.abbreviation || league?.id || ''

  for (const entry of leagueTeams) {
    const team = entry?.team
    if (!team?.id) {
      continue
    }

    const trustedLogos = selectTrustedTeamLogos(team, leagueId)

    teams.push({
      id: team.id,
      name: team.displayName || team.shortDisplayName || team.name || team.abbreviation,
      shortName: team.shortDisplayName || team.abbreviation || team.name,
      abbreviation: team.abbreviation || '',
      location: team.location || '',
      color: team.color || '',
      alternateColor: team.alternateColor || '',
      logos: trustedLogos.primary,
      extraLogos: trustedLogos.extras,
    })
  }

  return teams.sort((a, b) => a.name.localeCompare(b.name))
}

function toLeagueTeamsEndpoint(scoreboardUrl) {
  if (!scoreboardUrl) {
    return ''
  }

  try {
    const parsed = new URL(scoreboardUrl)
    parsed.pathname = parsed.pathname.replace(/\/scoreboard$/i, '/teams')
    // College leagues can have hundreds of teams; request a large page size.
    parsed.searchParams.set('limit', '1000')
    return parsed.toString()
  } catch {
    const base = scoreboardUrl.replace(/\/scoreboard(?:\?.*)?$/i, '/teams')
    return `${base}${base.includes('?') ? '&' : '?'}limit=1000`
  }
}

function buildEspnProxyUrl(targetUrl, cacheTtlSeconds = 120) {
  const params = new URLSearchParams({
    url: targetUrl,
    cache_ttl_seconds: String(cacheTtlSeconds),
  })

  return `/api/v1/espn/proxy?${params.toString()}`
}

function buildTickerScoreboardQuery(league, { cacheTtlSeconds = 60 } = {}) {
  const params = parseLeagueApiParams(league?.url || '')
  const resolvedLeague = String(params.league || league?.id || '').trim()
  const resolvedSport = String(params.sport || '').trim()
  const query = new URLSearchParams({
    league: resolvedLeague,
    cache_ttl_seconds: String(cacheTtlSeconds),
  })

  if (resolvedSport) {
    query.set('sport', resolvedSport)
  }

  if (params.sport) {
    query.set('sport', params.sport)
  }

  const includedTeams = Array.isArray(league?.includedTeams) ? league.includedTeams : []
  if (includedTeams.length) {
    query.set('included_teams', includedTeams.join(','))
  }

  const includedGroups = Array.isArray(league?.includedGroups) ? league.includedGroups : []
  if (includedGroups.length) {
    query.set('included_groups', includedGroups.join(','))
  }

  return query.toString()
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

const API_NATIVE_SPORT_FILTERS = new Set([
  'football',
  'basketball',
  'baseball',
  'hockey',
  'soccer',
  'golf',
  'tennis',
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
      || /f1|formula\s*1|nascar|indycar|motogp|rally|racing/.test(haystack)
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

function buildRuntimeDetailStats({ rawEvent, game, league, baseballSituationText, venueText, hasBaseballLivePanel = false }) {
  const stats = []
  const state = String(game?.state || '').toLowerCase()
  const showLiveState = leagueStatToggleEnabled(league, 'showLiveState', false)

  if (showLiveState && leagueStatToggleEnabled(league, 'showStatClock', true)) {
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

  if (showLiveState && leagueStatToggleEnabled(league, 'showStatSituation', true)) {
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

function teamRecordText(team) {
  const record = String(team?.record || '').trim()
  return record || ''
}

function runtimeTeamName(team) {
  if (!team) {
    return 'TBD'
  }

  return team.abbreviation || team.name || team.slug || 'TBD'
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

function cssToken(value, fallback = 'unknown') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return token || fallback
}

function isRacingGame(game) {
  return String(game?.sport || '').toLowerCase() === 'racing'
}

function racingCardTitle(game, league) {
  const explicitTitle = String(game?.title || '').trim()
  if (explicitTitle) {
    return explicitTitle
  }

  return String(league?.name || 'Race').trim()
}

function racingEntrySummary(entry) {
  const statItems = Array.isArray(entry?.stats) ? entry.stats : []
  const summary = statItems
    .slice(0, 2)
    .map((item) => {
      const label = String(item?.label || '').trim()
      const value = String(item?.value || '').trim()
      if (!value) {
        return ''
      }
      return label ? `${label} ${value}` : value
    })
    .filter(Boolean)

  if (summary.length) {
    return summary.join(' • ')
  }

  const score = String(entry?.score || '').trim()
  return score || ''
}

function racingHasTelemetry(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return false
  }

  return entries.some((entry) => {
    const score = String(entry?.score || '').trim()
    if (score) {
      return true
    }

    const statItems = Array.isArray(entry?.stats) ? entry.stats : []
    return statItems.some((item) => String(item?.value || '').trim())
  })
}

function racingTelemetryFallback(game, entries) {
  const parts = ['Running Order']
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) {
    parts.push(`Lap ${lap}`)
  }

  const leader = entries?.[0]
  const leaderName = String(leader?.shortName || leader?.name || '').trim()
  if (leaderName) {
    parts.push(`Leader ${leaderName}`)
  }

  return parts.join(' • ')
}

function racingLiveHeader(game) {
  const detail = String(game?.liveState?.detail || game?.status?.detail || game?.status?.shortDetail || '').trim()
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) {
    return detail ? `Lap ${lap} • ${detail}` : `Lap ${lap}`
  }
  if (detail) {
    return detail
  }

  return 'Race in progress'
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

function resolveLeagueLogo(league, payload) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) {
    return explicitLogo
  }

  const payloadLogo = String(payload?.scoreboard?.leagues?.[0]?.logos?.[0]?.href || '').trim()
  if (payloadLogo) {
    return payloadLogo
  }

  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) {
    return ''
  }

  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
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

  return {
    outs,
    balls,
    strikes,
    onFirst: Boolean(situation?.onFirst),
    onSecond: Boolean(situation?.onSecond),
    onThird: Boolean(situation?.onThird),
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

function teamRowStyle(team) {
  const primary = sanitizeHexColor(team?.palette?.primary || team?.color)
  if (!primary) {
    return undefined
  }

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

function runtimeCardStyle(game, useTeamCardColors = false) {
  if (game?.isRacing || !useTeamCardColors) {
    return undefined
  }

  const homePrimary = sanitizeHexColor(game?.teams?.home?.palette?.primary || game?.teams?.home?.color)
  if (!homePrimary) {
    return undefined
  }

  return {
    '--card-accent': homePrimary,
    '--card-accent-soft': rgbaFromHex(homePrimary, 0.24),
    '--card-accent-glow': rgbaFromHex(homePrimary, 0.34),
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

  if (firstUnknown >= 0) {
    return firstUnknown
  }

  if (firstWithGames >= 0) {
    return firstWithGames
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

  const [config, setConfig] = useState(null)
  const [savedConfig, setSavedConfig] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [activePage, setActivePage] = useState('overview')
  const [selectedTickerLeagueId, setSelectedTickerLeagueId] = useState('')
  const [selectedTickerTeamId, setSelectedTickerTeamId] = useState('')
  const [leagueTeamsById, setLeagueTeamsById] = useState({})
  const [leagueLoadStateById, setLeagueLoadStateById] = useState({})
  const [leagueGroupsById, setLeagueGroupsById] = useState({})
  const [leagueGroupsLoadStateById, setLeagueGroupsLoadStateById] = useState({})
  const [teamLogoDetailsByKey, setTeamLogoDetailsByKey] = useState({})
  const [teamLogoLoadStateByKey, setTeamLogoLoadStateByKey] = useState({})
  const [leagueTickerPreviewById, setLeagueTickerPreviewById] = useState({})
  const [leagueTickerPreviewLoadStateById, setLeagueTickerPreviewLoadStateById] = useState({})
  const [leagueCatalog, setLeagueCatalog] = useState([])
  const [leagueCatalogSport, setLeagueCatalogSport] = useState('all')
  const [leagueCatalogRegion, setLeagueCatalogRegion] = useState('all')
  const [leagueCatalogQuery, setLeagueCatalogQuery] = useState('')
  const [leagueCatalogState, setLeagueCatalogState] = useState({ loading: false, error: '' })
  const [showLeagueCatalog, setShowLeagueCatalog] = useState(false)
  const [showBoardSettings, setShowBoardSettings] = useState(false)
  const [runtimeLeagueIndex, setRuntimeLeagueIndex] = useState(0)
  const [runtimeVisibleLeagueId, setRuntimeVisibleLeagueId] = useState('')
  const [runtimePayloadByLeagueId, setRuntimePayloadByLeagueId] = useState({})
  const [runtimeLoadStateByLeagueId, setRuntimeLoadStateByLeagueId] = useState({})
  const [runtimeScrollSeconds, setRuntimeScrollSeconds] = useState(45)
  const [runtimeTrackWidth, setRuntimeTrackWidth] = useState(0)
  const [runtimeWindowWidth, setRuntimeWindowWidth] = useState(0)
  const [runtimeLastStableLeagueId, setRuntimeLastStableLeagueId] = useState('')
  const [runtimeLastStableMarqueeGames, setRuntimeLastStableMarqueeGames] = useState([])
  const runtimePayloadRef = useRef(runtimePayloadByLeagueId)
  const runtimeLoadStateRef = useRef(runtimeLoadStateByLeagueId)
  const configRef = useRef(null)
  const runtimeMarqueeTrackRef = useRef(null)
  const runtimeMarqueeWindowRef = useRef(null)

  useEffect(() => {
    runtimePayloadRef.current = runtimePayloadByLeagueId
  }, [runtimePayloadByLeagueId])

  useEffect(() => {
    runtimeLoadStateRef.current = runtimeLoadStateByLeagueId
  }, [runtimeLoadStateByLeagueId])

  useEffect(() => {
    configRef.current = config
  }, [config])

  function commitConfig(updateFn) {
    setConfig((current) => {
      const nextConfig = updateFn(current)
      configRef.current = nextConfig
      return nextConfig
    })
  }

  useEffect(() => {
    async function loadConfig() {
      try {
        setError('')
        const response = await fetch('/api/v1/config')

        if (!response.ok) {
          throw new Error(`Config request failed with ${response.status}`)
        }

        const payload = await response.json()
        setConfig(payload)
        setSavedConfig(payload)
        configRef.current = payload
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [])

  const sportsBoard = config?.boards.find((board) => board.type === 'sports')
  const homeAssistantBoard = config?.boards.find(
    (board) => board.type === 'home-assistant',
  )
  const themeTokens = config ? deriveThemeTokens(config.theme, { sportsBoard }) : null
  const runtimeLeagues = sportsBoard?.leagues.filter((league) => league.enabled) ?? []
  const runtimeLeagueIdsKey = runtimeLeagues.map((league) => league.id).join('|')
  const activeRuntimeLeague = runtimeLeagues.length
    ? runtimeLeagues[runtimeLeagueIndex % runtimeLeagues.length]
    : null
  const runtimeVisibleLeague = runtimeLeagues.find((league) => league.id === runtimeVisibleLeagueId) || null
  const runtimeDisplayLeague = runtimeVisibleLeague || activeRuntimeLeague
  const activeRuntimePayload = runtimeDisplayLeague
    ? runtimePayloadByLeagueId[runtimeDisplayLeague.id] || null
    : null
  const activeRuntimeGames = Array.isArray(activeRuntimePayload?.normalizedGames)
    ? activeRuntimePayload.normalizedGames
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
    const storedTeamStyles = runtimeDisplayLeague?.teamStyles && typeof runtimeDisplayLeague.teamStyles === 'object'
      ? runtimeDisplayLeague.teamStyles
      : {}
    const awayStoredStyle = storedTeamStyles[String(game?.teams?.away?.id || '').trim()] || {}
    const homeStoredStyle = storedTeamStyles[String(game?.teams?.home?.id || '').trim()] || {}
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
    const showLiveState = leagueStatToggleEnabled(runtimeDisplayLeague, 'showLiveState', false)
    const nextRace = isRacing ? nextRacingCalendarEvent(activeRuntimePayload, game) : null
    const liveTheme = runtimeLiveTheme(game, rawEvent)
    const baseballLiveData = showLiveState && liveTheme === 'baseball'
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
      hasBaseballLivePanel: Boolean(showLiveState && baseballLiveData),
    })
    const racingTopPrimaryLabel = nextRace?.label
      ? 'NEXT RACE'
      : String(game?.state || '').toLowerCase() === 'post'
        ? 'FINAL'
        : 'RACE STATUS'
    const racingTopPrimaryText = nextRace?.label
      ? `${nextRace.label}${nextRace.dateText ? ` • ${nextRace.dateText}` : ''}`
      : formatRuntimeStatus(game)
    const racingTopTvText = showLiveState && runtimeDisplayLeague?.showTV && broadcastText
      ? `TV ${broadcastText}`
      : ''

    const infoParts = [formatRuntimeStatus(game)]
    if (showLiveState && baseballSituationText && !baseballLiveData) {
      infoParts.push(baseballSituationText)
    }
    if (runtimeDisplayLeague?.showTV && broadcastText && !isRacing) {
      infoParts.push(`TV ${broadcastText}`)
    }
    if (runtimeDisplayLeague?.showOdds && oddsText) {
      infoParts.push(`Odds ${oddsText}`)
    }
    if (runtimeDisplayLeague?.showNews && venueText) {
      infoParts.push(venueText)
    }

    return {
      ...game,
      isLiveFeatured:
        Boolean(runtimeDisplayLeague?.liveGameMode)
        && String(game?.state || '').toLowerCase() === 'in',
      liveTheme,
      isRacing,
      useTeamCardColors,
      showLiveState,
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
            primary: sanitizeHexColor(awayStoredStyle.color)
              || awayPaletteRaw.primary
              || sanitizeHexColor(game?.teams?.away?.color),
            alternate: sanitizeHexColor(awayStoredStyle.alternateColor)
              || awayPaletteRaw.alternate
              || sanitizeHexColor(game?.teams?.away?.alternateColor),
          },
        },
        home: {
          ...(game?.teams?.home || {}),
          logo: String(game?.teams?.home?.logo || homeLogoRaw || '').trim(),
          palette: {
            primary: sanitizeHexColor(homeStoredStyle.color)
              || homePaletteRaw.primary
              || sanitizeHexColor(game?.teams?.home?.color),
            alternate: sanitizeHexColor(homeStoredStyle.alternateColor)
              || homePaletteRaw.alternate
              || sanitizeHexColor(game?.teams?.home?.alternateColor),
          },
        },
      },
      cardInfo: infoParts.join(' • '),
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
    : (activeRuntimePayload ? [] : runtimeLastStableMarqueeGames)
  const runtimeRenderLeague = runtimeVisibleLeague || (runtimeDisplayGames.length ? runtimeDisplayLeague : null)
  const runtimeHasAnyGamesAcrossEnabledLeagues = runtimeLeagues.some((league) => {
    const payload = runtimePayloadByLeagueId[league.id]
    return Array.isArray(payload?.normalizedGames) && payload.normalizedGames.length > 0
  })

  useEffect(() => {
    if (!runtimeDisplayLeague?.id || !runtimeDisplayGames.length) {
      return
    }

    setRuntimeLastStableLeagueId(runtimeDisplayLeague.id)
    setRuntimeLastStableMarqueeGames(runtimeDisplayGames)
  }, [runtimeDisplayLeague?.id, runtimeDisplayGames])

  async function loadLeagueScoreboardWithSettings(league, {
    cacheTtlSeconds = 30,
  } = {}) {
    const query = buildTickerScoreboardQuery(league, {
      cacheTtlSeconds,
    })
    const response = await fetch(`/api/v1/espn/scoreboard?${query}`)
    if (!response.ok) {
      throw new Error(`Ticker fetch failed with ${response.status}`)
    }
    return response.json()
  }

  useEffect(() => {
    if (!isTickerRuntime || !runtimeLeagues.length) {
      return
    }

    setRuntimeLeagueIndex(0)
    setRuntimeVisibleLeagueId('')
  }, [isTickerRuntime, runtimeLeagueIdsKey])

  useEffect(() => {
    if (!runtimeLeagues.length) {
      setRuntimeVisibleLeagueId('')
      return
    }

    if (runtimeVisibleLeagueId && !runtimeLeagues.some((league) => league.id === runtimeVisibleLeagueId)) {
      setRuntimeVisibleLeagueId('')
    }
  }, [runtimeLeagues, runtimeVisibleLeagueId, runtimePayloadByLeagueId])

  useEffect(() => {
    if (!isTickerRuntime || !runtimeDisplayLeague || !runtimeMarqueeGames.length) {
      setRuntimeScrollSeconds(45)
      return
    }

    const updateScrollSeconds = () => {
      const track = runtimeMarqueeTrackRef.current
      if (!track) {
        return
      }

      const windowEl = runtimeMarqueeWindowRef.current
      const trackWidth = track.scrollWidth || track.getBoundingClientRect().width || 0
      const windowWidth = windowEl?.clientWidth || windowEl?.getBoundingClientRect().width || 0
      if (!trackWidth) {
        return
      }

      setRuntimeTrackWidth(trackWidth)
      setRuntimeWindowWidth(windowWidth)
      const travelDistance = trackWidth + Math.max(0, windowWidth)
      const pxPerSecond = 110
      const nextSeconds = Math.max(12, travelDistance / pxPerSecond)
      setRuntimeScrollSeconds(Number(nextSeconds.toFixed(1)))
    }

    updateScrollSeconds()

    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateScrollSeconds)
    })

    if (runtimeMarqueeTrackRef.current) {
      observer.observe(runtimeMarqueeTrackRef.current)
    }
    if (runtimeMarqueeWindowRef.current) {
      observer.observe(runtimeMarqueeWindowRef.current)
    }

    return () => observer.disconnect()
  }, [isTickerRuntime, runtimeDisplayLeague?.id, runtimeMarqueeGames.length])

  useEffect(() => {
    if (!isTickerRuntime || runtimeLeagues.length <= 1 || !sportsBoard || runtimeDisplayGames.length > 0) {
      return
    }

    const rotateSeconds = Math.max(5, Number(sportsBoard.rotateSeconds) || 45)
    const intervalId = window.setInterval(() => {
      setRuntimeLeagueIndex((current) => (current + 1) % runtimeLeagues.length)
    }, rotateSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [isTickerRuntime, runtimeLeagueIdsKey, runtimeLeagues.length, sportsBoard, runtimeDisplayGames.length])

  async function refreshRuntimeLeaguePayload(
    league,
    {
      cacheTtlSeconds = 5,
      fallbackCacheTtlSeconds = 5,
    } = {},
  ) {
    if (!league?.id) {
      return null
    }

    setRuntimeLoadStateByLeagueId((current) => ({
      ...current,
      [league.id]: { loading: true, error: '' },
    }))

    try {
      const payload = await loadLeagueScoreboardWithSettings(league, {
        cacheTtlSeconds,
        fallbackCacheTtlSeconds,
      })

      setRuntimePayloadByLeagueId((current) => ({
        ...current,
        [league.id]: payload,
      }))
      setRuntimeLoadStateByLeagueId((current) => ({
        ...current,
        [league.id]: { loading: false, error: '' },
      }))

      const gameCount = Array.isArray(payload?.normalizedGames) ? payload.normalizedGames.length : 0
      if (gameCount > 0 && (!runtimeVisibleLeagueId || runtimeVisibleLeagueId === league.id)) {
        setRuntimeVisibleLeagueId(league.id)
      }
      if (gameCount === 0 && runtimeLeagues.length > 1) {
        const currentIndex = runtimeLeagues.findIndex((item) => item.id === league.id)
        const nextIndex = findNextLeagueIndexInOrder(
          currentIndex,
          runtimeLeagues,
          {
            ...runtimePayloadRef.current,
            [league.id]: payload,
          },
          {
            ...runtimeLoadStateRef.current,
            [league.id]: { loading: false, error: '' },
          },
        )
        const nextLeague = runtimeLeagues[nextIndex]
        if (nextLeague?.id && nextLeague.id !== league.id) {
          void refreshRuntimeLeaguePayload(nextLeague, {
            cacheTtlSeconds,
            fallbackCacheTtlSeconds,
          })
          window.setTimeout(() => {
            setRuntimeLeagueIndex(nextIndex)
            setRuntimeVisibleLeagueId(nextLeague.id)
          }, 0)
        }
        if (!runtimeVisibleLeagueId) {
          return payload
        }
      }

      return payload
    } catch (loadError) {
      setRuntimeLoadStateByLeagueId((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
      return null
    }
  }

  useEffect(() => {
    if (!isTickerRuntime || !runtimeDisplayLeague) {
      return
    }

    refreshRuntimeLeaguePayload(runtimeDisplayLeague)
  }, [isTickerRuntime, runtimeDisplayLeague?.id])

  function updateConfigSection(section, field, value) {
    commitConfig((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }))
  }

  function updateThemeTeam(field, value) {
    commitConfig((current) => ({
      ...current,
      theme: {
        ...current.theme,
        teamTheme: {
          ...current.theme.teamTheme,
          [field]: value,
        },
      },
    }))
  }

  function applyThemeMode(mode) {
    commitConfig((current) => ({
      ...current,
      theme: {
        ...current.theme,
        mode,
      },
    }))
  }

  function setThemeOverride(field, value) {
    updateConfigSection('theme', field, value)
  }

  function clearThemeOverride(field) {
    updateConfigSection('theme', field, '')
  }

  function updateBoard(boardType, updates) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) =>
        board.type === boardType ? { ...board, ...updates } : board,
      ),
    }))
  }

  function updateLeague(index, field, value) {
    setConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) =>
            leagueIndex === index ? { ...league, [field]: value } : league,
          ),
        }
      }),
    }))
  }

  function upsertLeagueTeamStylesByLeagueId(leagueId, teams) {
    const safeLeagueId = String(leagueId || '').trim()
    if (!safeLeagueId || !Array.isArray(teams)) {
      return
    }

    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        return {
          ...board,
          leagues: board.leagues.map((league) => {
            if (league.id !== safeLeagueId) {
              return league
            }

            const existingStyles = league.teamStyles && typeof league.teamStyles === 'object'
              ? league.teamStyles
              : {}
            const nextStyles = { ...existingStyles }

            for (const team of teams) {
              const teamId = String(team?.id || '').trim()
              if (!teamId) {
                continue
              }

              const previous = existingStyles[teamId] || {}
              const primaryLogo = resolveTeamPrimaryLogo(team, safeLeagueId)
              nextStyles[teamId] = {
                name: String(previous.name || team?.name || '').trim(),
                abbreviation: String(previous.abbreviation || team?.abbreviation || '').trim(),
                logo: String(previous.logo || primaryLogo || '').trim(),
                color: sanitizeHexColor(previous.color || team?.color),
                alternateColor: sanitizeHexColor(previous.alternateColor || team?.alternateColor),
              }
            }

            return {
              ...league,
              teamStyles: nextStyles,
            }
          }),
        }
      }),
    }))
  }

  function updateLeagueTeamStyle(index, teamId, updates) {
    const safeTeamId = String(teamId || '').trim()
    if (index < 0 || !safeTeamId || !updates || typeof updates !== 'object') {
      return
    }

    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) => {
            if (leagueIndex !== index) {
              return league
            }

            const existingStyles = league.teamStyles && typeof league.teamStyles === 'object'
              ? league.teamStyles
              : {}
            const previous = existingStyles[safeTeamId] || {}

            return {
              ...league,
              teamStyles: {
                ...existingStyles,
                [safeTeamId]: {
                  ...previous,
                  ...updates,
                },
              },
            }
          }),
        }
      }),
    }))
  }

  function moveLeague(index, direction) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        const target = index + direction
        if (target < 0 || target >= board.leagues.length) {
          return board
        }

        const nextLeagues = [...board.leagues]
        const [item] = nextLeagues.splice(index, 1)
        nextLeagues.splice(target, 0, item)

        return {
          ...board,
          leagues: nextLeagues,
        }
      }),
    }))
  }

  function toggleLeagueIncludedGroup(index, groupId, checked) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) => {
            if (leagueIndex !== index) {
              return league
            }

            const currentGroups = Array.isArray(league.includedGroups) ? league.includedGroups : []
            const nextGroups = checked
              ? Array.from(new Set([...currentGroups, groupId]))
              : currentGroups.filter((id) => id !== groupId)

            return {
              ...league,
              includedGroups: nextGroups,
            }
          }),
        }
      }),
    }))
  }

  function toggleLeagueIncludedTeam(index, teamId, checked) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) => {
            if (leagueIndex !== index) {
              return league
            }

            const currentTeams = Array.isArray(league.includedTeams) ? league.includedTeams : []
            const nextTeams = checked
              ? Array.from(new Set([...currentTeams, String(teamId)]))
              : currentTeams.filter((id) => String(id) !== String(teamId))

            return {
              ...league,
              includedTeams: nextTeams,
            }
          }),
        }
      }),
    }))
  }

  async function loadLeagueTeams(league) {
    if (!league?.id || !league?.url) {
      return
    }

    setLeagueLoadStateById((current) => ({
      ...current,
      [league.id]: { loading: true, error: '' },
    }))

    try {
      const teamsUrl = toLeagueTeamsEndpoint(league.url)
      const response = await fetch(buildEspnProxyUrl(teamsUrl, 300))
      if (!response.ok) {
        throw new Error(`Teams fetch failed with ${response.status}`)
      }

      const payload = await response.json()
      let teams = normalizeTeamDataFromTeamsEndpoint(payload)

      // Fallback for unexpected endpoint shapes so league page remains usable.
      if (!teams.length) {
        const scoreboardResponse = await fetch(buildEspnProxyUrl(league.url, 60))
        if (!scoreboardResponse.ok) {
          throw new Error(`Fallback scoreboard fetch failed with ${scoreboardResponse.status}`)
        }
        const scoreboardPayload = await scoreboardResponse.json()
        teams = normalizeTeamDataFromScoreboard(scoreboardPayload)
      }

      setLeagueTeamsById((current) => ({
        ...current,
        [league.id]: teams,
      }))
      upsertLeagueTeamStylesByLeagueId(league.id, teams)
      setLeagueLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: '' },
      }))
    } catch (loadError) {
      setLeagueLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadLeagueGroups(league) {
    if (!league?.id || !league?.url) {
      return
    }

    const params = parseLeagueApiParams(league.url)
    if (!params.league) {
      return
    }

    setLeagueGroupsLoadStateById((current) => ({
      ...current,
      [league.id]: { loading: true, error: '' },
    }))

    try {
      const query = new URLSearchParams({
        sport: params.sport,
        league: params.league,
        cache_ttl_seconds: '300',
      })
      const response = await fetch(`/api/v1/espn/league-groups?${query.toString()}`)
      if (!response.ok) {
        throw new Error(`League groups fetch failed with ${response.status}`)
      }

      const payload = await response.json()
      setLeagueGroupsById((current) => ({
        ...current,
        [league.id]: Array.isArray(payload?.groups) ? payload.groups : [],
      }))
      setLeagueGroupsLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: '' },
      }))
    } catch (loadError) {
      setLeagueGroupsLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadTeamLogosForLeagueTeam(league, team) {
    if (!league?.id || !league?.url || !team?.id) {
      return
    }

    const cacheKey = `${league.id}:${team.id}`
    const params = parseLeagueApiParams(league.url)
    if (!params.league) {
      return
    }

    setTeamLogoLoadStateByKey((current) => ({
      ...current,
      [cacheKey]: { loading: true, error: '' },
    }))

    try {
      const query = new URLSearchParams({
        sport: params.sport,
        league: params.league,
        team: String(team.id),
        cache_ttl_seconds: '300',
      })

      const response = await fetch(`/api/v1/espn/team-logos?${query.toString()}`)
      if (!response.ok) {
        throw new Error(`Team logos fetch failed with ${response.status}`)
      }

      const payload = await response.json()
      const split = splitTeamLogosForDisplay(payload?.logos || [], league.id)
      setTeamLogoDetailsByKey((current) => ({
        ...current,
        [cacheKey]: {
          ...split,
          teamProfile: payload?.teamProfile || null,
        },
      }))
      setTeamLogoLoadStateByKey((current) => ({
        ...current,
        [cacheKey]: { loading: false, error: '' },
      }))
    } catch (loadError) {
      setTeamLogoLoadStateByKey((current) => ({
        ...current,
        [cacheKey]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadLeagueTickerPreview(league, options = {}) {
    if (!league?.id || !league?.url) {
      return
    }

    setLeagueTickerPreviewLoadStateById((current) => ({
      ...current,
      [league.id]: { loading: true, error: '' },
    }))

    try {
      const payload = await loadLeagueScoreboardWithSettings(league, {
        cacheTtlSeconds: 60,
        fallbackCacheTtlSeconds: 30,
        week: options.week || '',
      })
      setLeagueTickerPreviewById((current) => ({
        ...current,
        [league.id]: payload,
      }))
      setLeagueTickerPreviewLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: '' },
      }))
    } catch (loadError) {
      setLeagueTickerPreviewLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadLeagueCatalog(sport) {
    const requestedSportRaw = (sport || '').trim().toLowerCase()
    const requestedSport = API_NATIVE_SPORT_FILTERS.has(requestedSportRaw) ? requestedSportRaw : ''
    setLeagueCatalogState({ loading: true, error: '' })

    try {
      const params = new URLSearchParams({
        cache_ttl_seconds: '600',
      })
      if (requestedSport) {
        params.set('sport', requestedSport)
      }

      const response = await fetch(`/api/v1/espn/discover-leagues?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`League discovery failed with ${response.status}`)
      }

      const payload = await response.json()
      setLeagueCatalog(Array.isArray(payload?.leagues) ? payload.leagues : [])
      setLeagueCatalogState({ loading: false, error: '' })
    } catch (loadError) {
      setLeagueCatalogState({ loading: false, error: loadError.message })
    }
  }

  function addLeagueFromCatalog(entry) {
    if (!entry?.league || !entry?.scoreboardUrl) {
      return
    }

    const leagueId = String(entry.league).trim().toLowerCase()
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') {
          return board
        }

        const exists = board.leagues.some((league) => league.id === leagueId)
        if (exists) {
          setNotice(`${entry.leagueName} is already in your league list.`)
          return board
        }

        const newLeague = {
          id: leagueId,
          name: entry.leagueName || entry.league,
          url: entry.scoreboardUrl,
          logo: String(entry.logo || '').trim() || resolveLeagueLogo({ id: leagueId }),
          enabled: true,
          showTV: true,
          showOdds: false,
          showNews: false,
          liveGameMode: false,
          useTeamCardColors: false,
          showStatRecords: true,
          showStatClock: true,
          showStatSituation: true,
          showStatVenue: false,
          showStatOdds: false,
          includedTeams: [],
          includedGroups: [],
          teamStyles: {},
        }

        setNotice(`Added ${newLeague.name}.`)
        return {
          ...board,
          leagues: [...board.leagues, newLeague],
        }
      }),
    }))
  }

  async function saveConfig(continueToNextPage = false) {
    if (!config) {
      return
    }

    if (!setupReady) {
      setError(`Setup is incomplete: ${firstSetupError}`)
      return
    }

    if (!hasUnsavedChanges) {
      setNotice('No unsaved changes.')
      return
    }

    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/v1/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configRef.current || config),
      })

      if (!response.ok) {
        throw new Error(`Save failed with ${response.status}`)
      }

      const payload = await response.json()
      const currentPageIndex = editablePageSequence.indexOf(activePage)
      const nextPageId =
        continueToNextPage && currentPageIndex >= 0
          ? editablePageSequence[Math.min(currentPageIndex + 1, editablePageSequence.length - 1)]
          : null

      startTransition(() => {
        setConfig(payload)
        setSavedConfig(payload)
        configRef.current = payload
        setRuntimeLeagueIndex(0)
        setRuntimeVisibleLeagueId('')
        setRuntimeLastStableLeagueId('')
        setRuntimeLastStableMarqueeGames([])
        setNotice(continueToNextPage ? 'Configuration saved. Moved to next section.' : 'Configuration saved.')
        if (nextPageId) {
          setActivePage(nextPageId)
        }
      })
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function resetConfig() {
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/v1/config/reset', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Reset failed with ${response.status}`)
      }

      const payload = await response.json()
      startTransition(() => {
        setConfig(payload)
        setSavedConfig(payload)
        configRef.current = payload
        setRuntimeLeagueIndex(0)
        setRuntimeVisibleLeagueId('')
        setRuntimeLastStableLeagueId('')
        setRuntimeLastStableMarqueeGames([])
        setNotice('Configuration reset to defaults.')
      })
    } catch (resetError) {
      setError(resetError.message)
    }
  }

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
  }

  if (isTickerRuntime) {
    const runtimeBoardWidth = Math.max(320, Number(config?.monitor?.width) || 1920)
    const runtimeBoardHeight = Math.max(120, Number(config?.monitor?.height) || 380)
    const hasEnabledRuntimeLeagues = runtimeLeagues.length > 0

    return (
      <main className={`ticker-runtime-shell ${themeTokens.modeClass}`} style={shellStyle}>
        {!hasEnabledRuntimeLeagues ? (
          <p className="ticker-runtime-empty">Enable at least one league.</p>
        ) : (
          <section
            className="ticker-runtime-board"
            style={{
              width: '100vw',
              maxWidth: `${runtimeBoardWidth}px`,
              height: `min(100vh, ${runtimeBoardHeight}px)`,
            }}
          >
            <div className="ticker-runtime-marquee-window" ref={runtimeMarqueeWindowRef}>
              <div
                key={`marquee-${runtimeRenderLeague?.id || 'none'}-${runtimeMarqueeGames.length}`}
                className="ticker-runtime-track ticker-runtime-track-animated"
                ref={runtimeMarqueeTrackRef}
                role="list"
                aria-label="Ticker games"
                style={{
                  '--runtime-scroll-seconds': `${runtimeScrollSeconds}s`,
                  '--runtime-track-width': `${Math.max(1, runtimeTrackWidth)}px`,
                  '--runtime-window-width': `${Math.max(1, runtimeWindowWidth)}px`,
                }}
                onAnimationEnd={() => {
                  if (runtimeLeagues.length > 1) {
                    const currentDisplayIndex = runtimeLeagues.findIndex(
                      (league) => league.id === runtimeRenderLeague?.id,
                    )
                    const seedIndex = currentDisplayIndex >= 0 ? currentDisplayIndex : runtimeLeagueIndex
                    const nextIndex = findNextLeagueIndexInOrder(
                      seedIndex,
                      runtimeLeagues,
                      runtimePayloadRef.current,
                      runtimeLoadStateRef.current,
                    )
                    const nextLeague = runtimeLeagues[nextIndex]
                    if (nextLeague?.id) {
                      refreshRuntimeLeaguePayload(nextLeague).finally(() => {
                        setRuntimeLeagueIndex(nextIndex)
                        setRuntimeVisibleLeagueId(nextLeague.id)
                      })
                    }
                  }
                }}
              >
                {runtimeMarqueeGames.map((game, index) => {
                  const isSoloSlate = runtimeMarqueeGames.length === 1
                  const isDuoSlate = runtimeMarqueeGames.length === 2
                  const isFinishedRace = game?.isRacing && String(game?.state || '').toLowerCase() === 'post'
                  const sportToken = cssToken(game?.sport, 'generic')
                  const stateToken = cssToken(game?.state, 'unknown')
                  const away = game?.teams?.away
                  const home = game?.teams?.home
                  const awayLogo = away?.logo || ''
                  const homeLogo = home?.logo || ''
                  const awayBadge = String(away?.abbreviation || away?.name || '?').slice(0, 3).toUpperCase()
                  const homeBadge = String(home?.abbreviation || home?.name || '?').slice(0, 3).toUpperCase()
                  const hasBaseballLiveDiamond = Boolean(game?.showLiveState && game?.baseballLiveData)
                  const resolvedBattingSide = game?.baseballBattingSide === 'home' || game?.baseballBattingSide === 'away'
                    ? game.baseballBattingSide
                    : 'away'
                  const showAwayBaseDiamond = hasBaseballLiveDiamond && resolvedBattingSide === 'away'
                  const showHomeBaseDiamond = hasBaseballLiveDiamond && resolvedBattingSide === 'home'
                  const allRacingEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
                  const hasLiveRacingTelemetry = racingHasTelemetry(allRacingEntries)
                  const podiumEntries = isFinishedRace && isSoloSlate ? allRacingEntries.slice(0, 3) : []
                  const racingEntries = isFinishedRace && isSoloSlate
                    ? allRacingEntries.slice(3)
                    : allRacingEntries.slice(0, isSoloSlate ? 16 : 6)

                  return (
                    <article
                      key={`${game.id || `${away?.id}-${home?.id}-${game?.startTimeUtc || ''}`}-${index}`}
                      className={`ticker-runtime-card ticker-runtime-card-sport-${sportToken} ticker-runtime-card-state-${stateToken}${isSoloSlate ? ' ticker-runtime-card-solo' : ''}${isDuoSlate ? ' ticker-runtime-card-duo' : ''}${game?.isRacing ? ' ticker-runtime-card-racing' : ''}${game?.isRacing && isSoloSlate ? ' ticker-runtime-card-racing-solo' : ''}${game?.isLiveFeatured ? ` ticker-runtime-card-live ticker-runtime-card-live-${game.liveTheme || 'generic'}` : ''}${game?.useTeamCardColors ? ' ticker-runtime-card-use-team-colors' : ''}`}
                      style={runtimeCardStyle(game, game?.useTeamCardColors)}
                      role="listitem"
                    >
                      {game?.isLiveFeatured ? (
                        <p className="ticker-runtime-live-flag">LIVE</p>
                      ) : null}
                      {game?.isRacing ? (
                        <>
                          <div className="ticker-runtime-racing-head">
                            <div className="ticker-runtime-racing-head-main">
                              <span className="ticker-runtime-racing-series">MOTORSPORT</span>
                              <strong className="ticker-runtime-racing-title">{racingCardTitle(game, runtimeRenderLeague)}</strong>
                            </div>
                            {game?.racingTopInfo?.value || game?.racingTopInfo?.tv ? (
                              <div className="ticker-runtime-racing-head-side" aria-label="Race schedule and TV">
                                {game?.racingTopInfo?.value ? (
                                  <p className="ticker-runtime-racing-head-line">
                                    <span>{game.racingTopInfo.label}</span>
                                    <strong>{game.racingTopInfo.value}</strong>
                                  </p>
                                ) : null}
                                {game?.racingTopInfo?.tv ? (
                                  <p className="ticker-runtime-racing-head-line ticker-runtime-racing-head-tv">
                                    <span>TV</span>
                                    <strong>{String(game.racingTopInfo.tv).replace(/^TV\s+/, '')}</strong>
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          <div className="ticker-runtime-divider" />

                          {game?.isLiveFeatured && game?.showLiveState ? (
                            <div className="ticker-runtime-racing-live-bar">{racingLiveHeader(game)}</div>
                          ) : null}

                          {game?.isLiveFeatured && !hasLiveRacingTelemetry ? (
                            <div className="ticker-runtime-racing-telemetry-fallback">
                              {racingTelemetryFallback(game, allRacingEntries)}
                            </div>
                          ) : null}

                          {podiumEntries.length ? (
                            <div className="ticker-runtime-racing-podium" aria-label="Race podium">
                              {podiumEntries.map((entry) => (
                                <div key={`${game.id}-podium-${entry.id || entry.position || entry.name}`} className="ticker-runtime-racing-podium-item">
                                  <span className="ticker-runtime-racing-podium-rank">P{entry.position || '-'}</span>
                                  <span className="ticker-runtime-racing-podium-name">{entry.shortName || entry.name || 'Driver'}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className={`ticker-runtime-racing-leaders${isSoloSlate ? ' ticker-runtime-racing-leaders-solo' : ''}${game?.isLiveFeatured ? ' ticker-runtime-racing-leaders-live' : ''}${isFinishedRace && isSoloSlate ? ' ticker-runtime-racing-leaders-finished' : ''}`}>
                            {racingEntries.map((entry) => (
                              <div key={`${game.id}-${entry.id || entry.position || entry.name}`} className="ticker-runtime-racing-driver-row">
                                <span className="ticker-runtime-racing-position">P{entry.position || '-'}</span>
                                <span className="ticker-runtime-racing-driver-block">
                                  <span className="ticker-runtime-racing-driver">
                                    {entry?.flag?.href ? (
                                      <img src={entry.flag.href} alt={entry.flag.alt || entry.name || 'Flag'} />
                                    ) : null}
                                    <span>{entry.shortName || entry.name || 'Driver'}</span>
                                  </span>
                                  {game?.isLiveFeatured && racingEntrySummary(entry) ? (
                                    <span className="ticker-runtime-racing-detail">{racingEntrySummary(entry)}</span>
                                  ) : null}
                                </span>
                                <span className="ticker-runtime-racing-status">{entry.winner ? 'WIN' : ''}</span>
                              </div>
                            ))}
                          </div>

                          {game?.nextRace?.label ? (
                            <div className="ticker-runtime-racing-next-bar">
                              <span className="ticker-runtime-racing-next-label">Next</span>
                              <span className="ticker-runtime-racing-next-text">{game.nextRace.label}{game.nextRace.dateText ? ` • ${game.nextRace.dateText}` : ''}</span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="ticker-runtime-row ticker-runtime-row-away" style={game?.useTeamCardColors ? teamRowStyle(away) : undefined}>
                            <div className="ticker-runtime-team">
                              {awayLogo ? (
                                <img src={awayLogo} alt={runtimeTeamName(away)} />
                              ) : (
                                <span className="ticker-runtime-team-mark" aria-hidden="true">{awayBadge}</span>
                              )}
                              <span className="ticker-runtime-team-name-block">
                                {game?.showStatRecords && teamRecordText(away) ? (
                                  <span className="ticker-runtime-team-meta-row">
                                    <span className="ticker-runtime-team-name">{runtimeTeamName(away)}</span>
                                    <span className="ticker-runtime-team-record">{teamRecordText(away)}</span>
                                  </span>
                                ) : (
                                  <span className="ticker-runtime-team-name">{runtimeTeamName(away)}</span>
                                )}
                              </span>
                            </div>
                            <span className="ticker-runtime-score-block">
                              <strong className="ticker-runtime-score">{away?.score || '-'}</strong>
                              {showAwayBaseDiamond ? (
                                <div className="ticker-runtime-baseball-diamond ticker-runtime-baseball-diamond-score" aria-label="Away team at bat">
                                  <span className={`ticker-runtime-base ticker-runtime-base-second${game.baseballLiveData.onSecond ? ' is-occupied' : ''}`} />
                                  <span className={`ticker-runtime-base ticker-runtime-base-first${game.baseballLiveData.onFirst ? ' is-occupied' : ''}`} />
                                  <span className="ticker-runtime-base ticker-runtime-base-home" />
                                  <span className={`ticker-runtime-base ticker-runtime-base-third${game.baseballLiveData.onThird ? ' is-occupied' : ''}`} />
                                </div>
                              ) : null}
                            </span>
                          </div>

                          <div className="ticker-runtime-divider" />

                          <div className="ticker-runtime-row ticker-runtime-row-home" style={game?.useTeamCardColors ? teamRowStyle(home) : undefined}>
                            <div className="ticker-runtime-team">
                              {homeLogo ? (
                                <img src={homeLogo} alt={runtimeTeamName(home)} />
                              ) : (
                                <span className="ticker-runtime-team-mark" aria-hidden="true">{homeBadge}</span>
                              )}
                              <span className="ticker-runtime-team-name-block">
                                {game?.showStatRecords && teamRecordText(home) ? (
                                  <span className="ticker-runtime-team-meta-row">
                                    <span className="ticker-runtime-team-name">{runtimeTeamName(home)}</span>
                                    <span className="ticker-runtime-team-record">{teamRecordText(home)}</span>
                                  </span>
                                ) : (
                                  <span className="ticker-runtime-team-name">{runtimeTeamName(home)}</span>
                                )}
                              </span>
                            </div>
                            <span className="ticker-runtime-score-block">
                              <strong className="ticker-runtime-score">{home?.score || '-'}</strong>
                              {showHomeBaseDiamond ? (
                                <div className="ticker-runtime-baseball-diamond ticker-runtime-baseball-diamond-score" aria-label="Home team at bat">
                                  <span className={`ticker-runtime-base ticker-runtime-base-second${game.baseballLiveData.onSecond ? ' is-occupied' : ''}`} />
                                  <span className={`ticker-runtime-base ticker-runtime-base-first${game.baseballLiveData.onFirst ? ' is-occupied' : ''}`} />
                                  <span className="ticker-runtime-base ticker-runtime-base-home" />
                                  <span className={`ticker-runtime-base ticker-runtime-base-third${game.baseballLiveData.onThird ? ' is-occupied' : ''}`} />
                                </div>
                              ) : null}
                            </span>
                          </div>

                          {game?.showLiveState && game?.baseballLiveData ? (
                            <div className="ticker-runtime-baseball-situation-right" aria-label="Baseball live situation">
                              <div className="ticker-runtime-baseball-live-text">
                                <p>
                                  {[
                                    game.baseballLiveData.outs !== null
                                      ? `${game.baseballLiveData.outs} out${game.baseballLiveData.outs === 1 ? '' : 's'}`
                                      : 'Live',
                                    game.baseballLiveData.balls !== null && game.baseballLiveData.strikes !== null
                                      ? `Count ${game.baseballLiveData.balls}-${game.baseballLiveData.strikes}`
                                      : '',
                                  ].filter(Boolean).join(' • ')}
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {game?.runtimeDateText ? (
                            <p className="ticker-runtime-game-date">{game.runtimeDateText}</p>
                          ) : null}

                          {Array.isArray(game?.detailStats) && game.detailStats.length ? (
                            <div className="ticker-runtime-stats" aria-label="Game detail stats">
                              {game.detailStats.map((item) => (
                                <p key={`${game.id || index}-${item.label}`} className="ticker-runtime-stat-item">
                                  <span>{item.label}</span>
                                  <strong>{item.value}</strong>
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}

                      <p className="ticker-runtime-meta">{game.cardInfo}</p>
                    </article>
                  )
                })}
              </div>
            </div>

            <footer className="ticker-runtime-lower" aria-label="Lower third">
              <span className="ticker-runtime-lower-item ticker-runtime-league-brand">
                {resolveLeagueLogo(runtimeRenderLeague, runtimePayloadByLeagueId[runtimeRenderLeague?.id]) ? (
                  <img
                    src={resolveLeagueLogo(runtimeRenderLeague, runtimePayloadByLeagueId[runtimeRenderLeague?.id])}
                    alt={runtimeRenderLeague?.name || 'Ticker'}
                  />
                ) : (
                  runtimeRenderLeague?.name || 'Ticker'
                )}
              </span>
              <span className="ticker-runtime-lower-item">
                {(homeAssistantBoard?.haSensors || []).length
                  ? homeAssistantBoard.haSensors.slice(0, 4).join(' • ')
                  : 'Home Assistant sensors not configured'}
              </span>
            </footer>
          </section>
        )}
      </main>
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
  const selectedTeamStyle =
    selectedTickerLeague && selectedTickerTeam
      ? (selectedTickerLeague.teamStyles && typeof selectedTickerLeague.teamStyles === 'object'
          ? selectedTickerLeague.teamStyles[String(selectedTickerTeam.id)] || null
          : null)
      : null
  const selectedTeamPrimaryColor = sanitizeHexColor(
    selectedTeamStyle?.color || selectedTickerTeam?.color,
  ) || '#123456'
  const selectedTeamAlternateColor = sanitizeHexColor(
    selectedTeamStyle?.alternateColor || selectedTickerTeam?.alternateColor,
  ) || '#0c1626'
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

    const teamStyles = league?.teamStyles && typeof league.teamStyles === 'object'
      ? league.teamStyles
      : {}

    for (const [teamId, style] of Object.entries(teamStyles)) {
      const abbreviation = String(style?.abbreviation || '').trim().toUpperCase()
      const fallbackId = String(teamId || '').trim().toUpperCase()
      const value = abbreviation || fallbackId
      if (!value || byValue.has(value)) {
        continue
      }

      const name = String(style?.name || '').trim()
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
              <span>Use team theme</span>
              <input type="checkbox" checked={config.theme.teamTheme.enabled} onChange={(event) => updateThemeTeam('enabled', event.target.checked)} />
            </label>

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
              >
                <option value="">Select league</option>
                {themeLeagueOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small className="field-help">Choose the league that contains the saved team style you want to use for Team mode.</small>
              {themeErrors.teamLeague ? <small className="field-error">{themeErrors.teamLeague}</small> : null}
            </label>

            <label className="field">
              <span>Team</span>
              <select
                value={selectedThemeTeamValue}
                onChange={(event) => updateThemeTeam('team', String(event.target.value || '').trim().toUpperCase())}
                disabled={!selectedThemeLeague}
              >
                <option value="">Select team</option>
                {themeTeamOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small className="field-help">This selects the saved primary and alternate team colors used to derive Team mode tokens.</small>
              {selectedThemeLeague && themeTeamOptions.length === 0 ? (
                <small className="field-help">No saved team styles found for this league yet. Open Ticker setup, refresh ESPN teams for this league, then save config.</small>
              ) : null}
              {themeErrors.teamCode ? <small className="field-error">{themeErrors.teamCode}</small> : null}
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
                        const primaryLogoHref = resolveTeamPrimaryLogo(team, league.id)
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
                        <span>Show live state</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTickerLeague.showLiveState)}
                          onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showLiveState', event.target.checked)}
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
                <h3>Teams</h3>
                <p className="team-explorer-subtitle">Select teams to include and open details</p>
              </div>
              <button
                type="button"
                className="button-link"
                onClick={() => loadLeagueTeams(selectedTickerLeague)}
                disabled={selectedLeagueLoadState.loading}
              >
                {selectedLeagueLoadState.loading ? 'Refreshing...' : 'Refresh ESPN teams'}
              </button>
            </div>

            {selectedLeagueLoadState.loading ? <p>Loading team data from ESPN...</p> : null}
            {selectedLeagueLoadState.error ? <p className="field-error">{selectedLeagueLoadState.error}</p> : null}

            <div className="team-logo-grid">
              {selectedLeagueTeams.map((team) => {
                const primaryLogoHref = resolveTeamPrimaryLogo(team, selectedTickerLeague.id)
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
                      if (!teamLogoDetailsByKey[teamCacheKey]) {
                        loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedTickerTeamId(team.id)
                        const teamCacheKey = `${selectedTickerLeague.id}:${team.id}`
                        if (!teamLogoDetailsByKey[teamCacheKey]) {
                          loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                        }
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

                <h3>Team style (saved to league)</h3>
                <div className="team-meta-grid">
                  <p><strong>Primary color</strong><span>{selectedTeamStyle?.color || selectedTickerTeam?.color || 'N/A'}</span></p>
                  <p><strong>Alternate color</strong><span>{selectedTeamStyle?.alternateColor || selectedTickerTeam?.alternateColor || 'N/A'}</span></p>
                </div>
                <div className="team-style-edit-grid">
                  <label className="field field-full">
                    <span>Primary color</span>
                    <div className="color-control-row">
                      <input
                        type="color"
                        value={selectedTeamPrimaryColor}
                        onChange={(event) =>
                          updateLeagueTeamStyle(selectedTickerLeagueIndex, selectedTickerTeam.id, {
                            color: sanitizeHexColor(event.target.value),
                          })}
                      />
                      <input
                        type="text"
                        value={selectedTeamStyle?.color || selectedTickerTeam?.color || ''}
                        placeholder="#00338d"
                        onChange={(event) =>
                          updateLeagueTeamStyle(selectedTickerLeagueIndex, selectedTickerTeam.id, {
                            color: sanitizeHexColor(event.target.value),
                          })}
                      />
                    </div>
                  </label>
                  <label className="field field-full">
                    <span>Alternate color</span>
                    <div className="color-control-row">
                      <input
                        type="color"
                        value={selectedTeamAlternateColor}
                        onChange={(event) =>
                          updateLeagueTeamStyle(selectedTickerLeagueIndex, selectedTickerTeam.id, {
                            alternateColor: sanitizeHexColor(event.target.value),
                          })}
                      />
                      <input
                        type="text"
                        value={selectedTeamStyle?.alternateColor || selectedTickerTeam?.alternateColor || ''}
                        placeholder="#c60c30"
                        onChange={(event) =>
                          updateLeagueTeamStyle(selectedTickerLeagueIndex, selectedTickerTeam.id, {
                            alternateColor: sanitizeHexColor(event.target.value),
                          })}
                      />
                    </div>
                  </label>
                </div>

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

              <div>
                {selectedTeamLogoLoadState.loading ? <p>Loading team logo variants...</p> : null}
                {selectedTeamLogoLoadState.error ? <p className="field-error">{selectedTeamLogoLoadState.error}</p> : null}

                <div className="team-logo-variants">
                  {selectedTeamPrimaryLogos.length ? (
                    selectedTeamPrimaryLogos.map((logo, index) => (
                      <div key={`${selectedTickerTeam.id}-${index}`} className="team-logo-variant">
                        <img src={logo.href} alt={logo.alt || selectedTickerTeam.name} />
                        <p>{getLogoVariantLabel(logo, index)}</p>
                      </div>
                    ))
                  ) : (
                    <p>No ESPN logos available for this team from current feed.</p>
                  )}
                </div>

                {selectedTeamExtraLogos.length ? (
                  <>
                    <p className="team-explorer-subtitle">
                      Extra ESPN variants (unverified)
                    </p>
                    <div className="team-logo-variants team-logo-variants-extra">
                      {selectedTeamExtraLogos.map((logo, index) => (
                        <div key={`${selectedTickerTeam.id}-extra-${index}`} className="team-logo-variant">
                          <img src={logo.href} alt={logo.alt || selectedTickerTeam.name} />
                          <p>{getLogoVariantLabel(logo, index)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
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
          <div>
            <p className="eyebrow">Setup</p>
            <h1>PiBarTicker</h1>
            <p className="lede">
              Configure monitor, services, theme, and league behavior in one place.
            </p>
          </div>
          <div className="topbar-actions">
            <a className="button-secondary" href="/">
              Open ticker
            </a>
            <button
              type="button"
              className="button-primary"
              onClick={() => saveConfig(false)}
              disabled={!setupReady || isPending || !hasUnsavedChanges}
              title={!setupReady ? firstSetupError : ''}
            >
              {isPending ? 'Saving...' : 'Save changes'}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => saveConfig(true)}
              disabled={!setupReady || isPending || !hasUnsavedChanges || activePage === 'overview'}
              title={
                activePage === 'overview'
                  ? 'Open a setup page to use Save and Continue.'
                  : !setupReady
                    ? firstSetupError
                    : ''
              }
            >
              Save and continue
            </button>
            <button type="button" className="button-secondary" onClick={resetConfig}>
              Reset
            </button>
          </div>
        </header>

        <div className="status-row" aria-live="polite">
          <span className={`status-chip ${setupReady ? 'status-chip-success' : 'status-chip-error'}`}>
            Setup: {completedSetupSections}/{sectionChecks.length} complete
          </span>
          <span className={`status-chip ${hasUnsavedChanges ? 'status-chip-warning' : 'status-chip-success'}`}>
            {hasUnsavedChanges ? `Unsaved: ${dirtyPageIds.length} section(s)` : 'All changes saved'}
          </span>
          <span className="status-chip">Theme: {config.theme.mode}</span>
          <span className="status-chip">Enabled leagues: {enabledLeagues.length}</span>
          <span className="status-chip">Resolution: {config.monitor.width} x {config.monitor.height}</span>
          <span className="status-chip">API connected</span>
          {notice ? <span className="status-chip status-chip-success">{notice}</span> : null}
          {error ? <span className="status-chip status-chip-error">{error}</span> : null}
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
