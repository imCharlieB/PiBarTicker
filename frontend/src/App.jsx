import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
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

const RECOMMENDED_PI_FLAGS = [
  "--kiosk",
  "--noerrdialogs",
  "--disable-infobars",
  "--force-device-scale-factor=1",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
  "--disable-smooth-scrolling",
  "--overscroll-history-navigation=0",
  "--disable-translate",
  "--disable-features=TranslateUI",
  // Labwc/Wayland specific for current Pi OS (added by install, shown here too)
  "--ozone-platform=wayland",
  "--use-gl=egl",
  "--enable-features=OverlayScrollbar,VaapiVideoDecoder,WaylandWindowDecorations",
  "--disable-webgpu",
];

function addRecommendedPiFlags(currentFlags) {
  const existing = Array.isArray(currentFlags) ? currentFlags.map((f) => String(f).trim()) : [];
  const toAdd = RECOMMENDED_PI_FLAGS.filter((flag) => !existing.includes(flag));
  if (toAdd.length === 0) {
    return existing;
  }
  return [...existing, ...toAdd];
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
        // Prefer team, but fall back to athlete for single-person sports
        // (NASCAR, Indy, Motocross, Golf, F1 drivers in events, etc.)
        const team = competitor?.team || {}
        const athlete = competitor?.athlete || {}

        const entity = team.id ? team : athlete.id ? athlete : null
        if (!entity || !entity.id) {
          continue
        }

        const isAthlete = !team.id && !!athlete.id

        let incomingLogos = Array.isArray(entity.logos)
          ? entity.logos
          : entity.logo
            ? [{ href: entity.logo, alt: entity.displayName || entity.name || entity.abbreviation }]
            : []

        // For athletes in racing/MMA/etc. that only have a country flag in the raw data,
        // at least surface the flag so the user sees something instead of completely empty.
        if (incomingLogos.length === 0 && entity.flag?.href) {
          incomingLogos = [{
            href: entity.flag.href,
            alt: entity.flag.alt || entity.displayName || 'Flag'
          }]
        }

        const existing = teams.get(entity.id)
        if (existing) {
          const knownHrefs = new Set(existing.logos.map((logo) => logo.href))
          const mergedLogos = [
            ...existing.logos,
            ...incomingLogos.filter((logo) => logo?.href && !knownHrefs.has(logo.href)),
          ]
          teams.set(entity.id, { ...existing, logos: mergedLogos })
          continue
        }

        teams.set(entity.id, {
          id: entity.id,
          name: entity.displayName || entity.shortDisplayName || entity.name || entity.abbreviation,
          shortName: entity.shortDisplayName || entity.abbreviation || entity.name,
          abbreviation: entity.abbreviation || '',
          location: entity.location || '',
          color: entity.color || '',
          alternateColor: entity.alternateColor || '',
          logos: incomingLogos.filter((logo) => logo?.href),
          // Mark as athlete so UI and future logic can treat it as an individual
          _isAthlete: isAthlete,
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

/**
 * Determines the primary "entity type" for a league.
 * This drives UI labels ("Teams" vs "Drivers" vs "Riders" vs "Players")
 * and future sourcing logic for the logo cache.
 */
function isIndividualSport(sport, leagueSlug) {
  const s = (sport || '').toLowerCase()
  const l = (leagueSlug || '').toLowerCase()
  return (
    s === 'racing' || s === 'motorsports' || s === 'golf' || s === 'mma' || s === 'boxing' || s === 'tennis' ||
    /racing|motorsport|motogp|nascar|indy|indycar|wec|imsa|supercars|rally|f1|formula/.test(l)
  )
}

/**
 * For racing leagues (NASCAR, F1, IndyCar, MotoGP, WEC, IMSA, Supercars, Rally, etc.),
 * this tries to extract drivers/athletes from available sources (teams, scoreboard, standings).
 *
 * NOTE: For now this is best-effort. A more complete solution (pulling a full current drivers
 * roster + caching real profiles/headshots from ESPN web/standings) is planned for later.
 *
 * The live ticker already works well for these sports using the athlete data from events.
 */
async function harvestRacingEntities(league) {
  const entities = new Map()

  // 1. Try the traditional teams endpoint (constructors for F1, teams for NASCAR/WEC, etc.)
  try {
    const teamsUrl = toLeagueTeamsEndpoint(league.url)
    const resp = await fetch(buildEspnProxyUrl(teamsUrl, 300))
    if (resp.ok) {
      const data = await resp.json()
      const fromTeams = normalizeTeamDataFromTeamsEndpoint(data)
      for (const t of fromTeams) {
        entities.set(String(t.id), { ...t, _source: 'teams' })
      }
    }
  } catch (e) {
    console.warn('harvestRacingEntities: teams endpoint failed', e)
  }

  // 2. Harvest athletes/drivers from recent scoreboard events for most racing leagues.
  // For F1 we skip driver harvesting here on purpose: the league grid must only list
  // the constructor teams. When you click a team you should then see its 2 drivers.
  const params = parseLeagueApiParams(league.url || '')
  const leagueSlugForHarvest = (params.league || String(league.id || '')).toLowerCase()
  const isF1ForHarvest = /f1|formula/.test(leagueSlugForHarvest)

  if (!isF1ForHarvest) {
    try {
      const sbResp = await fetch(buildEspnProxyUrl(league.url, 60))
      if (sbResp.ok) {
        const sbData = await sbResp.json()
        const fromScoreboard = normalizeTeamDataFromScoreboard(sbData)
        for (const e of fromScoreboard) {
          if (!entities.has(String(e.id))) {
            entities.set(String(e.id), { ...e, _source: 'scoreboard-athlete' })
          }
        }
      }
    } catch (e) {
      console.warn('harvestRacingEntities: scoreboard harvest failed', e)
    }
  }

  // 3. Standings-based harvest (best-effort for now)
  // For F1 we skip here too (drivers belong under the team, not in the top-level grid).
  try {
    const params = parseLeagueApiParams(league.url || '')
    const sport = params.sport || 'racing'
    const leagueSlug = params.league || String(league.id || '').toLowerCase()

    if (!/f1|formula/.test(leagueSlug) && (sport === 'racing' || /racing|motorsport|nascar|indycar/.test(leagueSlug))) {
      const standingsUrl = league.url
        .replace('/scoreboard', '/standings')
        .replace('site.api.espn.com/apis/site/v2/sports', 'site.api.espn.com/apis/v2/sports')

      const stResp = await fetch(buildEspnProxyUrl(standingsUrl, 300))
      if (stResp.ok) {
        const stData = await stResp.json()
        const children = stData?.children || stData?.standings?.children || []

        for (const child of children) {
          const entries = child?.standings?.entries || child?.entries || []
          for (const entry of entries) {
            const athlete = entry?.athlete || entry?.team || {}
            if (athlete.id) {
              const existing = entities.get(String(athlete.id))
              if (!existing) {
                entities.set(String(athlete.id), {
                  id: athlete.id,
                  name: athlete.displayName || athlete.fullName || athlete.name,
                  shortName: athlete.shortName || athlete.abbreviation,
                  abbreviation: athlete.abbreviation || '',
                  logos: athlete.logos || [],
                  _source: 'standings',
                })
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('harvestRacingEntities: standings harvest failed (non-fatal)', e)
  }

  return Array.from(entities.values())
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

function buildTickerScoreboardQuery(league, {
  cacheTtlSeconds = 60,
  gameFilterOverride = null,
  useWeekFilterOverride = null,
} = {}) {
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

  // --- Revived server-side game filtering (the correct & efficient path) ---
  // We prefer explicit overrides (used for fallbackWhenEmpty re-queries) over the saved league value.
  const effectiveGameFilter = gameFilterOverride ?? league?.gameFilter ?? 'all'
  if (effectiveGameFilter && effectiveGameFilter !== 'all') {
    query.set('game_filter', effectiveGameFilter)
  }

  const effectiveUseWeek = useWeekFilterOverride ?? league?.useWeekFilter ?? false
  if (effectiveUseWeek) {
    query.set('use_week_filter', 'true')
  }

  // Note: We intentionally do NOT compute the actual week number here.
  // The backend + ESPN calendar logic (when use_week_filter is true) handles
  // current week narrowing for football leagues. This keeps things simple and reliable.

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

/**
 * Returns the relaxed game filter we should use when fallbackWhenEmpty triggers.
 * Strategy: "live" -> "upcoming", "today" -> "upcoming", "this-week" -> "upcoming",
 * everything else -> "all".
 */
function getRelaxedGameFilter(originalFilter) {
  const f = String(originalFilter || 'all').toLowerCase()
  if (f === 'live' || f === 'today' || f === 'this-week') {
    return 'upcoming'
  }
  return 'all'
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
  const [leagueLogoMetaById, setLeagueLogoMetaById] = useState({}) // new cached logo system data
  const [logoSyncingLeagues, setLogoSyncingLeagues] = useState({}) // leagueId -> boolean for download status
  const [logoClearMessageById, setLogoClearMessageById] = useState({}) // transient "cache nuked" confirmation
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
  // Used to only apply the 'ticker-runtime-track-animated' class (GPU hints) *after*
  // we have measured the real DOM widths in useLayoutEffect. Also gates starting
  // the rAF scroller. Prevents starting the scroller with wrong/zero values which
  // used to cause initial pop/jerk or bad start position.
  const [runtimeScrollReady, setRuntimeScrollReady] = useState(false)
  const runtimeScrollReadyRef = useRef(false)

  // Keep the ref in sync for any non-React callbacks (ResizeObserver etc.) that must
  // read "ready" synchronously without causing extra renders or stale closures.
  useEffect(() => {
    runtimeScrollReadyRef.current = runtimeScrollReady
  }, [runtimeScrollReady])
  const [runtimeLastStableLeagueId, setRuntimeLastStableLeagueId] = useState('')
  const [runtimeLastStableMarqueeGames, setRuntimeLastStableMarqueeGames] = useState([])

  // Computed size for the faint ticker watermark logo.
  // We measure the actual image so tall logos (UGA etc.) and wide ones all look good
  // without being tiny or getting clipped in the short ticker bar.
  const [tickerWatermarkSize, setTickerWatermarkSize] = useState('82%')

  // Memoize the watermark URL so it can be safely used in effects and as a dependency
  // without temporal dead zone issues.
  const tickerWatermarkUrl = useMemo(() => {
    if (!config?.theme?.tickerWatermarkEnabled) return null

    const tt = config.theme.teamTheme || {}

    // Only use the selected team's logo for the watermark when BOTH
    // "Ticker watermark" AND "Use team theme" are turned on.
    if (tt.enabled && tt.league && tt.team) {
      const fromTeam =
        getCachedOrRemoteLogo(tt.league, { id: tt.team, abbreviation: tt.team }, 'dark') ||
        getCachedOrRemoteLogo(tt.league, { id: tt.team, abbreviation: tt.team })

      if (fromTeam) return fromTeam
    }

    // Default to the app logo
    return '/pibarticker-logo-transparent.png'
  }, [
    config?.theme?.tickerWatermarkEnabled,
    config?.theme?.teamTheme?.enabled,
    config?.theme?.teamTheme?.league,
    config?.theme?.teamTheme?.team,
    leagueLogoMetaById,
  ])
  const runtimePayloadRef = useRef(runtimePayloadByLeagueId)
  const runtimeLoadStateRef = useRef(runtimeLoadStateByLeagueId)
  const configRef = useRef(null)
  const runtimeMarqueeTrackRef = useRef(null)
  const runtimeMarqueeWindowRef = useRef(null)

  // === Marquee animation refs (rAF-driven for buttery smooth consistent speed on Pi) ===
  // Using JS rAF + time-delta transform instead of CSS keyframes to:
  // - Eliminate jitter/stutter from CSS anim timing/compositor resets on low-power hardware.
  // - Allow precise initial offset so first content enters from right instead of starting at left.
  // - Use exact modulo wrap for perfect seamless loop (no micro back-forth on cycle).
  // - Avoid any layout reads or style recalcs during the animation loop (no thrashing).
  // - Keep full control: start/stop cleanly on league change, no mid-cycle restarts from width updates.
  const marqueeAnimationFrameRef = useRef(null)
  const marqueeOffsetRef = useRef(0)
  const marqueeLastTimeRef = useRef(0)
  const marqueeTrackWidthRef = useRef(0)
  const marqueeWindowWidthRef = useRef(0)
  const marqueeSpeedRef = useRef(110) // px per second - matches previous visual speed
  const lastMeasuredLeagueIdRef = useRef(null)

  // Stop any running marquee rAF loop. Called on unmount, league switch, !ready, etc.
  function stopMarqueeAnimation() {
    if (marqueeAnimationFrameRef.current) {
      window.cancelAnimationFrame(marqueeAnimationFrameRef.current)
      marqueeAnimationFrameRef.current = null
    }
    marqueeLastTimeRef.current = 0
  }

  // Start (or restart) the rAF-driven marquee.
  // Must have widths in the *Refs already (from measurement).
  function startMarqueeAnimation() {
    stopMarqueeAnimation()
    const W = marqueeTrackWidthRef.current
    if (!W) {
      return
    }
    // The offset in the ref was already set in measureAndStartMarquee (to Vw for new league,
    // or preserved progress for same league with length change). Do not override here.
    marqueeLastTimeRef.current = 0

    // Always grab the *current* element from the ref. This prevents stale element
    // issues when the keyed track div remounts on league change.
    const track = runtimeMarqueeTrackRef.current
    if (track) {
      // Prime using the (possibly preserved) offset already in the ref.
      const initial = marqueeOffsetRef.current || 0
      track.style.setProperty('--marquee-offset', `${initial}px`)
      track.style.willChange = 'transform'
    }

    const tick = (ts) => {
      if (!marqueeLastTimeRef.current) {
        marqueeLastTimeRef.current = ts
      }
      // dt in seconds, clamp to avoid huge jumps after tab sleep etc.
      const dt = Math.min((ts - marqueeLastTimeRef.current) / 1000, 0.1)
      marqueeLastTimeRef.current = ts

      let offset = marqueeOffsetRef.current - marqueeSpeedRef.current * dt
      const startX = marqueeWindowWidthRef.current || 0
      const minX = startX - W
      if (offset <= minX) {
        // Seamless wrap: because we render 2x the items (seamlessMarqueeGames),
        // shifting by exactly one copy width lands the duplicate in the identical visual spot.
        offset += W
      }
      marqueeOffsetRef.current = offset

      // Always use the live ref here too. Update via --var (not direct transform) so
      // React re-renders during ticker do not reset the position to left (0).
      const liveTrack = runtimeMarqueeTrackRef.current
      if (liveTrack) {
        liveTrack.style.setProperty('--marquee-offset', `${offset}px`)
      }
      marqueeAnimationFrameRef.current = window.requestAnimationFrame(tick)
    }

    marqueeAnimationFrameRef.current = window.requestAnimationFrame(tick)
  }

  // === Logo cache helpers ===
  async function loadLeagueLogoMeta(leagueId) {
    if (!leagueId) return;
    try {
      const res = await fetch(`/api/v1/logos/meta/${encodeURIComponent(leagueId)}`);
      if (!res.ok) return;
      const meta = await res.json();
      setLeagueLogoMetaById((current) => ({
        ...current,
        [leagueId]: meta,
      }));
    } catch (err) {
      console.warn('Failed to load logo meta:', err);
    }
  }

  async function enrichTeamsForLogoSync(league, basicTeams) {
    if (!league || !Array.isArray(basicTeams) || basicTeams.length === 0) return basicTeams;

    const params = parseLeagueApiParams(league.url || '');
    const sport = params.sport || '';
    const leagueSlug = params.league || String(league.id || '').toLowerCase();

    const isFootball = sport === 'football';
    const isRacingOrIndividual = isIndividualSport(sport, leagueSlug);

    // Enrichment is still useful for football and racing/individual sports.
    // It pulls better primary logo URLs + colors from the detailed ESPN endpoint.
    if (!isFootball && !isRacingOrIndividual) {
      return basicTeams;
    }

    const total = basicTeams.length;
    console.log(`[logo-enrich] Starting rich logo fetch for ${leagueSlug} (${total} teams)`);

    const enriched = [...basicTeams];
    let done = 0;

    for (let i = 0; i < enriched.length; i++) {
      const team = enriched[i];
      done += 1;

      // Show live progress in the syncing area
      setLogoSyncingLeagues((prev) => ({
        ...prev,
        [league.id]: `Fetching logos for ${leagueSlug}… ${done}/${total}`,
      }));

      try {
        const url = `/api/v1/espn/team-logos?team=${encodeURIComponent(team.id)}&league=${encodeURIComponent(leagueSlug)}&sport=${sport}&cache_ttl_seconds=600`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const richLogos = Array.isArray(data?.logos) ? data.logos.filter((l) => l?.href) : [];

          if (richLogos.length > 0) {
            // Replace with the much richer set from the core API
            enriched[i] = {
              ...team,
              logos: richLogos,
              // Also take better colors if the detailed endpoint had them
              color: data?.teamProfile?.color || team.color || '',
              alternateColor: data?.teamProfile?.alternateColor || team.alternateColor || '',
            };
          }
        }
      } catch (err) {
        console.warn(`[logo-enrich] Failed to get rich logos for ${team.abbreviation || team.id}`, err);
      }

      // Be nice to ESPN
      await new Promise((r) => setTimeout(r, 140));
    }

    return enriched;
  }

  async function triggerLogoCacheForLeague(leagueId, teams) {
    if (!leagueId || !Array.isArray(teams) || teams.length === 0) return;

    setLogoSyncingLeagues((prev) => ({ ...prev, [leagueId]: true }));

    try {
      await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teams),
      });
      await loadLeagueLogoMeta(leagueId);
    } catch (err) {
      console.warn('Logo cache trigger failed:', err);
    } finally {
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev };
        delete copy[leagueId];
        return copy;
      });
    }
  }

  /**
   * Per-team "get the extra logos" action.
   * Fetches the current full logo list from ESPN for just this one team,
   * then tells the backend to download/cache the variants locally.
   * After success we reload the league meta so the new files appear in the
   * "Local Cached Logos" list and can be chosen as preferred_variant.
   */
  async function downloadExtrasForTeam(league, team) {
    if (!league?.id || !team?.id) return;

    const leagueId = league.id;
    const teamId = String(team.id);
    const params = parseLeagueApiParams(league.url || '');

    setLogoSyncingLeagues((prev) => ({
      ...prev,
      [leagueId]: `Downloading extra variants for ${team.abbreviation || team.name || teamId}…`,
    }));

    try {
      // Get the richest possible logo set for this one team.
      // We prioritize data that already succeeded when you opened the team page,
      // plus the league teams list (very rich for college). We treat the direct
      // single-team /team-logos call as best-effort only because some college
      // team IDs (like 2025) return 404 on the detailed endpoint.
      let richLogos = [];

      const cacheKey = `${league.id}:${team.id}`;
      const alreadyLoaded = teamLogoDetailsByKey[cacheKey];

      // 1. Use whatever rich data we already successfully loaded when you clicked into this team.
      // This is the most reliable source right now.
      if (alreadyLoaded) {
        const fromLoaded = (alreadyLoaded.primary || []).concat(alreadyLoaded.extras || []);
        if (Array.isArray(fromLoaded)) richLogos.push(...fromLoaded);
      }

      if (params.league) {
        // 2. Best-effort detailed team call (can 404 for some college IDs — we swallow it)
        try {
          const query = new URLSearchParams({
            sport: params.sport || '',
            league: params.league,
            team: teamId,
            cache_ttl_seconds: '60',
          });
          const detailRes = await fetch(`/api/v1/espn/team-logos?${query.toString()}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const fromDetail = detail?.logos || (detail?.teamProfile && detail.teamProfile.logos) || [];
            if (Array.isArray(fromDetail)) richLogos.push(...fromDetail);
          }
          // If 404 or error, we just continue — we have the alreadyLoaded + teams list below
        } catch (e) { /* ignore 404s and network issues for this source */ }

        // 3. Pull from the full league teams list — this is often the best source for
        // "tons" of college variants (conference, old logos, etc.) that the single-team call misses.
        try {
          const teamsUrl = `/api/v1/espn/teams?sport=${encodeURIComponent(params.sport || '')}&league=${encodeURIComponent(params.league)}&cache_ttl_seconds=300`;
          const teamsRes = await fetch(teamsUrl);
          if (teamsRes.ok) {
            const teamsPayload = await teamsRes.json();
            const allTeams = teamsPayload?.sports?.[0]?.leagues?.[0]?.teams || [];
            const match = allTeams.find((t) => {
              const teamObj = t?.team || t;
              return String(teamObj?.id) === teamId ||
                     String(teamObj?.abbreviation || '').toUpperCase() === String(team.abbreviation || '').toUpperCase();
            });
            if (match) {
              const teamObj = match?.team || match;
              const fromList = teamObj?.logos || [];
              if (Array.isArray(fromList)) richLogos.push(...fromList);
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Dedupe by href
      const seenHrefs = new Set();
      const combined = [];
      for (const l of richLogos) {
        if (l?.href && !seenHrefs.has(l.href)) {
          seenHrefs.add(l.href);
          combined.push(l);
        }
      }
      richLogos = combined;

      // Absolute last fallback to whatever the grid had
      if (richLogos.length === 0 && Array.isArray(team.logos)) {
        richLogos = team.logos.filter((l) => l?.href);
      }

      const payload = {
        logos: richLogos,
        abbreviation: team.abbreviation,
        displayName: team.name || team.displayName,
        color: team.color,
        alternateColor: team.alternateColor,
      };

      const res = await fetch(
        `/api/v1/logos/cache/${encodeURIComponent(leagueId)}/team/${encodeURIComponent(teamId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn('Per-team extras cache failed', res.status, txt);
        setNotice(`Failed to download extras for this team (server error ${res.status}). Check backend logs.`);
      }

      // Refresh meta so new variants appear in the cached list immediately
      await loadLeagueLogoMeta(leagueId);
    } catch (err) {
      console.warn('downloadExtrasForTeam failed:', err);
      setNotice('Failed to download extra logos for this team.');
    } finally {
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev };
        delete copy[leagueId];
        return copy;
      });
    }
  }

  function getCachedOrRemoteLogo(leagueId, team, preferredVariant = null) {
    const meta = leagueLogoMetaById[leagueId];
    if (!meta || !meta.teams) return null;

    let cachedTeam = meta.teams[String(team.id)];

    // Fallback: search by abbreviation (common when the stored team value is the abbr like "UGA")
    if (!cachedTeam) {
      const upper = String(team.abbreviation || team.id || '').trim().toUpperCase();
      cachedTeam = Object.values(meta.teams).find(t =>
        String(t?.abbreviation || '').trim().toUpperCase() === upper
      );
    }

    if (!cachedTeam || !cachedTeam.logos) return null;

    if (preferredVariant && cachedTeam.logos[preferredVariant]) {
      return `/logos/${cachedTeam.logos[preferredVariant]}`;
    }

    const logos = cachedTeam.logos;
    const preferredOrder = ['scoreboard', 'default', 'dark', 'full'];
    for (const v of preferredOrder) {
      if (logos[v]) {
        return `/logos/${logos[v]}`;
      }
    }

    const first = Object.values(logos)[0];
    return first ? `/logos/${first}` : null;
  }
  // === End logo cache helpers ===

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

        // Automatically ensure recommended Raspberry Pi Chromium flags are present.
        // This makes the good defaults appear in the UI without the user having to do anything.
        const currentFlags = Array.isArray(payload?.kiosk?.chromiumFlags) ? payload.kiosk.chromiumFlags : []
        const mergedFlags = addRecommendedPiFlags(currentFlags)

        if (mergedFlags.length !== currentFlags.length) {
          const updatedPayload = {
            ...payload,
            kiosk: {
              ...payload.kiosk,
              chromiumFlags: mergedFlags,
            },
          }
          setConfig(updatedPayload)
          setSavedConfig(updatedPayload)
          configRef.current = updatedPayload
          // Persist the improved defaults so the good Pi flags survive restarts
          fetch('/api/v1/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedPayload),
          }).catch(() => {})
        } else {
          setConfig(payload)
          setSavedConfig(payload)
          configRef.current = payload
        }
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
  const themeTokens = config ? deriveThemeTokens(config.theme, { sportsBoard, leagueLogoMetaById }) : null
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
    const racingTopPrimaryLabel = nextRace?.label
      ? 'NEXT RACE'
      : String(game?.state || '').toLowerCase() === 'post'
        ? 'FINAL'
        : 'RACE STATUS'
    const racingTopPrimaryText = nextRace?.label
      ? `${nextRace.label}${nextRace.dateText ? ` • ${nextRace.dateText}` : ''}`
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
    : (activeRuntimePayload ? [] : runtimeLastStableMarqueeGames)
  const seamlessMarqueeGames = runtimeMarqueeGames.length > 0 ? [...runtimeMarqueeGames, ...runtimeMarqueeGames] : runtimeMarqueeGames
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
  }, [runtimeDisplayLeague?.id, runtimeDisplayGames.length]) // use length to avoid re-running on every render (runtimeDisplayGames is a fresh array every time)

  async function loadLeagueScoreboardWithSettings(league, {
    cacheTtlSeconds = 30,
    gameFilterOverride = null,
    useWeekFilterOverride = null,
  } = {}) {
    const query = buildTickerScoreboardQuery(league, {
      cacheTtlSeconds,
      gameFilterOverride,
      useWeekFilterOverride,
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

    // Load cached logo meta for all enabled runtime leagues so we can use
    // modern cached colors/logos (legacy teamStyles in config.json is gone)
    runtimeLeagues.forEach((league) => {
      if (!leagueLogoMetaById[league.id]) {
        loadLeagueLogoMeta(league.id)
      }
    })

    // Kick off payload loads for *all* enabled leagues in parallel immediately on ticker start.
    // This pre-populates data so that when rotation lands on a league, its content is
    // already available (no loading flash or delay), and lastStable can be set from good
    // leagues even if the initial display league is empty.
    runtimeLeagues.forEach((league) => {
      if (!runtimePayloadByLeagueId[league.id]) {
        refreshRuntimeLeaguePayload(league).catch(() => {})
      }
    })
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

  useLayoutEffect(() => {
    // Always reset ready at the start of measurement for this league/render.
    // This ensures the JS rAF scroller + gpu styles are only applied after we have
    // fresh accurate measurements for the *current* content. Prevents starting with 0/wrong widths.
    setRuntimeScrollReady(false)
    stopMarqueeAnimation()

    if (!isTickerRuntime || !runtimeDisplayLeague || !runtimeMarqueeGames.length) {
      setRuntimeScrollSeconds(45)
      // Ensure clean state: no lingering offset when blank or no league.
      if (runtimeMarqueeTrackRef.current) {
        runtimeMarqueeTrackRef.current.style.setProperty('--marquee-offset', '')
        runtimeMarqueeTrackRef.current.style.willChange = ''
      }
      return
    }

    const measureAndStartMarquee = () => {
      const track = runtimeMarqueeTrackRef.current
      if (!track) {
        return
      }

      const windowEl = runtimeMarqueeWindowRef.current
      const fullTrackWidth = track.scrollWidth || track.getBoundingClientRect().width || 0
      // Use actual measured container width if available. Fall back to the configured
      // monitor width (e.g. 1920 or 3840 for bar displays). This prevents Vw=0 which
      // would make the initial offset 0 and cause "starts on the left" instead of
      // content entering from the right.
      const configuredWidth = Number(config?.monitor?.width) || 1920
      const windowWidth = windowEl?.clientWidth || windowEl?.getBoundingClientRect().width || configuredWidth
      if (!fullTrackWidth) {
        // For complex cards (esp racing/F1/NASCAR with inner content, entries lists, etc.)
        // the layout may not be ready at the first useLayoutEffect. Retry shortly so
        // the scroller actually starts instead of staying "empty" or "stuck".
        setTimeout(() => {
          if (runtimeMarqueeTrackRef.current && !runtimeScrollReadyRef.current) {
            measureAndStartMarquee()
          }
        }, 120)
        return
      }

      // More accurate oneCopy: use the actual layout offset of the start of the second copy
      // instead of naive /2. This accounts for gaps, padding, subpixel, and exact flex layout.
      let oneCopyWidth = Math.max(1, fullTrackWidth / 2)
      const kids = track.children
      const mid = Math.floor(kids.length / 2)
      if (kids.length > 1 && kids[mid] && kids[mid].offsetLeft > 0) {
        oneCopyWidth = Math.max(1, kids[mid].offsetLeft)
      }

      // If the league id is the same as last measurement but the number of items (length) changed,
      // preserve the scroll progress instead of jumping back to the "start from right" position.
      // This prevents visible "restarts over and over" when the list of games for the current league
      // changes (e.g. a game starts/ends, or live updates add/remove for racing leagues).
      const currentLeagueId = runtimeDisplayLeague?.id
      const lastId = lastMeasuredLeagueIdRef.current
      const oldW = marqueeTrackWidthRef.current
      const currentOffset = marqueeOffsetRef.current
      if (currentLeagueId && currentLeagueId === lastId && oldW > 0 && typeof currentOffset === 'number') {
        const startX = windowWidth
        const scrolled = startX - currentOffset
        const fraction = oldW > 0 ? scrolled / oldW : 0
        const newOffset = startX - fraction * oneCopyWidth
        marqueeOffsetRef.current = newOffset
      } else {
        // new league (or first), start from the enter-from-right position
        marqueeOffsetRef.current = windowWidth
      }
      lastMeasuredLeagueIdRef.current = currentLeagueId

      setRuntimeTrackWidth(oneCopyWidth)
      setRuntimeWindowWidth(windowWidth)
      // secs kept for any debug/UI, but speed comes from pxPerSecond now.
      const pxPerSecond = 110
      const nextSeconds = Math.max(12, oneCopyWidth / pxPerSecond)
      const secs = Number(nextSeconds.toFixed(1))
      setRuntimeScrollSeconds(secs)

      // Store in refs for the rAF loop (no closure staleness, no re-renders needed for anim).
      marqueeTrackWidthRef.current = oneCopyWidth
      marqueeWindowWidthRef.current = windowWidth
      marqueeSpeedRef.current = pxPerSecond

      // Direct DOM mutation *before paint* (useLayoutEffect) for correct initial state.
      // We still set the -- vars (harmless, may be used by future CSS or debug).
      if (track) {
        track.style.setProperty('--runtime-scroll-seconds', `${secs}s`)
        track.style.setProperty('--runtime-track-width', `${oneCopyWidth}px`)
        track.style.setProperty('--runtime-window-width', `${windowWidth}px`)
      }

      // Set initial offset (via var) to the "content entering from right" position immediately.
      // This + the rAF starting from same value eliminates the "starts already scrolled to end/left" bug.
      // Using --var (not direct transform) protects against React re-render clobbers.
      const initialOffset = windowWidth
      track.style.setProperty('--marquee-offset', `${initialOffset}px`)
      track.style.willChange = 'transform'

      setRuntimeScrollReady(true)

      // Kick off the rAF JS animation. This replaces the old CSS keyframes entirely for the scroll motion.
      startMarqueeAnimation()

      // Belt + suspenders for the "starts on the left" problem:
      // After React re-renders (which applies the style= prop with the --vars) and after
      // any late layout from images/flex/viewport units, force the initial right-offset
      // transform one more time on the next frame.
      window.requestAnimationFrame(() => {
        const liveTrack = runtimeMarqueeTrackRef.current
        const off = marqueeWindowWidthRef.current || 0
        if (liveTrack && off > 0) {
          liveTrack.style.setProperty('--marquee-offset', `${off}px`)
        }
      })
    }

    if (typeof ResizeObserver === 'undefined') {
      measureAndStartMarquee()
      return undefined
    }

    const observer = new ResizeObserver(() => {
      if (!runtimeScrollReadyRef.current) {
        window.requestAnimationFrame(measureAndStartMarquee)
      }
    })

    if (runtimeMarqueeTrackRef.current) {
      observer.observe(runtimeMarqueeTrackRef.current)
    }
    if (runtimeMarqueeWindowRef.current) {
      observer.observe(runtimeMarqueeWindowRef.current)
    }

    measureAndStartMarquee()

    // Disconnect immediately after initial measurement so that resizes during the
    // long animation (live score updates inside cards, etc.) do not retrigger measurement
    // or restart the scroller. Next league (or length change) gets a fresh pass.
    // This was already the intent; now even more important because we own the anim loop.
    observer.disconnect()

    return () => {
      observer.disconnect()
      stopMarqueeAnimation()
    }
  }, [isTickerRuntime, runtimeDisplayLeague?.id, runtimeMarqueeGames.length]) // eslint-disable-line react-hooks/exhaustive-deps -- narrow deps by design (id+length only) to prevent re-measuring/restarting marquee on every render or object identity churn. startMarqueeAnimation is an inner function decl.

  // Lifecycle for the JS marquee scroller: ensure we stop rAF when leaving ticker mode,
  // when scroll not ready (e.g. during re-measure on league switch), or on unmount.
  // The start is triggered from the measurement code above once widths are known.
  useEffect(() => {
    if (!isTickerRuntime || !runtimeScrollReady) {
      stopMarqueeAnimation()
    }
    return () => {
      stopMarqueeAnimation()
    }
  }, [isTickerRuntime, runtimeScrollReady, runtimeDisplayLeague?.id])

  useEffect(() => {
    if (!isTickerRuntime || runtimeLeagues.length <= 1 || !sportsBoard) {
      return
    }

    const rotateSeconds = Math.max(5, Number(sportsBoard.rotateSeconds) || 45)
    const intervalId = window.setInterval(() => {
      // Clear any "visible league pin" so the rotation index drives the next active league.
      // Without this, once visibleLeagueId was set (on first successful load), runtimeDisplayLeague
      // would always prefer the pinned visible over activeRuntimeLeague from the cycling index.
      // Result: rotation would appear to do nothing, only one league would ever show/repeat.
      setRuntimeVisibleLeagueId('')
      setRuntimeLeagueIndex((current) => (current + 1) % runtimeLeagues.length)
    }, rotateSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [isTickerRuntime, runtimeLeagueIdsKey, runtimeLeagues.length, sportsBoard])

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

      setRuntimeLoadStateByLeagueId((current) => ({
        ...current,
        [league.id]: { loading: false, error: '' },
      }))

      let finalPayload = payload
      let gameCount = Array.isArray(payload?.normalizedGames) ? payload.normalizedGames.length : 0

      // === FallbackWhenEmpty behavior (user-requested) ===
      // If the league has the checkbox on AND we got zero games with the (possibly strict) filter,
      // re-fetch once with a relaxed filter so the ticker doesn't go blank or auto-skip the league.
      const wantsFallback = Boolean(league?.fallbackWhenEmpty)
      if (gameCount === 0 && wantsFallback) {
        const originalFilter = league?.gameFilter || 'all'
        const relaxedFilter = getRelaxedGameFilter(originalFilter)

        if (relaxedFilter !== originalFilter) {
          try {
            const relaxedPayload = await loadLeagueScoreboardWithSettings(league, {
              cacheTtlSeconds: fallbackCacheTtlSeconds,
              gameFilterOverride: relaxedFilter,
              useWeekFilterOverride: league?.useWeekFilter ?? false,
            })

            const relaxedCount = Array.isArray(relaxedPayload?.normalizedGames) ? relaxedPayload.normalizedGames.length : 0
            if (relaxedCount > 0) {
              finalPayload = {
                ...relaxedPayload,
                _fallbackApplied: true,
                _originalGameFilter: originalFilter,
                _relaxedGameFilter: relaxedFilter,
              }
              gameCount = relaxedCount
            }
          } catch {
            // If the relaxed fetch fails we just keep the empty payload.
          }
        }
      }

      if (gameCount > 0 && (!runtimeVisibleLeagueId || runtimeVisibleLeagueId === league.id)) {
        setRuntimeVisibleLeagueId(league.id)
      }

      // Only auto-advance to the next league when we truly have nothing (and fallback didn't save us).
      if (gameCount === 0 && runtimeLeagues.length > 1) {
        const currentIndex = runtimeLeagues.findIndex((item) => item.id === league.id)
        const nextIndex = findNextLeagueIndexInOrder(
          currentIndex,
          runtimeLeagues,
          {
            ...runtimePayloadRef.current,
            [league.id]: finalPayload,
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
          return finalPayload
        }
      }

      // Store the (possibly relaxed) payload for runtime + preview
      setRuntimePayloadByLeagueId((current) => ({
        ...current,
        [league.id]: finalPayload,
      }))

      return finalPayload
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

    // Ensure we have cached logo/color data for the current runtime league
    if (!leagueLogoMetaById[runtimeDisplayLeague.id]) {
      loadLeagueLogoMeta(runtimeDisplayLeague.id)
    }
  }, [isTickerRuntime, runtimeDisplayLeague?.id])

  // Measure the watermark image and compute a good size so it looks big but doesn't
  // get cut off at top/bottom on tall logos (UGA etc.) in the short ticker bar.
  useEffect(() => {
    if (!tickerWatermarkUrl) {
      setTickerWatermarkSize('82%')
      return
    }

    const img = new Image()
    img.onload = () => {
      const boardH = Number(config?.monitor?.height) || 380
      // For a sparse elegant pattern ("just a few" larger logos with breathing room),
      // target the logo to occupy a large portion of the ticker height.
      const targetHeight = boardH * 0.85
      let sizePercent = (targetHeight / img.naturalHeight) * 100

      // Wider range for sparse look: bigger logos, more space between repeats
      sizePercent = Math.max(60, Math.min(95, sizePercent))

      setTickerWatermarkSize(`${sizePercent.toFixed(0)}%`)
    }
    img.src = tickerWatermarkUrl
  }, [tickerWatermarkUrl, config?.monitor?.height])

  // Load the logo meta for the Theme page's selected "Team league" (if any) so that buildThemeTeamOptions
  // can populate the Teams dropdown from the cached team styles/colors. This runs on mount and when
  // the configured teamTheme.league changes. Fixes empty teams dropdown for NCAA Football etc.
  useEffect(() => {
    const token = String(config?.theme?.teamTheme?.league || '').trim().toLowerCase()
    if (!token) return
    const leagues = Array.isArray(sportsBoard?.leagues) ? sportsBoard.leagues : []
    const league = leagues.find((entry) => {
      const id = String(entry?.id || '').trim().toLowerCase()
      const name = String(entry?.name || '').trim().toLowerCase()
      return token === id || token === name
    })
    const leagueId = league?.id
    if (leagueId && !leagueLogoMetaById[leagueId]) {
      loadLeagueLogoMeta(leagueId)
    }
  }, [config?.theme?.teamTheme?.league, sportsBoard])

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
      const params = parseLeagueApiParams(league.url)
      const isRacingOrIndividual = isIndividualSport(params.sport, params.league)

      const teamsUrl = toLeagueTeamsEndpoint(league.url)
      const response = await fetch(buildEspnProxyUrl(teamsUrl, 300))
      if (!response.ok) {
        throw new Error(`Teams fetch failed with ${response.status}`)
      }

      const payload = await response.json()
      let teams = normalizeTeamDataFromTeamsEndpoint(payload)

      // For racing leagues (NASCAR, F1, etc.) and other individual sports, use dedicated harvesting
      // that pulls both teams (constructors) and athletes/drivers where available.
      if (isRacingOrIndividual) {
        try {
          const racingEntities = await harvestRacingEntities(league)
          if (racingEntities.length > 0) {
            // Merge with any teams we already got, preferring richer data
            const byId = new Map(teams.map((t) => [String(t.id), t]))
            for (const ent of racingEntities) {
              const key = String(ent.id)
              if (!byId.has(key)) {
                byId.set(key, ent)
              } else {
                const existing = byId.get(key)
                if ((ent.logos || []).length > (existing.logos || []).length) {
                  byId.set(key, { ...existing, ...ent })
                }
              }
            }
            teams = Array.from(byId.values())
          }
        } catch (e) {
          console.warn('harvestRacingEntities failed (non-fatal)', e)
        }
      } else if (!teams.length) {
        // Original fallback for non-racing leagues
        try {
          const scoreboardResponse = await fetch(buildEspnProxyUrl(league.url, 60))
          if (scoreboardResponse.ok) {
            const scoreboardPayload = await scoreboardResponse.json()
            teams = normalizeTeamDataFromScoreboard(scoreboardPayload)
          }
        } catch (e) {
          console.warn('Athlete harvest from scoreboard failed (non-fatal)', e)
        }
      }

      // Final fallback for completely empty
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

      // Legacy teamStyles writes removed. Logos/colors now live exclusively in the local cache.

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

  // (The three functions above were moved earlier in App() to fix TDZ)

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
        // The preview now respects the league's gameFilter / useWeekFilter automatically
        // via buildTickerScoreboardQuery. We can add explicit overrides here later if needed.
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
          // Sensible defaults for the revived server-side filters
          gameFilter: 'all',
          useWeekFilter: false,
          fallbackWhenEmpty: false,
          includedTeams: [],
          includedGroups: [],
          cardStyle: 'standard',
          // (no teamStyles — colors/logos come from the local cache system only)
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

  // (tickerWatermarkUrl is now computed with useMemo above for stable references)

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
    '--ticker-watermark-size': tickerWatermarkSize  // height-based; larger % = bigger individual logos, fewer repeats, more elegant/sparse look
  }

  if (isTickerRuntime) {
    const runtimeBoardWidth = Math.max(320, Number(config?.monitor?.width) || 1920)
    const runtimeBoardHeight = Math.max(120, Number(config?.monitor?.height) || 380)
    const hasEnabledRuntimeLeagues = runtimeLeagues.length > 0

    // Sparse elegant watermark positions — deliberately only a few large logos with good breathing room
    let watermarkPositions = 'center'
    let watermarkImages = 'none'

    if (tickerWatermarkUrl) {
      const url = `url(${tickerWatermarkUrl})`

      if (runtimeBoardWidth > 3000) {
        // Very wide boards (3840 etc.) — 4 logos, nicely spread
        watermarkPositions = '8% center, 30% center, 70% center, 92% center'
        watermarkImages = `${url}, ${url}, ${url}, ${url}`
      } else if (runtimeBoardWidth > 1800) {
        // Standard 1920-wide — only 2 logos, spread well toward the edges
        watermarkPositions = '12% center, 88% center'
        watermarkImages = `${url}, ${url}`
      } else {
        // Narrower boards — 2 logos
        watermarkPositions = '15% center, 85% center'
        watermarkImages = `${url}, ${url}`
      }
    }

    return (
      <main className={`ticker-runtime-shell ${themeTokens.modeClass}`} style={shellStyle}>
        {!hasEnabledRuntimeLeagues ? (
          <p className="ticker-runtime-empty">Enable at least one league.</p>
        ) : (
          <section
            className="ticker-runtime-board"
            style={{
              width: '100%',
              maxWidth: `${runtimeBoardWidth}px`,
              height: '100%',
              '--ticker-watermark-images': watermarkImages,
              '--ticker-watermark-positions': watermarkPositions,
            }}
          >
            <div className="ticker-runtime-marquee-window" ref={runtimeMarqueeWindowRef}>
              <div
                key={`marquee-${runtimeRenderLeague?.id || 'none'}`}
                className={`ticker-runtime-track ${runtimeScrollReady ? 'ticker-runtime-track-animated' : ''}`}
                ref={runtimeMarqueeTrackRef}
                role="list"
                aria-label="Ticker games"
                style={runtimeScrollReady ? {
                  '--runtime-scroll-seconds': `${runtimeScrollSeconds}s`,
                  '--runtime-track-width': `${Math.max(1, runtimeTrackWidth)}px`,
                  '--runtime-window-width': `${Math.max(1, runtimeWindowWidth)}px`,
                  // Include current to ensure the var is present after React style updates on re-renders;
                  // rAF continues to drive the live value without jumps.
                  '--marquee-offset': `${marqueeOffsetRef.current || 0}px`,
                } : undefined}
              >
                {seamlessMarqueeGames.map((game, index) => {
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
                    ? allRacingEntries.slice(3, 15)   // show more for NASCAR-style races (was limited before)
                    : allRacingEntries.slice(0, isSoloSlate ? 16 : 6)

                  return (
                    <article
                      key={`${game.id || `${away?.id}-${home?.id}-${game?.startTimeUtc || ''}`}-${index}`}
                      className={`ticker-runtime-card ticker-runtime-card-sport-${sportToken} ticker-runtime-card-state-${stateToken} ticker-runtime-card-style-${game.cardStyle || 'standard'}${isSoloSlate ? ' ticker-runtime-card-solo' : ''}${isDuoSlate ? ' ticker-runtime-card-duo' : ''}${game?.isRacing ? ' ticker-runtime-card-racing' : ''}${game?.isRacing && isSoloSlate ? ' ticker-runtime-card-racing-solo' : ''}${game?.isLiveFeatured ? ` ticker-runtime-card-live ticker-runtime-card-live-${game.liveTheme || 'generic'}` : ''}${game?.useTeamCardColors ? ' ticker-runtime-card-use-team-colors' : ''}`}
                      style={runtimeCardStyle(game, game?.useTeamCardColors)}
                      role="listitem"
                      data-card-style={game.cardStyle || 'standard'}
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
                            {game?.racingTopInfo?.tv ? (
                              <div className="ticker-runtime-racing-head-side" aria-label="Race schedule and TV">
                                <p className="ticker-runtime-racing-head-line ticker-runtime-racing-head-tv">
                                  <span>TV</span>
                                  <strong>{String(game.racingTopInfo.tv).replace(/^TV\s+/, '')}</strong>
                                </p>
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
                        game.cardStyle === 'large-logo' ? (
                          // Large Logo theme (MLB reference + user spec): completely different from Standard.
                          // Live: stacked large logos (away top) left + team-colored score box + diamond + inning/arrow + count + 3 yellow outs.
                          // Postgame final: large left logo (dominant) with FINAL label at top, score at bottom, second logo on right.
                          <div className="ticker-runtime-ll">
                            {String(game?.state || '').toLowerCase() === 'in' && game.baseballLiveData ? (
                              <div className="ll-live">
                                {/* Left: large logos stacked vertically (visitor/away on top) */}
                                <div className="ll-logos">
                                  <div className="ll-logo ll-away">
                                    {awayLogo ? (
                                      <img src={awayLogo} alt={runtimeTeamName(away)} />
                                    ) : (
                                      <span className="ll-badge">{awayBadge}</span>
                                    )}
                                  </div>
                                  <div className="ll-logo ll-home">
                                    {homeLogo ? (
                                      <img src={homeLogo} alt={runtimeTeamName(home)} />
                                    ) : (
                                      <span className="ll-badge">{homeBadge}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Team colored score box (two bands using team primary colors) */}
                                <div className="ll-scorebox">
                                  <div
                                    className="ll-score ll-away-score"
                                    style={away?.palette?.primary ? { backgroundColor: away.palette.primary, color: '#fff' } : {}}
                                  >
                                    {away?.score ?? '-'}
                                  </div>
                                  <div
                                    className="ll-score ll-home-score"
                                    style={home?.palette?.primary ? { backgroundColor: home.palette.primary, color: '#fff' } : {}}
                                  >
                                    {home?.score ?? '-'}
                                  </div>
                                </div>

                                {/* Diamond left, compact meta (inning | count + outs under count) right of it — text stays at diamond height, not low in card */}
                                <div className="ll-side">
                                  <div className="ll-baseball-field">
                                    {/* Simple brown infield (dirt) as a visual layer underneath the bases */}
                                    <div className="ll-infield"></div>

                                    {/* Bases using the explicit top/left positioning from the CodePen you provided (direct children of the field) */}
                                    <div className="base" id="second-base"></div>
                                    <div className="base" id="first-base"></div>
                                    <div className="base" id="third-base"></div>
                                  </div>

                                  <div className="ll-meta">
                                    <div className="ll-inning-count">
                                      <div className="ll-inning">
                                        {game.baseballLiveData?.inning || '?'}
                                        <span className="ll-arrow">
                                          {(game.baseballLiveData?.halfInning || '').toLowerCase().startsWith('top') ? '▲' : '▼'}
                                        </span>
                                      </div>
                                      <div className="ll-count">
                                        {game.baseballLiveData?.balls ?? 0}-{game.baseballLiveData?.strikes ?? 0}
                                      </div>
                                    </div>
                                    <div className="ll-outs">
                                      {[0, 1, 2].map((i) => (
                                        <span
                                          key={i}
                                          className={`ll-out ${i < (game.baseballLiveData?.outs || 0) ? 'filled' : ''}`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : String(game?.state || '').toLowerCase() === 'post' ? (
                              /* FINAL — "FINAL" at very top of card, two large logos, score centered at bottom middle */
                              <div className="ll-final">
                                <div className="ll-final-top">FINAL</div>

                                <div className="ll-final-logos">
                                  <div className="ll-final-logo">
                                    {awayLogo ? (
                                      <img src={awayLogo} alt={runtimeTeamName(away)} />
                                    ) : (
                                      <span className="ll-badge ll-big">{awayBadge}</span>
                                    )}
                                  </div>
                                  <div className="ll-final-logo">
                                    {homeLogo ? (
                                      <img src={homeLogo} alt={runtimeTeamName(home)} />
                                    ) : (
                                      <span className="ll-badge ll-big">{homeBadge}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="ll-final-score-bottom">
                                  {away?.score ?? '-'} — {home?.score ?? '-'}
                                </div>
                              </div>
                            ) : (
                              /* Non-live / scheduled / preview / postponed etc. for Large Logo — fancy matchup treatment */
                              <div className="ll-scheduled">
                                <div className="ll-sched-logos">
                                  <div className="ll-logo ll-away ll-sched-logo">
                                    {awayLogo ? (
                                      <img src={awayLogo} alt={runtimeTeamName(away)} />
                                    ) : (
                                      <span className="ll-badge">{awayBadge}</span>
                                    )}
                                  </div>
                                  <div className="ll-sched-vs">VS</div>
                                  <div className="ll-logo ll-home ll-sched-logo">
                                    {homeLogo ? (
                                      <img src={homeLogo} alt={runtimeTeamName(home)} />
                                    ) : (
                                      <span className="ll-badge">{homeBadge}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="ll-sched-time">
                                  {game.runtimeDateText || 'TBD'}
                                </div>

                                {/* Only show interesting status (Postponed, Delayed, etc.) — never the generic "Scheduled" */}
                                {game?.status?.detail && !/scheduled|pre/i.test(String(game.status.detail)) ? (
                                  <div className="ll-sched-detail">{game.status.detail}</div>
                                ) : null}
                              </div>
                            )}
                          </div>
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
                        )
                      )}

                      <p className="ticker-runtime-meta">{game.cardInfo}</p>
                    </article>
                  )
                })}
              </div>
            </div>

            <footer className="ticker-runtime-lower" aria-label="Lower third">
              {/* Left: League / Bar brand */}
              <div className="ticker-runtime-lower-brand">
                {resolveLeagueLogo(runtimeRenderLeague, runtimePayloadByLeagueId[runtimeRenderLeague?.id]) ? (
                  <img
                    src={resolveLeagueLogo(runtimeRenderLeague, runtimePayloadByLeagueId[runtimeRenderLeague?.id])}
                    alt={runtimeRenderLeague?.name || 'Ticker'}
                  />
                ) : (
                  runtimeRenderLeague?.name || 'Ticker'
                )}
              </div>

              {/* Scrolling info area (sensors + future news) */}
              <div className="ticker-runtime-lower-scroll">
                <div className="ticker-runtime-lower-item">
                  {(homeAssistantBoard?.haSensors || []).length
                    ? homeAssistantBoard.haSensors.slice(0, 6).join('  •  ')
                    : 'Home Assistant sensors not configured'}
                  {/* Future: news items will be injected here and will scroll */}
                </div>
              </div>
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
              onClick={() => saveConfig(false)}
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
