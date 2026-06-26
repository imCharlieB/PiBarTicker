import { useRef, useState } from 'react'
import { useAppContext } from '../../AppContext'
import { resolveTeamPrimaryLogo } from '../helpers'

const DIRECT_SPORT_FILTERS = new Set([
  'football', 'basketball', 'baseball', 'hockey', 'soccer', 'golf',
  'tennis', 'mma', 'boxing', 'motorsports', 'cricket', 'rugby', 'lacrosse',
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
  if (!filter || filter === 'all') return true

  const sport = normalizeCatalogText(entry?.sport)
  const league = normalizeCatalogText(entry?.league)
  const leagueName = normalizeCatalogText(entry?.leagueName)
  const abbreviation = normalizeCatalogText(entry?.abbreviation)
  const haystack = `${sport} ${league} ${leagueName} ${abbreviation}`

  if (filter === 'motorsports') {
    return (
      sport === 'racing' || sport === 'motorsports' ||
      /f1|formula\s*1|nascar|indycar|motogp|rally|wec|imsa|supercars|racing/.test(haystack)
    )
  }
  if (filter === 'boxing') return sport === 'boxing' || /boxing|wbc|wba|ibf|wbo/.test(haystack)
  if (filter === 'mma') return sport === 'mma' || /mma|mixed martial|ufc|pfl|bellator/.test(haystack)
  if (DIRECT_SPORT_FILTERS.has(filter)) return sport === filter
  if (filter === 'us-major') return ['nfl', 'nba', 'wnba', 'mlb', 'nhl', 'mls', 'nwsl'].includes(league)
  if (filter === 'college') return /\bncaa\b|college/.test(haystack)
  if (filter === 'women') return /women|\bwnba\b|\bnwsl\b|\bwta\b|\blpga\b/.test(haystack)
  return true
}

function matchesLeagueCatalogRegionFilter(entry, filterValue) {
  const filter = normalizeCatalogText(filterValue)
  if (!filter || filter === 'all') return true

  const sport = normalizeCatalogText(entry?.sport)
  const league = normalizeCatalogText(entry?.league)
  const leagueName = normalizeCatalogText(entry?.leagueName)
  const abbreviation = normalizeCatalogText(entry?.abbreviation)
  const haystack = `${sport} ${league} ${leagueName} ${abbreviation}`

  if (filter === 'us') return /\bnfl\b|\bnba\b|\bwnba\b|\bmlb\b|\bnhl\b|\bmls\b|\bnwsl\b|\bncaa\b|college|united states|\busa\b/.test(haystack)
  if (filter === 'europe') return /uefa|europe|premier league|laliga|bundesliga|serie a|ligue 1|eredivisie/.test(haystack)
  if (filter === 'americas') return /concacaf|conmebol|copa|liga mx|argentina|brasil|brazil|canada|cfl|libertadores/.test(haystack)
  if (filter === 'asia') return /\bafc\b|asia|j league|k league|ipl|india|japan|korea|china/.test(haystack)
  if (filter === 'oceania') return /oceania|a-league|australia|new zealand/.test(haystack)
  if (filter === 'africa') return /\bcaf\b|africa/.test(haystack)
  if (filter === 'global') return /world|international|fifa|olympic|formula\s*1|f1|atp|wta|davis cup|fiba/.test(haystack)
  return true
}

export default function LeagueList({ sportsBoard, onSelectLeague, onSelectHA }) {
  const {
    config, commitConfig,
    leagueTeamsById, leagueGroupsById, leagueTickerPreviewById, leagueLogoMetaById,
    getCachedOrRemoteLogo, loadLeagueTeams, loadLeagueGroups,
    loadLeagueLogoMeta, loadLeagueTickerPreview, removeLeague, updateBoard,
    showBoardSettings, setShowBoardSettings, showLeagueCatalog, setShowLeagueCatalog,
    leagueCatalog, setLeagueCatalog, leagueCatalogSport, setLeagueCatalogSport,
    leagueCatalogRegion, setLeagueCatalogRegion, leagueCatalogQuery, setLeagueCatalogQuery,
    leagueCatalogState, addLeagueFromCatalog, loadLeagueCatalog,
  } = useAppContext()

  const haBoard = config.boards.find((b) => b.type === 'home-assistant') || null
  const numLeagues = sportsBoard.leagues.length
  const rawSlotIndex = haBoard?.slotIndex ?? -1
  const haSlotPos = rawSlotIndex < 0 || rawSlotIndex > numLeagues ? numLeagues : rawSlotIndex

  // Build combined ordered items: leagues + HA slot interleaved
  const combinedItems = []
  for (let i = 0; i <= numLeagues; i++) {
    if (i === haSlotPos && haBoard) combinedItems.push({ type: 'ha' })
    if (i < numLeagues) combinedItems.push({ type: 'league', leagueIndex: i })
  }

  // Drag-and-drop state
  const dragFromIndex = useRef(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  function handleDragStart(e, index) {
    dragFromIndex.current = index
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, index) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) setDragOverIndex(index)
  }

  function handleDrop(e, toIndex) {
    e.preventDefault()
    const fromIndex = dragFromIndex.current
    setDragOverIndex(null)
    dragFromIndex.current = null
    if (fromIndex === null || fromIndex === toIndex) return

    const newItems = [...combinedItems]
    const [dragged] = newItems.splice(fromIndex, 1)
    newItems.splice(toIndex, 0, dragged)

    const newLeagues = newItems
      .filter((i) => i.type === 'league')
      .map((i) => sportsBoard.leagues[i.leagueIndex])

    const haNewIdx = newItems.findIndex((i) => i.type === 'ha')
    const leaguesBeforeHa = haNewIdx === -1
      ? numLeagues
      : newItems.slice(0, haNewIdx).filter((i) => i.type === 'league').length

    commitConfig((current) => ({
      ...current,
      boards: current.boards.map((board) => {
        if (board.type === 'sports') return { ...board, leagues: newLeagues }
        if (board.type === 'home-assistant' && haBoard) return { ...board, slotIndex: leaguesBeforeHa }
        return board
      }),
    }))
  }

  function handleDragEnd() {
    setDragOverIndex(null)
    dragFromIndex.current = null
  }

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
              <input
                type="checkbox"
                checked={sportsBoard.enabled}
                onChange={(event) => updateBoard('sports', { enabled: event.target.checked })}
              />
            </label>
            <label className="field">
              <span>Rotate seconds</span>
              <input
                type="number"
                value={sportsBoard.rotateSeconds}
                onChange={(event) => updateBoard('sports', { rotateSeconds: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Refresh seconds</span>
              <input
                type="number"
                value={sportsBoard.refreshSeconds}
                onChange={(event) => updateBoard('sports', { refreshSeconds: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Scroll speed — {sportsBoard.scrollSpeed ?? 110} px/s</span>
              <input
                type="range"
                min="30"
                max="300"
                step="10"
                value={sportsBoard.scrollSpeed ?? 110}
                onChange={(event) => updateBoard('sports', { scrollSpeed: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Card gap (px)</span>
              <input
                type="number"
                min="0"
                max="300"
                value={sportsBoard.cardGap ?? 50}
                onChange={(event) => updateBoard('sports', { cardGap: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Watermark copies</span>
              <select
                value={sportsBoard.watermarkCount ?? 2}
                onChange={(event) => updateBoard('sports', { watermarkCount: Number(event.target.value) })}
              >
                <option value={1}>1 — centered</option>
                <option value={2}>2 — left &amp; right</option>
                <option value={4}>4 — four positions</option>
              </select>
              <small className="field-help">How many times to tile the watermark logo across the display.</small>
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
        {combinedItems.map((item, displayIndex) => {
          const isDragOver = dragOverIndex === displayIndex && dragFromIndex.current !== displayIndex

          if (item.type === 'ha') {
            const isEnabled = haBoard?.enabled !== false
            return (
              <button
                key="ha-slot"
                type="button"
                draggable
                className={`league-summary-card ${isEnabled ? 'is-enabled' : 'is-disabled'}${isDragOver ? ' is-drag-over' : ''}`}
                onDragStart={(e) => handleDragStart(e, displayIndex)}
                onDragOver={(e) => handleDragOver(e, displayIndex)}
                onDrop={(e) => handleDrop(e, displayIndex)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectHA?.()}
              >
                <div className="league-edge" style={{ background: isEnabled ? '#7cf29b' : 'rgba(255,255,255,0.08)' }} />
                <div className="league-order-controls">
                  <span className="league-order-badge">#{displayIndex + 1}</span>
                  <span className="league-drag-handle" title="Drag to reorder">⠿</span>
                </div>
                <p className="league-id">home-assistant</p>
                <h3>Home Assistant</h3>
                <div className="league-card-status-row">
                  <span className={`league-status-badge ${isEnabled ? 'is-enabled' : 'is-disabled'}`}>
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className="league-teams-label">
                    {haBoard?.haCards?.length ?? 0} cards
                  </span>
                </div>
              </button>
            )
          }

          const league = sportsBoard.leagues[item.leagueIndex]
          const teams = leagueTeamsById[league.id] || []
          const cachedMeta = leagueLogoMetaById[league.id]
          const cachedCount = cachedMeta ? Object.keys(cachedMeta.teams || {}).length : 0
          const displayCount = teams.length || cachedCount
          const isCached = !teams.length && cachedCount > 0
          return (
            <button
              key={league.id}
              type="button"
              draggable
              className={`league-summary-card ${league.enabled ? 'is-enabled' : 'is-disabled'}${isDragOver ? ' is-drag-over' : ''}`}
              onDragStart={(e) => handleDragStart(e, displayIndex)}
              onDragOver={(e) => handleDragOver(e, displayIndex)}
              onDrop={(e) => handleDrop(e, displayIndex)}
              onDragEnd={handleDragEnd}
              onClick={async () => {
                onSelectLeague(league.id)
                if (!leagueTeamsById[league.id]) await loadLeagueTeams(league)
                if (!leagueGroupsById[league.id]) await loadLeagueGroups(league)
                if (!leagueTickerPreviewById[league.id]) await loadLeagueTickerPreview(league)
                loadLeagueLogoMeta(league.id)
              }}
            >
              <div className="league-edge" style={{ background: league.enabled ? '#7cf29b' : 'rgba(255,255,255,0.08)' }} />
              <div className="league-order-controls">
                <span className="league-order-badge">#{displayIndex + 1}</span>
                <div className="inline-actions">
                  <span className="league-drag-handle" title="Drag to reorder">⠿</span>
                  <button type="button" className="button-link league-arrow-btn" title="Remove league"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`Remove ${league.name} from your league list?`)) removeLeague(league.id)
                    }}>×</button>
                </div>
              </div>
              <p className="league-id">{league.id}</p>
              <h3>{league.name}</h3>
              <div className="league-card-status-row">
                <span className={`league-status-badge ${league.enabled ? 'is-enabled' : 'is-disabled'}`}>
                  {league.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <span className="league-teams-label">
                  {displayCount > 0 ? `${displayCount} ${isCached ? 'cached' : 'loaded'}` : '0 synced'}
                </span>
              </div>
              <div className="league-logo-strip">
                {teams.length > 0
                  ? teams.slice(0, 4).map((team) => {
                      const cached = getCachedOrRemoteLogo(league.id, team)
                      const primaryLogoHref = cached || resolveTeamPrimaryLogo(team, league.id)
                      return primaryLogoHref ? (
                        <img key={`${league.id}-${team.id}`} src={primaryLogoHref} alt={team.abbreviation || team.name} />
                      ) : null
                    })
                  : cachedMeta
                    ? Object.entries(cachedMeta.teams || {}).slice(0, 4).map(([id, t]) => {
                        const logo = t.logos?.default || t.logos?.scoreboard || t.logos?.headshot
                        return logo ? (
                          <img key={`${league.id}-${id}`} src={`/logos/${logo}`} alt={t.display_name || id} />
                        ) : null
                      })
                    : null}
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}
