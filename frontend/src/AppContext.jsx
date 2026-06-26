import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  parseLeagueApiParams, isIndividualSport, resolveLeagueLogo, getRelaxedGameFilter,
  fetchLogoMeta, fetchLeagueScoreboard, fetchLeagueTeams, fetchLeagueGroups,
  fetchTeamLogos, fetchLeagueCatalog, enrichTeamsWithRichLogos,
  fetchExtrasForTeam, postLogoCache, postTeamLogoCache,
} from './api/espnApi'

// Re-export pure helpers consumed by setup components
export { parseLeagueApiParams, isIndividualSport } from './api/espnApi'
export { harvestRacingEntities, harvestPlayers } from './api/espnApi'

// ── Internal config helpers ──────────────────────────────────────────────────

const RECOMMENDED_PI_FLAGS = [
  '--noerrdialogs',
  '--disable-infobars',
  '--force-device-scale-factor=1',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--ignore-gpu-blocklist',
  '--disable-smooth-scrolling',
  '--overscroll-history-navigation=0',
  '--disable-translate',
  '--disable-features=TranslateUI',
  '--enable-features=OverlayScrollbar,VaapiVideoDecoder',
  '--disable-webgpu',
  '--disable-session-crashed-bubble',
  '--check-for-update-interval=31536000',
]

function addRecommendedPiFlags(currentFlags) {
  const existing = Array.isArray(currentFlags) ? currentFlags.map((f) => String(f).trim()) : []
  const toAdd = RECOMMENDED_PI_FLAGS.filter((flag) => !existing.includes(flag))
  if (toAdd.length === 0) return existing
  return [...existing, ...toAdd]
}

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
  async function applyLoadedConfig(payload) {
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
  }

  useEffect(() => {
    async function loadConfig() {
      try {
        setError('')
        const response = await fetch('/api/v1/config')
        if (!response.ok) throw new Error(`Config request failed with ${response.status}`)
        await applyLoadedConfig(await response.json())
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }
    loadConfig()
  }, [])

  // ── Config change detection: reload the ticker page when setup saves ──────
  // BroadcastChannel handles same-browser (instant); polling handles cross-device
  // (laptop setup → Pi kiosk on different browser/origin). Both just do a full
  // page reload — cleaner than in-place state surgery and matches how the Pi
  // launch-kiosk.sh while-loop expects the kiosk to restart.
  useEffect(() => {
    if (!isTickerRuntime) return
    try {
      const channel = new BroadcastChannel('pibarticker-config')
      channel.onmessage = (e) => {
        if (e.data?.type === 'config-updated') window.location.reload()
      }
      return () => channel.close()
    } catch (_) { /* BroadcastChannel unsupported */ }
  }, [isTickerRuntime])

  useEffect(() => {
    if (!isTickerRuntime) return
    let lastVersion = null
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/v1/config/version')
        if (!r.ok) return
        const { version } = await r.json()
        if (lastVersion === null) { lastVersion = version; return }
        if (version !== lastVersion) window.location.reload()
      } catch (_) { /* ignore */ }
    }, 5000)
    return () => clearInterval(id)
  }, [isTickerRuntime])

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

  function removeLeague(leagueId) {
    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type !== 'sports') return board
        return { ...board, leagues: board.leagues.filter((l) => l.id !== leagueId) }
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
          showNews: false,
          liveGameMode: false,
          density: 'bal',
          colorMode: 'full',
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
    if (continueToNextPage && !setupReady) { setError(`Setup is incomplete: ${firstSetupError}`); return }
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

      try {
        const bc = new BroadcastChannel('pibarticker-config')
        bc.postMessage({ type: 'config-updated' })
        bc.close()
      } catch (_) { /* ignore in envs without BroadcastChannel */ }
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
      const meta = await fetchLogoMeta(leagueId)
      setLeagueLogoMetaById((current) => ({ ...current, [leagueId]: meta }))
    } catch (err) {
      console.warn('Failed to load logo meta:', err)
    }
  }

  async function enrichTeamsForLogoSync(league, basicTeams) {
    return enrichTeamsWithRichLogos(league, basicTeams, (leagueId, leagueSlug, done, total) => {
      setLogoSyncingLeagues((prev) => ({
        ...prev,
        [leagueId]: `Fetching logos for ${leagueSlug}… ${done}/${total}`,
      }))
    })
  }

  async function triggerLogoCacheForLeague(leagueId, teams, sport = '') {
    if (!leagueId || !Array.isArray(teams) || teams.length === 0) return

    setLogoSyncingLeagues((prev) => ({ ...prev, [leagueId]: true }))

    try {
      await postLogoCache(leagueId, teams, sport)
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
    const cacheKey = `${leagueId}:${teamId}`

    setLogoSyncingLeagues((prev) => ({
      ...prev,
      [leagueId]: `Downloading extra variants for ${team.abbreviation || team.name || teamId}…`,
    }))

    try {
      const richLogos = await fetchExtrasForTeam(league, team, teamLogoDetailsByKey[cacheKey])

      const payload = {
        logos: richLogos,
        abbreviation: team.abbreviation,
        displayName: team.name || team.displayName,
        color: team.color,
        alternateColor: team.alternateColor,
      }

      try {
        await postTeamLogoCache(leagueId, teamId, payload)
      } catch (err) {
        console.warn('Per-team extras cache failed', err.message)
        setNotice(`Failed to download extras for this team (${err.message}). Check backend logs.`)
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
      const teams = await fetchLeagueTeams(league)
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
      const groups = await fetchLeagueGroups(league)
      setLeagueGroupsById((current) => ({ ...current, [league.id]: groups }))
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
      const result = await fetchTeamLogos(league, team)
      setTeamLogoDetailsByKey((current) => ({
        ...current,
        [cacheKey]: { ...result.logos, teamProfile: result.teamProfile },
      }))
      setTeamLogoLoadStateByKey((current) => ({ ...current, [cacheKey]: { loading: false, error: '' } }))
    } catch (loadError) {
      setTeamLogoLoadStateByKey((current) => ({
        ...current,
        [cacheKey]: { loading: false, error: loadError.message },
      }))
    }
  }

  async function loadLeagueTickerPreview(league) {
    if (!league?.id || !league?.url) return

    setLeagueTickerPreviewLoadStateById((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const payload = await fetchLeagueScoreboard(league, { cacheTtlSeconds: 60 })
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
    setLeagueCatalogState({ loading: true, error: '' })
    try {
      const leagues = await fetchLeagueCatalog(sport)
      setLeagueCatalog(leagues)
      setLeagueCatalogState({ loading: false, error: '' })
    } catch (loadError) {
      setLeagueCatalogState({ loading: false, error: loadError.message })
    }
  }

  // ── Runtime payload fetch ───────────────────────────────────────────────
  async function refreshRuntimeLeaguePayload(league, {
    cacheTtlSeconds = 0,
    fallbackCacheTtlSeconds = 0,
    gameFilterOverride = null,
    useWeekFilterOverride = null,
  } = {}) {
    if (!league?.id) return null

    setRuntimeLoadStateByLeagueId((current) => ({ ...current, [league.id]: { loading: true, error: '' } }))

    try {
      const payload = await fetchLeagueScoreboard(league, {
        cacheTtlSeconds,
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
            const relaxedPayload = await fetchLeagueScoreboard(league, {
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
    if (isTickerRuntime) return // ticker advance driven by TickerRuntime animationend

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

  // Eagerly load cached logo meta for all leagues when in setup mode so the league
  // list shows real synced-team counts without requiring the user to click each league.
  useEffect(() => {
    if (isTickerRuntime || !config) return
    const leagues = sportsBoard?.leagues ?? []
    leagues.forEach((league) => {
      if (league.id && !leagueLogoMetaById[league.id]) {
        loadLeagueLogoMeta(league.id)
      }
    })
  }, [isTickerRuntime, config, sportsBoard?.leagues?.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
    updateBoard, updateLeague, moveLeague, removeLeague, toggleLeagueIncludedGroup, toggleLeagueIncludedTeam,
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
