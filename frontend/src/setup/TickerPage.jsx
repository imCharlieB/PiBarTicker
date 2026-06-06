import { useState } from 'react'
import { useAppContext, parseLeagueApiParams, isIndividualSport } from '../AppContext'
import { harvestRacingEntities } from '../AppContext'

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

  return { kind: 'team', label: 'Teams', singular: 'Team' }
}

export default function TickerPage() {
  const {
    config,
    setNotice,
    leagueLogoMetaById, logoSyncingLeagues, logoClearMessageById, setLogoClearMessageById,
    setLeagueLogoMetaById, setLogoSyncingLeagues,
    loadLeagueLogoMeta, enrichTeamsForLogoSync, triggerLogoCacheForLeague,
    downloadExtrasForTeam, getCachedOrRemoteLogo,
    leagueTeamsById, leagueLoadStateById, leagueGroupsById, leagueGroupsLoadStateById,
    teamLogoDetailsByKey,
    leagueTickerPreviewById, leagueTickerPreviewLoadStateById,
    leagueCatalog, setLeagueCatalog, leagueCatalogSport, setLeagueCatalogSport,
    leagueCatalogRegion, setLeagueCatalogRegion,
    leagueCatalogQuery, setLeagueCatalogQuery,
    leagueCatalogState, showLeagueCatalog, setShowLeagueCatalog,
    showBoardSettings, setShowBoardSettings,
    loadLeagueTeams, loadLeagueGroups, loadTeamLogosForLeagueTeam,
    loadLeagueTickerPreview, loadLeagueCatalog,
    updateBoard, updateLeague, moveLeague, toggleLeagueIncludedGroup, toggleLeagueIncludedTeam,
    addLeagueFromCatalog,
  } = useAppContext()

  const [selectedTickerLeagueId, setSelectedTickerLeagueId] = useState('')
  const [selectedTickerTeamId, setSelectedTickerTeamId] = useState('')

  const sportsBoard = config.boards.find((b) => b.type === 'sports')

  if (!sportsBoard) {
    return (
      <article className="card page-card">
        <p>No sports board found in config.</p>
      </article>
    )
  }

  const selectedTickerLeague = sportsBoard.leagues.find((l) => l.id === selectedTickerLeagueId) || null
  const selectedTickerLeagueIndex = sportsBoard.leagues.findIndex((l) => l.id === selectedTickerLeagueId)
  const selectedLeagueTeams = selectedTickerLeague ? leagueTeamsById[selectedTickerLeague.id] || [] : []
  const selectedLeagueLoadState = selectedTickerLeague
    ? leagueLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const selectedTickerTeam = selectedLeagueTeams.find((t) => t.id === selectedTickerTeamId) || null

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
  const selectedTeamStyle = cachedTeamMeta || null

  const selectedTeamLogoDetail = selectedTickerLeague && selectedTickerTeam
    ? teamLogoDetailsByKey[`${selectedTickerLeague.id}:${selectedTickerTeam.id}`] || null
    : null
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
          const home = competitors.find((c) => c?.homeAway === 'home')
          const away = competitors.find((c) => c?.homeAway === 'away')
          const homeName =
            home?.team?.shortDisplayName || home?.team?.displayName || home?.team?.name || home?.team?.abbreviation || ''
          const awayName =
            away?.team?.shortDisplayName || away?.team?.displayName || away?.team?.name || away?.team?.abbreviation || ''
          if (!homeName && !awayName) return ''
          if (homeName && awayName) return `${homeName} vs ${awayName}`
          return homeName || awayName
        })
        .filter(Boolean),
    ),
  )
  const selectedLeaguePreviewMatchupsText = selectedLeaguePreviewMatchups.slice(0, 8).join(', ')

  const loadedLeagueCatalogCount = leagueCatalog.length
  const filteredLeagueCatalog = leagueCatalog.filter((entry) => {
    if (!matchesLeagueCatalogSportFilter(entry, leagueCatalogSport)) return false
    if (!matchesLeagueCatalogRegionFilter(entry, leagueCatalogRegion)) return false
    const query = leagueCatalogQuery.trim().toLowerCase()
    if (!query) return true
    return [entry.leagueName, entry.league, entry.sportName, entry.abbreviation]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
  const selectedCatalogSportLabel =
    LEAGUE_CATALOG_SPORT_OPTIONS.find((option) => option.value === leagueCatalogSport)?.label || 'Selected sport'
  const noFilteredLeagueMatches = leagueCatalog.length > 0 && filteredLeagueCatalog.length === 0

  return (
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
                  <button type="button" className="button-link" onClick={() => setShowBoardSettings(false)}>
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
                  <button type="button" className="button-link" onClick={() => setShowLeagueCatalog(false)}>
                    Close
                  </button>
                </div>
              </div>

              <div className="field-grid field-grid-3">
                <label className="field">
                  <span>Sport</span>
                  <select value={leagueCatalogSport} onChange={(event) => setLeagueCatalogSport(event.target.value)}>
                    {LEAGUE_CATALOG_SPORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Region</span>
                  <select value={leagueCatalogRegion} onChange={(event) => setLeagueCatalogRegion(event.target.value)}>
                    {LEAGUE_CATALOG_REGION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
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
                            <button type="button" className="button-link" onClick={() => addLeagueFromCatalog(entry)}>
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
                    loadLeagueLogoMeta(league.id)
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
                await loadLeagueTeams(selectedTickerLeague)
                let teams = leagueTeamsById[selectedTickerLeague.id] || []

                const params = parseLeagueApiParams(selectedTickerLeague.url || '')
                const isRacingOrIndividual = isIndividualSport(params.sport, params.league)

                if (isRacingOrIndividual) {
                  setLogoSyncingLeagues((prev) => ({
                    ...prev,
                    [selectedTickerLeague.id]: 'Harvesting drivers from scoreboard…'
                  }))
                  setNotice(`Syncing ${selectedTickerLeague.name} — harvesting drivers/teams...`)

                  try {
                    const racingEntities = await harvestRacingEntities(selectedTickerLeague)
                    if (racingEntities.length > 0) {
                      const byId = new Map(teams.map((t) => [String(t.id), t]))
                      for (const ent of racingEntities) {
                        const key = String(ent.id)
                        if (!byId.has(key)) {
                          byId.set(key, ent)
                        }
                      }
                      teams = Array.from(byId.values())
                    }
                  } catch (e) {
                    console.warn('Extra harvestRacingEntities during sync failed', e)
                  }

                  setLogoSyncingLeagues((prev) => {
                    const copy = { ...prev }
                    if (copy[selectedTickerLeague.id] && typeof copy[selectedTickerLeague.id] === 'string' && copy[selectedTickerLeague.id].includes('Harvesting')) {
                      delete copy[selectedTickerLeague.id]
                    }
                    return copy
                  })
                }

                if (teams.length > 0) {
                  const isFootball = params.sport === 'football'

                  if (isFootball || isRacingOrIndividual) {
                    setLogoSyncingLeagues((prev) => ({
                      ...prev,
                      [selectedTickerLeague.id]: 'Enriching logos for drivers/teams…'
                    }))

                    teams = await enrichTeamsForLogoSync(selectedTickerLeague, teams)

                    setLogoSyncingLeagues((prev) => {
                      const copy = { ...prev }
                      if (copy[selectedTickerLeague.id] && typeof copy[selectedTickerLeague.id] === 'string' && copy[selectedTickerLeague.id].includes('Enriching')) {
                        delete copy[selectedTickerLeague.id]
                      }
                      return copy
                    })
                  }

                  triggerLogoCacheForLeague(selectedTickerLeague.id, teams).catch((err) => {
                    console.warn('Logo cache failed:', err)
                  })

                  if (isRacingOrIndividual) {
                    setTimeout(() => {
                      loadLeagueLogoMeta(selectedTickerLeague.id)
                    }, 300)
                  }
                } else {
                  if (isRacingOrIndividual) {
                    setNotice(`Sync for ${selectedTickerLeague.name} didn't find many drivers right now (common for NASCAR etc. depending on season/events). The live ticker still works. A better driver roster pull is planned for later.`)
                  } else {
                    setNotice(`Sync found no teams/drivers for ${selectedTickerLeague.name}. Try loading preview first or check the league URL.`)
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
                const leagueId = selectedTickerLeague.id
                const leagueName = selectedTickerLeague.name
                try {
                  await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, { method: 'DELETE' })
                  setNotice(`Cleared cached logos for ${leagueName} (folder deleted from disk).`)
                } catch (e) {
                  // still clear local even if server had issues
                }

                setLogoClearMessageById((prev) => ({
                  ...prev,
                  [leagueId]: `Cache cleared — logos folder + meta deleted from disk.`,
                }))

                setTimeout(() => {
                  setLogoClearMessageById((prev) => {
                    const next = { ...prev }
                    delete next[leagueId]
                    return next
                  })
                }, 4500)

                setLeagueLogoMetaById((current) => {
                  const copy = { ...current }
                  delete copy[leagueId]
                  return copy
                })
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
              const cachedLogo = getCachedOrRemoteLogo(selectedTickerLeague.id, team)
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
                    loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                    loadLeagueLogoMeta(selectedTickerLeague.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedTickerTeamId(team.id)
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
                      const isPreferred = cachedTeamMeta?.preferred_variant === variant
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
                              .catch(() => {})
                          }}
                          style={{ cursor: 'pointer', border: isPreferred ? '2px solid var(--accent)' : '1px solid #444' }}
                        >
                          <img src={href} alt={variant} />
                          <p>{variant}{isPreferred ? ' ★' : ''}</p>
                        </div>
                      )
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
  )
}
