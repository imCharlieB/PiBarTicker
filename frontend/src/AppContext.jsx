import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'

// ── Shared pure helpers (exported for App.jsx use) ──────────────────────────

export function parseLeagueApiParams(scoreboardUrl) {
  const match = String(scoreboardUrl || '').match(/\/sports\/([^/]+)\/([^/]+)\/scoreboard/i)
  if (!match) {
    return { sport: 'football', league: '' }
  }
  return { sport: match[1], league: match[2] }
}

export function isIndividualSport(sport, leagueSlug) {
  const s = (sport || '').toLowerCase()
  const l = (leagueSlug || '').toLowerCase()
  return (
    s === 'racing' || s === 'motorsports' || s === 'golf' || s === 'mma' || s === 'boxing' || s === 'tennis' ||
    /racing|motorsport|motogp|nascar|indy|indycar|wec|imsa|supercars|rally|f1|formula/.test(l)
  )
}

// ── Internal pure helpers (not exported) ────────────────────────────────────

const RECOMMENDED_PI_FLAGS = [
  '--kiosk',
  '--noerrdialogs',
  '--disable-infobars',
  '--force-device-scale-factor=1',
  '--enable-gpu-rasterization',
  '--ignore-gpu-blocklist',
  '--disable-smooth-scrolling',
  '--overscroll-history-navigation=0',
  '--disable-translate',
  '--disable-features=TranslateUI',
  '--ozone-platform=wayland',
  '--use-gl=egl',
  '--enable-features=OverlayScrollbar,VaapiVideoDecoder,WaylandWindowDecorations',
  '--disable-webgpu',
]

function addRecommendedPiFlags(currentFlags) {
  const existing = Array.isArray(currentFlags) ? currentFlags.map((f) => String(f).trim()) : []
  const toAdd = RECOMMENDED_PI_FLAGS.filter((flag) => !existing.includes(flag))
  if (toAdd.length === 0) return existing
  return [...existing, ...toAdd]
}

function buildEspnProxyUrl(targetUrl, cacheTtlSeconds = 120) {
  const params = new URLSearchParams({
    url: targetUrl,
    cache_ttl_seconds: String(cacheTtlSeconds),
  })
  return `/api/v1/espn/proxy?${params.toString()}`
}

function toLeagueTeamsEndpoint(scoreboardUrl) {
  if (!scoreboardUrl) return ''
  try {
    const parsed = new URL(scoreboardUrl)
    parsed.pathname = parsed.pathname.replace(/\/scoreboard$/i, '/teams')
    parsed.searchParams.set('limit', '1000')
    return parsed.toString()
  } catch {
    const base = scoreboardUrl.replace(/\/scoreboard(?:\?.*)?$/i, '/teams')
    return `${base}${base.includes('?') ? '&' : '?'}limit=1000`
  }
}

function selectTrustedTeamLogos(team, leagueId) {
  const rawLogos = Array.isArray(team?.logos)
    ? team.logos.filter((logo) => logo?.href)
    : team?.logo
      ? [{ href: team.logo, alt: team.displayName || team.name || team.abbreviation }]
      : []

  if (!rawLogos.length) return { primary: [], extras: [] }

  const leagueToken = String(leagueId || '').trim().toLowerCase()
  if (leagueToken !== 'nfl') return { primary: rawLogos, extras: [] }

  const canonical = rawLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: canonical.length ? canonical : rawLogos,
    extras: canonical.length
      ? rawLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

function normalizeTeamDataFromTeamsEndpoint(payload) {
  const teams = []
  const league = payload?.sports?.[0]?.leagues?.[0]
  const leagueTeams = league?.teams || []
  const leagueId = league?.abbreviation || league?.id || ''

  for (const entry of leagueTeams) {
    const team = entry?.team
    if (!team?.id) continue
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

function normalizeTeamDataFromScoreboard(payload) {
  const teams = new Map()
  const events = Array.isArray(payload?.events) ? payload.events : []

  for (const event of events) {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : []
    for (const competition of competitions) {
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : []
      for (const competitor of competitors) {
        const team = competitor?.team || {}
        const athlete = competitor?.athlete || {}
        const entity = team.id ? team : athlete.id ? athlete : null
        if (!entity || !entity.id) continue

        const isAthlete = !team.id && !!athlete.id
        let incomingLogos = Array.isArray(entity.logos)
          ? entity.logos
          : entity.logo
            ? [{ href: entity.logo, alt: entity.displayName || entity.name || entity.abbreviation }]
            : []

        if (incomingLogos.length === 0 && entity.flag?.href) {
          incomingLogos = [{ href: entity.flag.href, alt: entity.flag.alt || entity.displayName || 'Flag' }]
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
          _isAthlete: isAthlete,
        })
      }
    }
  }
  return Array.from(teams.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function harvestRacingEntities(league) {
  const entities = new Map()

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

  try {
    const p = parseLeagueApiParams(league.url || '')
    const sport = p.sport || 'racing'
    const leagueSlug = p.league || String(league.id || '').toLowerCase()

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

  if (resolvedSport) query.set('sport', resolvedSport)
  if (params.sport) query.set('sport', params.sport)

  const effectiveGameFilter = gameFilterOverride ?? league?.gameFilter ?? 'all'
  if (effectiveGameFilter && effectiveGameFilter !== 'all') {
    query.set('game_filter', effectiveGameFilter)
  }

  const effectiveUseWeek = useWeekFilterOverride ?? league?.useWeekFilter ?? false
  if (effectiveUseWeek) query.set('use_week_filter', 'true')

  if (gameFilterOverride !== 'all') {
    const includedTeams = Array.isArray(league?.includedTeams) ? league.includedTeams : []
    if (includedTeams.length) query.set('included_teams', includedTeams.join(','))

    const includedGroups = Array.isArray(league?.includedGroups) ? league.includedGroups : []
    if (includedGroups.length) query.set('included_groups', includedGroups.join(','))
  }

  return query.toString()
}

function getRelaxedGameFilter(originalFilter) {
  const f = String(originalFilter || 'all').toLowerCase()
  if (f === 'live' || f === 'today' || f === 'this-week') return 'upcoming'
  return 'all'
}

function splitTeamLogosForDisplay(logos, leagueId) {
  const safeLogos = Array.isArray(logos) ? logos.filter((logo) => logo?.href) : []
  const leagueToken = String(leagueId || '').trim().toLowerCase()
  if (leagueToken !== 'nfl') return { primary: safeLogos, extras: [] }
  const primary = safeLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: primary.length ? primary : safeLogos,
    extras: primary.length
      ? safeLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

function resolveLeagueLogo(league) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) return explicitLogo
  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) return ''
  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
}

const API_NATIVE_SPORT_FILTERS = new Set([
  'football', 'basketball', 'baseball', 'hockey', 'soccer',
  'golf', 'tennis', 'cricket', 'rugby', 'lacrosse',
])

const EDITABLE_PAGE_SEQUENCE = ['display', 'theme', 'services', 'ticker']

// ── Context ──────────────────────────────────────────────────────────────────

const AppContext = createContext(null)

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppContextProvider')
  return ctx
}

export function AppContextProvider({ children }) {
  // Routing detection — used by ticker rotation effects to gate themselves
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const explicitView = String(searchParams.get('view') || '').trim().toLowerCase()
  const isSetupRoute = pathname.startsWith('/setup') || explicitView === 'setup'
  const isTickerRoute =
    pathname === '/' ||
    pathname.startsWith('/ticker') ||
    pathname.startsWith('/runtime') ||
    explicitView === 'ticker' ||
    searchParams.get('kiosk') === '1'
  const isTickerRuntime = isTickerRoute && !isSetupRoute

  // ── Config state ────────────────────────────────────────────────────────
  const [config, setConfig] = useState(null)
  const [savedConfig, setSavedConfig] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [activePage, setActivePage] = useState('overview')

  // ── Logo cache state ────────────────────────────────────────────────────
  const [leagueLogoMetaById, setLeagueLogoMetaById] = useState({})
  const [logoSyncingLeagues, setLogoSyncingLeagues] = useState({})
  const [logoClearMessageById, setLogoClearMessageById] = useState({})

  // ── Setup data state ────────────────────────────────────────────────────
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

  // ── Runtime ticker state ────────────────────────────────────────────────
  const [runtimeLeagueIndex, setRuntimeLeagueIndex] = useState(0)
  const [runtimeVisibleLeagueId, setRuntimeVisibleLeagueId] = useState('')
  const [runtimePayloadByLeagueId, setRuntimePayloadByLeagueId] = useState({})
  const [runtimeLoadStateByLeagueId, setRuntimeLoadStateByLeagueId] = useState({})
  const [initialPreFetchesComplete, setInitialPreFetchesComplete] = useState(false)
  const [handoffCheckKey, setHandoffCheckKey] = useState(0)
  const [runtimeLastStableLeagueId, setRuntimeLastStableLeagueId] = useState('')
  const [runtimeLastStableMarqueeGames, setRuntimeLastStableMarqueeGames] = useState([])
  const [stableGoodGamesByLeagueId, setStableGoodGamesByLeagueId] = useState({})

  // ── Refs ────────────────────────────────────────────────────────────────
  const configRef = useRef(null)
  const runtimePayloadRef = useRef(runtimePayloadByLeagueId)
  const runtimeLoadStateRef = useRef(runtimeLoadStateByLeagueId)
  const tickerEntryGraceRef = useRef(0)
  const currentLeaguesLengthRef = useRef(0)
  const currentRuntimeLeagueIndexRef = useRef(0)
  const leagueSlotStartTimeRef = useRef(0)
  const currentSlotLeagueIdRef = useRef('')
  const scrolledThisSlotRef = useRef(0)
  const handoffGraceRef = useRef(0)

  // ── Ref sync effects ────────────────────────────────────────────────────
  useEffect(() => { runtimePayloadRef.current = runtimePayloadByLeagueId }, [runtimePayloadByLeagueId])
  useEffect(() => { runtimeLoadStateRef.current = runtimeLoadStateByLeagueId }, [runtimeLoadStateByLeagueId])
  useEffect(() => { configRef.current = config }, [config])

  // ── Config load ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      try {
        setError('')
        const response = await fetch('/api/v1/config')
        if (!response.ok) throw new Error(`Config request failed with ${response.status}`)

        const payload = await response.json()
        const currentFlags = Array.isArray(payload?.kiosk?.chromiumFlags) ? payload.kiosk.chromiumFlags : []
        const mergedFlags = addRecommendedPiFlags(currentFlags)

        if (mergedFlags.length !== currentFlags.length) {
          const updatedPayload = { ...payload, kiosk: { ...payload.kiosk, chromiumFlags: mergedFlags } }
          setConfig(updatedPayload)
          setSavedConfig(updatedPayload)
          configRef.current = updatedPayload
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

  // ── Config mutation helpers ─────────────────────────────────────────────
  function commitConfig(updateFn) {
    setConfig((current) => {
      const nextConfig = updateFn(current)
      configRef.current = nextConfig
      return nextConfig
    })
  }

  function updateConfigSection(section, field, value) {
    commitConfig((current) => ({
      ...current,
      [section]: { ...current[section], [field]: value },
    }))
  }

  function updateThemeTeam(field, value) {
    commitConfig((current) => ({
      ...current,
      theme: { ...current.theme, teamTheme: { ...current.theme.teamTheme, [field]: value } },
    }))
  }

  function applyThemeMode(mode) {
    commitConfig((current) => ({ ...current, theme: { ...current.theme, mode } }))
  }

  function setThemeOverride(field, value) { updateConfigSection('theme', field, value) }
  function clearThemeOverride(field) { updateConfigSection('theme', field, '') }

  function updateBoard(boardType, updates) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => board.type === boardType ? { ...board, ...updates } : board),
    }))
  }

  function updateLeague(index, field, value) {
    setConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') return board
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
        if (board.type !== 'sports') return board
        const target = index + direction
        if (target < 0 || target >= board.leagues.length) return board
        const nextLeagues = [...board.leagues]
        const [item] = nextLeagues.splice(index, 1)
        nextLeagues.splice(target, 0, item)
        return { ...board, leagues: nextLeagues }
      }),
    }))
  }

  function toggleLeagueIncludedGroup(index, groupId, checked) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') return board
        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) => {
            if (leagueIndex !== index) return league
            const currentGroups = Array.isArray(league.includedGroups) ? league.includedGroups : []
            const nextGroups = checked
              ? Array.from(new Set([...currentGroups, groupId]))
              : currentGroups.filter((id) => id !== groupId)
            return { ...league, includedGroups: nextGroups }
          }),
        }
      }),
    }))
  }

  function toggleLeagueIncludedTeam(index, teamId, checked) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') return board
        return {
          ...board,
          leagues: board.leagues.map((league, leagueIndex) => {
            if (leagueIndex !== index) return league
            const currentTeams = Array.isArray(league.includedTeams) ? league.includedTeams : []
            const nextTeams = checked
              ? Array.from(new Set([...currentTeams, String(teamId)]))
              : currentTeams.filter((id) => String(id) !== String(teamId))
            return { ...league, includedTeams: nextTeams }
          }),
        }
      }),
    }))
  }

  function addLeagueFromCatalog(entry) {
    if (!entry?.league || !entry?.scoreboardUrl) return

    const leagueId = String(entry.league).trim().toLowerCase()
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') return board

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
          gameFilter: 'all',
          useWeekFilter: false,
          fallbackWhenEmpty: false,
          includedTeams: [],
          includedGroups: [],
          cardStyle: 'standard',
        }

        setNotice(`Added ${newLeague.name}.`)
        return { ...board, leagues: [...board.leagues, newLeague] }
      }),
    }))
  }

  async function saveConfig({ continueToNextPage = false, setupReady, firstSetupError, hasUnsavedChanges } = {}) {
    if (!config) return
    if (!setupReady) { setError(`Setup is incomplete: ${firstSetupError}`); return }
    if (!hasUnsavedChanges) { setNotice('No unsaved changes.'); return }

    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/v1/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configRef.current || config),
      })

      if (!response.ok) throw new Error(`Save failed with ${response.status}`)

      const payload = await response.json()
      const currentPageIndex = EDITABLE_PAGE_SEQUENCE.indexOf(activePage)
      const nextPageId =
        continueToNextPage && currentPageIndex >= 0
          ? EDITABLE_PAGE_SEQUENCE[Math.min(currentPageIndex + 1, EDITABLE_PAGE_SEQUENCE.length - 1)]
          : null

      startTransition(() => {
        setConfig(payload)
        setSavedConfig(payload)
        configRef.current = payload
        setRuntimeLeagueIndex(0)
        setRuntimeVisibleLeagueId('')
        setRuntimeLastStableLeagueId('')
        setRuntimeLastStableMarqueeGames([])
        setStableGoodGamesByLeagueId({})
        setNotice(continueToNextPage ? 'Configuration saved. Moved to next section.' : 'Configuration saved.')
        if (nextPageId) setActivePage(nextPageId)
      })
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function resetConfig() {
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/v1/config/reset', { method: 'POST' })
      if (!response.ok) throw new Error(`Reset failed with ${response.status}`)

      const payload = await response.json()
      startTransition(() => {
        setConfig(payload)
        setSavedConfig(payload)
        configRef.current = payload
        setRuntimeLeagueIndex(0)
        setRuntimeVisibleLeagueId('')
        setRuntimeLastStableLeagueId('')
        setRuntimeLastStableMarqueeGames([])
        setStableGoodGamesByLeagueId({})
        setNotice('Configuration reset to defaults.')
      })
    } catch (resetError) {
      setError(resetError.message)
    }
  }

  // ── Logo cache helpers ──────────────────────────────────────────────────
  async function loadLeagueLogoMeta(leagueId) {
    if (!leagueId) return
    try {
      const res = await fetch(`/api/v1/logos/meta/${encodeURIComponent(leagueId)}`)
      if (!res.ok) return
      const meta = await res.json()
      setLeagueLogoMetaById((current) => ({ ...current, [leagueId]: meta }))
    } catch (err) {
      console.warn('Failed to load logo meta:', err)
    }
  }

  async function enrichTeamsForLogoSync(league, basicTeams) {
    if (!league || !Array.isArray(basicTeams) || basicTeams.length === 0) return basicTeams

    const params = parseLeagueApiParams(league.url || '')
    const sport = params.sport || ''
    const leagueSlug = params.league || String(league.id || '').toLowerCase()
    const isFootball = sport === 'football'
    const isRacingOrIndividual = isIndividualSport(sport, leagueSlug)

    if (!isFootball && !isRacingOrIndividual) return basicTeams

    const total = basicTeams.length
    console.log(`[logo-enrich] Starting rich logo fetch for ${leagueSlug} (${total} teams)`)

    const enriched = [...basicTeams]
    let done = 0

    for (let i = 0; i < enriched.length; i++) {
      const team = enriched[i]
      done += 1
      setLogoSyncingLeagues((prev) => ({
        ...prev,
        [league.id]: `Fetching logos for ${leagueSlug}… ${done}/${total}`,
      }))

      try {
        const url = `/api/v1/espn/team-logos?team=${encodeURIComponent(team.id)}&league=${encodeURIComponent(leagueSlug)}&sport=${sport}&cache_ttl_seconds=600`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          const richLogos = Array.isArray(data?.logos) ? data.logos.filter((l) => l?.href) : []
          if (richLogos.length > 0) {
            enriched[i] = {
              ...team,
              logos: richLogos,
              color: data?.teamProfile?.color || team.color || '',
              alternateColor: data?.teamProfile?.alternateColor || team.alternateColor || '',
            }
          }
        }
      } catch (err) {
        console.warn(`[logo-enrich] Failed to get rich logos for ${team.abbreviation || team.id}`, err)
      }

      await new Promise((r) => setTimeout(r, 140))
    }

    return enriched
  }

  async function triggerLogoCacheForLeague(leagueId, teams) {
    if (!leagueId || !Array.isArray(teams) || teams.length === 0) return

    setLogoSyncingLeagues((prev) => ({ ...prev, [leagueId]: true }))

    try {
      await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teams),
      })
      await loadLeagueLogoMeta(leagueId)
    } catch (err) {
      console.warn('Logo cache trigger failed:', err)
    } finally {
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev }
        delete copy[leagueId]
        return copy
      })
    }
  }

  async function downloadExtrasForTeam(league, team) {
    if (!league?.id || !team?.id) return

    const leagueId = league.id
    const teamId = String(team.id)
    const params = parseLeagueApiParams(league.url || '')

    setLogoSyncingLeagues((prev) => ({
      ...prev,
      [leagueId]: `Downloading extra variants for ${team.abbreviation || team.name || teamId}…`,
    }))

    try {
      let richLogos = []

      const cacheKey = `${league.id}:${team.id}`
      const alreadyLoaded = teamLogoDetailsByKey[cacheKey]

      if (alreadyLoaded) {
        const fromLoaded = (alreadyLoaded.primary || []).concat(alreadyLoaded.extras || [])
        if (Array.isArray(fromLoaded)) richLogos.push(...fromLoaded)
      }

      if (params.league) {
        try {
          const query = new URLSearchParams({
            sport: params.sport || '',
            league: params.league,
            team: teamId,
            cache_ttl_seconds: '60',
          })
          const detailRes = await fetch(`/api/v1/espn/team-logos?${query.toString()}`)
          if (detailRes.ok) {
            const detail = await detailRes.json()
            const fromDetail = detail?.logos || (detail?.teamProfile && detail.teamProfile.logos) || []
            if (Array.isArray(fromDetail)) richLogos.push(...fromDetail)
          }
        } catch (e) { /* ignore 404s */ }

        try {
          const teamsUrl = `/api/v1/espn/teams?sport=${encodeURIComponent(params.sport || '')}&league=${encodeURIComponent(params.league)}&cache_ttl_seconds=300`
          const teamsRes = await fetch(teamsUrl)
          if (teamsRes.ok) {
            const teamsPayload = await teamsRes.json()
            const allTeams = teamsPayload?.sports?.[0]?.leagues?.[0]?.teams || []
            const match = allTeams.find((t) => {
              const teamObj = t?.team || t
              return String(teamObj?.id) === teamId ||
                String(teamObj?.abbreviation || '').toUpperCase() === String(team.abbreviation || '').toUpperCase()
            })
            if (match) {
              const teamObj = match?.team || match
              const fromList = teamObj?.logos || []
              if (Array.isArray(fromList)) richLogos.push(...fromList)
            }
          }
        } catch (e) { /* ignore */ }
      }

      const seenHrefs = new Set()
      const combined = []
      for (const l of richLogos) {
        if (l?.href && !seenHrefs.has(l.href)) {
          seenHrefs.add(l.href)
          combined.push(l)
        }
      }
      richLogos = combined

      if (richLogos.length === 0 && Array.isArray(team.logos)) {
        richLogos = team.logos.filter((l) => l?.href)
      }

      const payload = {
        logos: richLogos,
        abbreviation: team.abbreviation,
        displayName: team.name || team.displayName,
        color: team.color,
        alternateColor: team.alternateColor,
      }

      const res = await fetch(
        `/api/v1/logos/cache/${encodeURIComponent(leagueId)}/team/${encodeURIComponent(teamId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      )

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.warn('Per-team extras cache failed', res.status, txt)
        setNotice(`Failed to download extras for this team (server error ${res.status}). Check backend logs.`)
      }

      await loadLeagueLogoMeta(leagueId)
    } catch (err) {
      console.warn('downloadExtrasForTeam failed:', err)
      setNotice('Failed to download extra logos for this team.')
    } finally {
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev }
        delete copy[leagueId]
        return copy
      })
    }
  }

  function getCachedOrRemoteLogo(leagueId, team, preferredVariant = null) {
    const meta = leagueLogoMetaById[leagueId]
    if (!meta || !meta.teams) return null

    let cachedTeam = meta.teams[String(team.id)]

    if (!cachedTeam) {
      const upper = String(team.abbreviation || team.id || '').trim().toUpperCase()
      cachedTeam = Object.values(meta.teams).find((t) =>
        String(t?.abbreviation || '').trim().toUpperCase() === upper,
      )
    }

    if (!cachedTeam || !cachedTeam.logos) return null

    if (preferredVariant && cachedTeam.logos[preferredVariant]) {
      return `/logos/${cachedTeam.logos[preferredVariant]}`
    }

    const logos = cachedTeam.logos
    for (const v of ['scoreboard', 'default', 'dark', 'full']) {
      if (logos[v]) return `/logos/${logos[v]}`
    }

    const first = Object.values(logos)[0]
    return first ? `/logos/${first}` : null
  }

  // ── Watermark URL (memoized, depends on logo cache + config) ────────────
  const tickerWatermarkUrl = useMemo(() => {
    if (!config?.theme?.tickerWatermarkEnabled) return null

    const tt = config.theme.teamTheme || {}
    if (tt.enabled && tt.league && tt.team) {
      const fromTeam =
        getCachedOrRemoteLogo(tt.league, { id: tt.team, abbreviation: tt.team }, 'dark') ||
        getCachedOrRemoteLogo(tt.league, { id: tt.team, abbreviation: tt.team })
      if (fromTeam) return fromTeam
    }

    return '/pibarticker-logo-transparent.png'
  }, [
    config?.theme?.tickerWatermarkEnabled,
    config?.theme?.teamTheme?.enabled,
    config?.theme?.teamTheme?.league,
    config?.theme?.teamTheme?.team,
    leagueLogoMetaById,
  ])

  // ── Setup data loaders ──────────────────────────────────────────────────
  async function loadLeagueTeams(league) {
    if (!league?.id || !league?.url) return

    setLeagueLoadStateById((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const params = parseLeagueApiParams(league.url)
      const isRacingOrIndividual = isIndividualSport(params.sport, params.league)
      const teamsUrl = toLeagueTeamsEndpoint(league.url)
      const response = await fetch(buildEspnProxyUrl(teamsUrl, 300))
      if (!response.ok) throw new Error(`Teams fetch failed with ${response.status}`)

      const payload = await response.json()
      let teams = normalizeTeamDataFromTeamsEndpoint(payload)

      if (isRacingOrIndividual) {
        try {
          const racingEntities = await harvestRacingEntities(league)
          if (racingEntities.length > 0) {
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

      if (!teams.length) {
        const scoreboardResponse = await fetch(buildEspnProxyUrl(league.url, 60))
        if (!scoreboardResponse.ok) throw new Error(`Fallback scoreboard fetch failed with ${scoreboardResponse.status}`)
        const scoreboardPayload = await scoreboardResponse.json()
        teams = normalizeTeamDataFromScoreboard(scoreboardPayload)
      }

      setLeagueTeamsById((current) => ({ ...current, [league.id]: teams }))
      setLeagueLoadStateById((current) => ({ ...current, [league.id]: { loading: false, error: '' } }))
    } catch (loadError) {
      setLeagueLoadStateById((current) => ({ ...current, [league.id]: { loading: false, error: loadError.message } }))
    }
  }

  async function loadLeagueGroups(league) {
    if (!league?.id || !league?.url) return

    const params = parseLeagueApiParams(league.url)
    if (!params.league) return

    setLeagueGroupsLoadStateById((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const query = new URLSearchParams({ sport: params.sport, league: params.league, cache_ttl_seconds: '300' })
      const response = await fetch(`/api/v1/espn/league-groups?${query.toString()}`)
      if (!response.ok) throw new Error(`League groups fetch failed with ${response.status}`)

      const payload = await response.json()
      setLeagueGroupsById((current) => ({
        ...current,
        [league.id]: Array.isArray(payload?.groups) ? payload.groups : [],
      }))
      setLeagueGroupsLoadStateById((current) => ({ ...current, [league.id]: { loading: false, error: '' } }))
    } catch (loadError) {
      setLeagueGroupsLoadStateById((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadTeamLogosForLeagueTeam(league, team) {
    if (!league?.id || !league?.url || !team?.id) return

    const cacheKey = `${league.id}:${team.id}`
    const params = parseLeagueApiParams(league.url)
    if (!params.league) return

    setTeamLogoLoadStateByKey((current) => ({ ...current, [cacheKey]: { loading: true, error: '' } }))

    try {
      const query = new URLSearchParams({
        sport: params.sport,
        league: params.league,
        team: String(team.id),
        cache_ttl_seconds: '300',
      })

      const response = await fetch(`/api/v1/espn/team-logos?${query.toString()}`)
      if (!response.ok) throw new Error(`Team logos fetch failed with ${response.status}`)

      const payload = await response.json()
      const split = splitTeamLogosForDisplay(payload?.logos || [], league.id)
      setTeamLogoDetailsByKey((current) => ({
        ...current,
        [cacheKey]: { ...split, teamProfile: payload?.teamProfile || null },
      }))
      setTeamLogoLoadStateByKey((current) => ({ ...current, [cacheKey]: { loading: false, error: '' } }))
    } catch (loadError) {
      setTeamLogoLoadStateByKey((current) => ({
        ...current,
        [cacheKey]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadLeagueScoreboardWithSettings(league, {
    cacheTtlSeconds = 30,
    gameFilterOverride = null,
    useWeekFilterOverride = null,
  } = {}) {
    const query = buildTickerScoreboardQuery(league, { cacheTtlSeconds, gameFilterOverride, useWeekFilterOverride })
    const response = await fetch(`/api/v1/espn/scoreboard?${query}`)
    if (!response.ok) throw new Error(`Ticker fetch failed with ${response.status}`)
    return response.json()
  }

  async function loadLeagueTickerPreview(league) {
    if (!league?.id || !league?.url) return

    setLeagueTickerPreviewLoadStateById((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const payload = await loadLeagueScoreboardWithSettings(league, { cacheTtlSeconds: 60, fallbackCacheTtlSeconds: 30 })
      setLeagueTickerPreviewById((current) => ({ ...current, [league.id]: payload }))
      setLeagueTickerPreviewLoadStateById((current) => ({ ...current, [league.id]: { loading: false, error: '' } }))
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
      const params = new URLSearchParams({ cache_ttl_seconds: '600' })
      if (requestedSport) params.set('sport', requestedSport)

      const response = await fetch(`/api/v1/espn/discover-leagues?${params.toString()}`)
      if (!response.ok) throw new Error(`League discovery failed with ${response.status}`)

      const payload = await response.json()
      setLeagueCatalog(Array.isArray(payload?.leagues) ? payload.leagues : [])
      setLeagueCatalogState({ loading: false, error: '' })
    } catch (loadError) {
      setLeagueCatalogState({ loading: false, error: loadError.message })
    }
  }

  // ── Runtime payload fetch ───────────────────────────────────────────────
  async function refreshRuntimeLeaguePayload(league, {
    cacheTtlSeconds = 5,
    fallbackCacheTtlSeconds = 5,
    gameFilterOverride = null,
    useWeekFilterOverride = null,
  } = {}) {
    if (!league?.id) return null

    setRuntimeLoadStateByLeagueId((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const payload = await loadLeagueScoreboardWithSettings(league, {
        cacheTtlSeconds,
        fallbackCacheTtlSeconds,
        gameFilterOverride,
        useWeekFilterOverride,
      })

      setRuntimeLoadStateByLeagueId((current) => ({ ...current, [league.id]: { loading: false, error: '' } }))

      let finalPayload = payload
      let gameCount = Array.isArray(payload?.normalizedGames) ? payload.normalizedGames.length : 0

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
          } catch { /* keep empty payload */ }
        }
      }

      if (gameCount > 0) {
        setStableGoodGamesByLeagueId((cur) => ({
          ...cur,
          [league.id]: finalPayload?.normalizedGames || [],
        }))
      }

      setRuntimePayloadByLeagueId((current) => {
        const prev = current[league.id]
        const prevCount = Array.isArray(prev?.normalizedGames) ? prev.normalizedGames.length : 0
        if (gameCount === 0 && prevCount > 0) return current
        return { ...current, [league.id]: finalPayload }
      })

      return finalPayload
    } catch (loadError) {
      setRuntimeLoadStateByLeagueId((current) => ({
        ...current,
        [league.id]: { loading: false, error: loadError.message },
      }))
      return null
    }
  }

  function handleRuntimeAdvance() {
    setRuntimeVisibleLeagueId('')
    setRuntimeLeagueIndex((current) => (current + 1) % (currentLeaguesLengthRef.current || 1))
  }

  // ── Derived ticker values (for effects) ─────────────────────────────────
  const sportsBoard = config?.boards?.find((board) => board.type === 'sports') ?? null
  const runtimeLeagues = sportsBoard?.leagues?.filter((league) => league.enabled) ?? []
  const runtimeLeagueIdsKey = runtimeLeagues.map((league) => league.id).join('|')

  // ── Ticker rotation effects ─────────────────────────────────────────────
  useEffect(() => {
    currentLeaguesLengthRef.current = runtimeLeagues.length
  }, [runtimeLeagues.length])

  useEffect(() => {
    currentRuntimeLeagueIndexRef.current = runtimeLeagueIndex
  }, [runtimeLeagueIndex])

  const runtimeVisibleLeague = runtimeLeagues.find((league) => league.id === runtimeVisibleLeagueId) || null
  const activeRuntimeLeague = runtimeLeagues.length ? runtimeLeagues[runtimeLeagueIndex % runtimeLeagues.length] : null
  const logicalDisplayLeague = runtimeVisibleLeague || activeRuntimeLeague
  const runtimeDisplayLeague = initialPreFetchesComplete ? logicalDisplayLeague : (runtimeLeagues[0] || logicalDisplayLeague)

  const runtimeHasAnyGamesAcrossEnabledLeagues = runtimeLeagues.some((league) => {
    const payload = runtimePayloadByLeagueId[league.id]
    if (Array.isArray(payload?.normalizedGames) && payload.normalizedGames.length > 0) return true
    const stable = stableGoodGamesByLeagueId[league.id]
    return Array.isArray(stable) && stable.length > 0
  })

  useEffect(() => {
    if (!runtimeDisplayLeague?.id) return
    const activeGames = Array.isArray(runtimePayloadByLeagueId[runtimeDisplayLeague.id]?.normalizedGames)
      ? runtimePayloadByLeagueId[runtimeDisplayLeague.id].normalizedGames
      : []
    if (!activeGames.length) return
    setRuntimeLastStableLeagueId(runtimeDisplayLeague.id)
    setRuntimeLastStableMarqueeGames(activeGames)
  }, [runtimeDisplayLeague?.id, runtimePayloadByLeagueId[runtimeDisplayLeague?.id]?.normalizedGames?.length])

  useEffect(() => {
    if (!isTickerRuntime || !runtimeLeagues.length) return

    setRuntimeLeagueIndex(0)
    setRuntimeVisibleLeagueId('')
    setInitialPreFetchesComplete(false)
    tickerEntryGraceRef.current = Date.now() + 700
    leagueSlotStartTimeRef.current = 0
    scrolledThisSlotRef.current = 0
    currentSlotLeagueIdRef.current = ''
    handoffGraceRef.current = 0

    runtimeLeagues.forEach((league) => {
      if (!leagueLogoMetaById[league.id]) {
        loadLeagueLogoMeta(league.id)
      }
    })

    setStableGoodGamesByLeagueId({})
    const preFetchPromises = runtimeLeagues.map((league) =>
      refreshRuntimeLeaguePayload(league, { gameFilterOverride: 'all' }).catch(() => null),
    )
    Promise.all(preFetchPromises).then(() => {
      setInitialPreFetchesComplete(true)
      tickerEntryGraceRef.current = Date.now() + 2000
    })
  }, [isTickerRuntime, runtimeLeagueIdsKey])

  useEffect(() => {
    if (!isTickerRuntime || !initialPreFetchesComplete || !runtimeLeagues.length) return
    const current = runtimeLeagueIndex % runtimeLeagues.length
    if (current !== 0) {
      setRuntimeVisibleLeagueId('')
      setRuntimeLeagueIndex(0)
      leagueSlotStartTimeRef.current = 0
      scrolledThisSlotRef.current = 0
      currentSlotLeagueIdRef.current = ''
      handoffGraceRef.current = Date.now() + 800
    }
  }, [isTickerRuntime, initialPreFetchesComplete, runtimeLeagueIdsKey])

  useEffect(() => {
    if (!runtimeLeagues.length) { setRuntimeVisibleLeagueId(''); return }
    if (runtimeVisibleLeagueId && !runtimeLeagues.some((league) => league.id === runtimeVisibleLeagueId)) {
      setRuntimeVisibleLeagueId('')
    }
  }, [runtimeLeagues, runtimeVisibleLeagueId, runtimePayloadByLeagueId])

  useEffect(() => {
    if (!isTickerRuntime || runtimeLeagues.length <= 1 || !sportsBoard || !initialPreFetchesComplete) return
    if (isTickerRuntime) return // ticker advance driven from rAF tick in TickerRuntime

    const dur = (sportsBoard.rotateSeconds || 30) * 1000
    const timeoutId = window.setTimeout(() => {
      setRuntimeVisibleLeagueId('')
      setRuntimeLeagueIndex((current) => (current + 1) % runtimeLeagues.length)
      currentSlotLeagueIdRef.current = ''
      handoffGraceRef.current = Date.now() + 800
    }, dur)

    return () => window.clearTimeout(timeoutId)
  }, [isTickerRuntime, runtimeLeagueIdsKey, runtimeLeagues.length, sportsBoard, initialPreFetchesComplete, runtimeLeagueIndex])

  useEffect(() => {
    if (!isTickerRuntime || runtimeLeagues.length <= 1) return
    if (!initialPreFetchesComplete) return
    if (Date.now() < tickerEntryGraceRef.current) return
    if (Date.now() < handoffGraceRef.current) return
    if (!runtimeHasAnyGamesAcrossEnabledLeagues) return

    const idx = runtimeLeagueIndex % runtimeLeagues.length
    const league = runtimeLeagues[idx]
    if (!league) return

    const p = runtimePayloadByLeagueId[league.id]
    const hasP = Array.isArray(p?.normalizedGames) && p.normalizedGames.length > 0
    const hasS = Array.isArray(stableGoodGamesByLeagueId[league.id]) && stableGoodGamesByLeagueId[league.id].length > 0

    if (!hasP && !hasS) {
      const ls = runtimeLoadStateByLeagueId[league.id]
      const thisLeagueLoadDone = !ls || !ls.loading
      if (thisLeagueLoadDone) {
        setRuntimeVisibleLeagueId('')
        setRuntimeLeagueIndex((c) => (c + 1) % runtimeLeagues.length)
        currentSlotLeagueIdRef.current = ''
        handoffGraceRef.current = Date.now() + 800
      }
    }
  }, [isTickerRuntime, runtimeLeagueIndex, runtimeLeagues, runtimePayloadByLeagueId, stableGoodGamesByLeagueId, runtimeHasAnyGamesAcrossEnabledLeagues, runtimeLoadStateByLeagueId, handoffCheckKey])

  useEffect(() => {
    if (!isTickerRuntime || !runtimeDisplayLeague) return
    refreshRuntimeLeaguePayload(runtimeDisplayLeague, { gameFilterOverride: 'all' })
    if (!leagueLogoMetaById[runtimeDisplayLeague.id]) {
      loadLeagueLogoMeta(runtimeDisplayLeague.id)
    }
  }, [isTickerRuntime, runtimeDisplayLeague?.id])

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

  // ── Context value ───────────────────────────────────────────────────────
  const value = {
    // Config
    config, savedConfig, isLoading, error, notice, setError, setNotice,
    isPending, startTransition, activePage, setActivePage,
    commitConfig, saveConfig, resetConfig,
    updateConfigSection, updateThemeTeam, applyThemeMode, setThemeOverride, clearThemeOverride,
    updateBoard, updateLeague, moveLeague, toggleLeagueIncludedGroup, toggleLeagueIncludedTeam,
    addLeagueFromCatalog,
    // Logo cache
    leagueLogoMetaById, setLeagueLogoMetaById, logoSyncingLeagues, setLogoSyncingLeagues,
    logoClearMessageById, setLogoClearMessageById,
    loadLeagueLogoMeta, enrichTeamsForLogoSync, triggerLogoCacheForLeague,
    downloadExtrasForTeam, getCachedOrRemoteLogo, tickerWatermarkUrl,
    // Runtime ticker
    runtimeLeagueIndex, setRuntimeLeagueIndex,
    runtimeVisibleLeagueId, setRuntimeVisibleLeagueId,
    runtimePayloadByLeagueId, runtimeLoadStateByLeagueId,
    initialPreFetchesComplete, handoffCheckKey, setHandoffCheckKey,
    stableGoodGamesByLeagueId, runtimeLastStableLeagueId, runtimeLastStableMarqueeGames,
    refreshRuntimeLeaguePayload, handleRuntimeAdvance,
    handoffGraceRef, scrolledThisSlotRef, leagueSlotStartTimeRef, currentSlotLeagueIdRef,
    currentLeaguesLengthRef,
    // Setup data loaders
    leagueTeamsById, leagueLoadStateById, leagueGroupsById, leagueGroupsLoadStateById,
    teamLogoDetailsByKey, teamLogoLoadStateByKey,
    leagueTickerPreviewById, leagueTickerPreviewLoadStateById,
    leagueCatalog, setLeagueCatalog, leagueCatalogSport, setLeagueCatalogSport,
    leagueCatalogRegion, setLeagueCatalogRegion,
    leagueCatalogQuery, setLeagueCatalogQuery,
    leagueCatalogState, showLeagueCatalog, setShowLeagueCatalog,
    showBoardSettings, setShowBoardSettings,
    loadLeagueTeams, loadLeagueGroups, loadTeamLogosForLeagueTeam,
    loadLeagueTickerPreview, loadLeagueCatalog,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
