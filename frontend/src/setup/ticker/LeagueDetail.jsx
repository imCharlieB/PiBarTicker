import { useEffect } from 'react'
import { useAppContext } from '../../AppContext'
import { parseLeagueApiParams, isIndividualSport, harvestRacingEntities, harvestPlayers } from '../../api/espnApi'
import { resolveTeamPrimaryLogo, getLeagueEntityType } from '../helpers'

export default function LeagueDetail({
  selectedTickerLeague,
  selectedTickerLeagueIndex,
  selectedLeagueTeams,
  selectedLeagueLoadState,
  onBack,
  onSelectTeam,
  onSelectDriver,
}) {
  const {
    setNotice,
    leagueLogoMetaById, logoSyncingLeagues, logoClearMessageById, setLogoClearMessageById,
    setLeagueLogoMetaById, setLogoSyncingLeagues,
    loadLeagueLogoMeta, enrichTeamsForLogoSync, triggerLogoCacheForLeague,
    getCachedOrRemoteLogo, loadTeamLogosForLeagueTeam,
    leagueTeamsById, leagueGroupsById, leagueGroupsLoadStateById,
    leagueTickerPreviewById, leagueTickerPreviewLoadStateById,
    loadLeagueTeams, loadLeagueGroups, loadLeagueTickerPreview,
    updateLeague, toggleLeagueIncludedGroup, toggleLeagueIncludedTeam,
    newsLeagueSupport,
  } = useAppContext()

  const selectedLeagueGroups = leagueGroupsById[selectedTickerLeague.id] || []
  const selectedLeagueGroupsLoadState = leagueGroupsLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
  const selectedLeagueTickerPreview = leagueTickerPreviewById[selectedTickerLeague.id] || null
  const selectedLeagueTickerPreviewLoadState = leagueTickerPreviewLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }

  const selectedLeaguePreviewMatchups = Array.from(
    new Set(
      (selectedLeagueTickerPreview?.scoreboard?.events || [])
        .map((event) => {
          const competitors = event?.competitions?.[0]?.competitors || []
          const home = competitors.find((c) => c?.homeAway === 'home')
          const away = competitors.find((c) => c?.homeAway === 'away')
          const homeName = home?.team?.shortDisplayName || home?.team?.displayName || home?.team?.name || home?.team?.abbreviation || ''
          const awayName = away?.team?.shortDisplayName || away?.team?.displayName || away?.team?.name || away?.team?.abbreviation || ''
          if (!homeName && !awayName) return ''
          if (homeName && awayName) return `${homeName} vs ${awayName}`
          return homeName || awayName
        })
        .filter(Boolean),
    ),
  )
  const selectedLeaguePreviewMatchupsText = selectedLeaguePreviewMatchups.slice(0, 8).join(', ')

  const entityType = getLeagueEntityType(selectedTickerLeague)
  const leagueApiParams = parseLeagueApiParams(selectedTickerLeague?.url || '')
  const isRacingLeague = leagueApiParams.sport === 'racing'
  const isGolfLeague = leagueApiParams.sport === 'golf'
  // isIndividualLeague: any sport where athletes compete individually (racing, golf, MMA, boxing, tennis, etc.)
  const isIndividualLeague = isIndividualSport(leagueApiParams.sport, leagueApiParams.league)
  // isNonRacingIndividualLeague: individual sport that isn't racing — uses harvestPlayers and player grid
  const isNonRacingIndividualLeague = isIndividualLeague && !isRacingLeague
  // isBoardLeague: sports that display as a ranked leaderboard (racing standings, golf leaderboard)
  const isBoardLeague = isRacingLeague || isGolfLeague
  const isNascarLeague = isRacingLeague && String(leagueApiParams.league || '').toLowerCase().includes('nascar')
  // When backend support data is loaded, use it; otherwise fall back to sport heuristic:
  // only F1 among racing leagues has a working ESPN news endpoint.
  const _newsEntry = newsLeagueSupport[selectedTickerLeague?.id]
  const leagueHasNews = _newsEntry !== undefined
    ? _newsEntry !== false
    : (!isRacingLeague || selectedTickerLeague?.id === 'f1')

  const _nascarCacheIdMap = { 'nascar-premier': 'nascar-cup', 'nascar-truck': 'nascar-trucks' }
  const _ALL_NASCAR_CACHE_IDS = ['nascar-cup', 'nascar-xfinity', 'nascar-trucks']

  const isF1League = selectedTickerLeague.id === 'f1'

  useEffect(() => {
    if (isNascarLeague) {
      _ALL_NASCAR_CACHE_IDS.forEach((id) => loadLeagueLogoMeta(id))
    } else if (isF1League && !leagueTeamsById['f1']?.length) {
      loadLeagueTeams(selectedTickerLeague)
    } else if (isNonRacingIndividualLeague) {
      loadLeagueLogoMeta(selectedTickerLeague.id)
    }
  }, [isNascarLeague, isF1League, isNonRacingIndividualLeague, selectedTickerLeague.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const nascarDriverList = isNascarLeague
    ? _ALL_NASCAR_CACHE_IDS.flatMap((id) => {
        const meta = leagueLogoMetaById[id]
        if (!meta?.teams) return []
        return Object.entries(meta.teams).map(([key, d]) => ({ key: `${id}:${key}`, ...d }))
      }).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
    : []

  const includedGroupIds = Array.isArray(selectedTickerLeague.includedGroups) ? selectedTickerLeague.includedGroups : []
  const leagueMeta = leagueLogoMetaById[selectedTickerLeague.id] || {}

  // Individual non-racing leagues (golf, MMA, boxing, tennis, etc.): build player list from cached meta.
  // Normalize logos so DriverDetail can find the headshot via player.logos.headshot
  const individualPlayerList = isNonRacingIndividualLeague && leagueMeta?.teams
    ? Object.entries(leagueMeta.teams)
        .filter(([, p]) => p.display_name || p.abbreviation)
        .map(([, p]) => {
          const headshotKey = p.logos?.headshot || p.logos?.default || null
          return {
            key: p.id,
            id: p.id,
            name: p.display_name || p.abbreviation || p.id,
            abbreviation: p.abbreviation || '',
            color: p.color || '',
            alternateColor: p.alternate_color || '',
            logos: headshotKey ? { headshot: headshotKey } : {},
            remote_urls: p.remote_urls || {},
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : []

  const syncTeamsAndLogos = async () => {
    await loadLeagueTeams(selectedTickerLeague)
    let teams = leagueTeamsById[selectedTickerLeague.id] || []
    const params = parseLeagueApiParams(selectedTickerLeague.url || '')

    if (isNonRacingIndividualLeague) {
      // Golf, MMA, boxing, tennis, etc. — use generic player harvest
      setLogoSyncingLeagues((prev) => ({ ...prev, [selectedTickerLeague.id]: 'Fetching players from ESPN…' }))
      setNotice(`Syncing ${selectedTickerLeague.name} — fetching players...`)
      try {
        const players = await harvestPlayers(selectedTickerLeague)
        if (players.length > 0) {
          const byId = new Map(teams.map((t) => [String(t.id), t]))
          for (const p of players) {
            if (!byId.has(String(p.id))) byId.set(String(p.id), p)
          }
          teams = Array.from(byId.values())
        }
      } catch (e) {
        console.warn('harvestPlayers failed', e)
      }
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev }
        if (typeof copy[selectedTickerLeague.id] === 'string') delete copy[selectedTickerLeague.id]
        return copy
      })
    } else if (isRacingLeague) {
      // Racing (F1, IndyCar, non-NASCAR) — use racing-specific harvest
      setLogoSyncingLeagues((prev) => ({ ...prev, [selectedTickerLeague.id]: 'Harvesting drivers from scoreboard…' }))
      setNotice(`Syncing ${selectedTickerLeague.name} — harvesting drivers/teams...`)
      try {
        const racingEntities = await harvestRacingEntities(selectedTickerLeague)
        if (racingEntities.length > 0) {
          const byId = new Map(teams.map((t) => [String(t.id), t]))
          for (const ent of racingEntities) {
            if (!byId.has(String(ent.id))) byId.set(String(ent.id), ent)
          }
          teams = Array.from(byId.values())
        }
      } catch (e) {
        console.warn('harvestRacingEntities failed', e)
      }
      setLogoSyncingLeagues((prev) => {
        const copy = { ...prev }
        if (typeof copy[selectedTickerLeague.id] === 'string' && copy[selectedTickerLeague.id].includes('Harvesting')) delete copy[selectedTickerLeague.id]
        return copy
      })
    }

    if (teams.length > 0) {
      const isFootball = params.sport === 'football'
      // Individual sport headshots come directly from harvestPlayers — skip the per-player ESPN enrich loop
      if (isFootball || isRacingLeague) {
        setLogoSyncingLeagues((prev) => ({ ...prev, [selectedTickerLeague.id]: 'Enriching logos for drivers/teams…' }))
        teams = await enrichTeamsForLogoSync(selectedTickerLeague, teams)
        setLogoSyncingLeagues((prev) => {
          const copy = { ...prev }
          if (typeof copy[selectedTickerLeague.id] === 'string') delete copy[selectedTickerLeague.id]
          return copy
        })
      }
      triggerLogoCacheForLeague(selectedTickerLeague.id, teams, params.sport).catch((err) => {
        console.warn('Logo cache failed:', err)
      })
      setTimeout(() => loadLeagueLogoMeta(selectedTickerLeague.id), 300)
    } else {
      setNotice(isNonRacingIndividualLeague
        ? `Sync for ${selectedTickerLeague.name} found no players. The league may be off-season or the URL may be incorrect.`
        : isRacingLeague
          ? `Sync for ${selectedTickerLeague.name} didn't find many drivers right now (common depending on season/events).`
          : `Sync found no teams for ${selectedTickerLeague.name}. Try loading preview first or check the league URL.`)
    }
  }

  const clearCachedLogos = async () => {
    const leagueId = selectedTickerLeague.id
    try {
      await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, { method: 'DELETE' })
      setNotice(`Cleared cached logos for ${selectedTickerLeague.name}.`)
    } catch (_e) { /* still clear local state */ }
    setLogoClearMessageById((prev) => ({ ...prev, [leagueId]: 'Cache cleared — logos folder + meta deleted from disk.' }))
    setTimeout(() => {
      setLogoClearMessageById((prev) => { const next = { ...prev }; delete next[leagueId]; return next })
    }, 4500)
    setLeagueLogoMetaById((current) => { const copy = { ...current }; delete copy[leagueId]; return copy })
  }

  return (
    <>
      {/* Hero */}
      <div className="ld-hero">
        <div className="ld-hero-left">
          <p className="section-kicker">Ticker</p>
          <h2 className="ld-hero-name">{selectedTickerLeague.name}</h2>
          <div className="ld-hero-meta-row">
            <span className={`ld-enabled-badge ${selectedTickerLeague.enabled ? 'is-enabled' : 'is-disabled'}`}>
              {selectedTickerLeague.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className="ld-hero-count">
              {isNascarLeague && nascarDriverList.length > 0
                ? `${nascarDriverList.length} drivers cached`
                : isNonRacingIndividualLeague && individualPlayerList.length > 0
                  ? `${individualPlayerList.length} players cached`
                  : `${selectedLeagueTeams.length} ${entityType.label.toLowerCase()} loaded`}
            </span>
          </div>
        </div>
        <button type="button" className="button-secondary" onClick={onBack}>
          Back to leagues
        </button>
      </div>

      {/* Settings panel */}
      {selectedTickerLeagueIndex >= 0 && (
        <div className="ld-settings-panel">
          <div className="ld-settings-header">
            <h3>League settings</h3>
            <p className="ld-settings-caption">Changes stage until you save</p>
          </div>

          {/* Segmented controls */}
          <div className="ld-seg-controls-row">
            <div className="ld-seg-control">
              <span className="ld-seg-label">Card style</span>
              <div className="seg-pill">
                {[['standard','Standard'],['large-logo','Large Logo'],['slab','Slab'],['spine','Spine'],['digits','Digits'],['marquee','Marquee']].map(([val, label]) => (
                  <button key={val} type="button"
                    className={`seg-pill-btn${(selectedTickerLeague.cardStyle || 'standard') === val ? ' is-active' : ''}`}
                    onClick={() => updateLeague(selectedTickerLeagueIndex, 'cardStyle', val)}
                  >{label}</button>
                ))}
              </div>
            </div>

            {isBoardLeague && (
              <div className="ld-seg-control">
                <span className="ld-seg-label">Entry limit</span>
                <div className="seg-pill">
                  {[[null,'All'],[5,'5'],[10,'10'],[25,'25']].map(([val, label]) => (
                    <button key={label} type="button"
                      className={`seg-pill-btn${(selectedTickerLeague.entryLimit ?? null) === val ? ' is-active' : ''}`}
                      onClick={() => updateLeague(selectedTickerLeagueIndex, 'entryLimit', val)}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}

            {/college/i.test(leagueApiParams.league || '') && (
              <div className="ld-seg-control">
                <span className="ld-seg-label">AP ranking filter</span>
                <div className="seg-pill">
                  {[[null,'All'],[10,'Top 10'],[25,'Top 25']].map(([val, label]) => (
                    <button key={label} type="button"
                      className={`seg-pill-btn${(selectedTickerLeague.rankingsFilter ?? null) === val ? ' is-active' : ''}`}
                      onClick={() => updateLeague(selectedTickerLeagueIndex, 'rankingsFilter', val)}
                    >{label}</button>
                  ))}
                </div>
                <small className="ld-seg-help">Show only games where at least one team is ranked in the AP Top 25.</small>
              </div>
            )}

          </div>

          {/* Card & Feed toggles */}
          <div className="ld-toggles-group">
            <div className="ld-toggles-kicker">Card &amp; Feed Toggles</div>
            <div className="ld-toggle-row">
              <div className="ld-toggle-left">
                <span className="ld-toggle-label">League enabled</span>
                <span className="ld-toggle-desc">Include this league in the live ticker rotation.</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={selectedTickerLeague.enabled}
                  onChange={(e) => updateLeague(selectedTickerLeagueIndex, 'enabled', e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="ld-toggle-row">
              <div className="ld-toggle-left">
                <span className="ld-toggle-label">Live game mode</span>
                <span className="ld-toggle-desc">{isRacingLeague ? 'Enhanced in-progress visuals: lap, position, pit status.' : 'Enhanced in-progress visuals: clock, possession, situation.'}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={Boolean(selectedTickerLeague.liveGameMode)}
                  onChange={(e) => updateLeague(selectedTickerLeagueIndex, 'liveGameMode', e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
            {leagueHasNews && (
              <div className="ld-toggle-row">
                <div className="ld-toggle-left">
                  <span className="ld-toggle-label">Show news headlines</span>
                  <span className="ld-toggle-desc">Append ESPN news headlines for this league at the end of the game cards in the ticker.</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.showNews)}
                    onChange={(e) => updateLeague(selectedTickerLeagueIndex, 'showNews', e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            )}
            <div className="ld-toggle-row" style={{ alignItems: 'flex-start' }}>
              <div className="ld-toggle-left">
                <span className="ld-toggle-label">Detail density</span>
                <span className="ld-toggle-desc">{isRacingLeague ? 'Min: positions only. Balanced: adds laps, gaps, pit status. Maximal: also adds manufacturer and stage.' : 'Min: scores only. Balanced: adds records, clock, situation, TV. Maximal: also adds venue and odds.'}</span>
              </div>
              <div className="seg-pill" style={{ flexShrink: 0 }}>
                {[['min','Minimal'],['bal','Balanced'],['max','Maximal']].map(([val, label]) => (
                  <button key={val} type="button"
                    className={`seg-pill-btn${(selectedTickerLeague.density || 'bal') === val ? ' is-active' : ''}`}
                    onClick={() => updateLeague(selectedTickerLeagueIndex, 'density', val)}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="ld-toggle-row">
              <div className="ld-toggle-left">
                <span className="ld-toggle-label">Team colors</span>
                <span className="ld-toggle-desc">{isRacingLeague ? 'How strongly driver / manufacturer colors tint each card.' : isNonRacingIndividualLeague ? 'How strongly player colors tint each card.' : 'How strongly team brand colors tint each card.'}</span>
              </div>
              <div className="seg-pill" style={{ flexShrink: 0 }}>
                {[['full','Full'],['accent','Accent'],['neutral','Neutral']].map(([val, label]) => (
                  <button key={val} type="button"
                    className={`seg-pill-btn${(selectedTickerLeague.colorMode || 'full') === val ? ' is-active' : ''}`}
                    onClick={() => updateLeague(selectedTickerLeagueIndex, 'colorMode', val)}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Feed filter */}
          <div className="ld-sub-panel">
            <div className="ld-sub-panel-header">
              <span className="ld-sub-panel-kicker">Feed Filter (server-side)</span>
            </div>
            <div className="ld-filter-select-wrap">
              <select
                value={selectedTickerLeague.gameFilter || 'all'}
                onChange={(e) => updateLeague(selectedTickerLeagueIndex, 'gameFilter', e.target.value)}
              >
                <option value="all">All (no filter)</option>
                <option value="live">Live only</option>
                <option value="today">Today</option>
                <option value="upcoming">Upcoming</option>
                <option value="this-week">This week (football)</option>
              </select>
            </div>
            <p className="ld-filter-help">Filters at the ESPN API level for smaller, faster responses. Does not enable live card visuals — those come from Live game mode.</p>
            <div className="ld-sub-divider" />
            <div className="ld-toggle-row">
              <div className="ld-toggle-left">
                <span className="ld-toggle-label">Fallback if empty</span>
                <span className="ld-toggle-desc">If strict filter returns no games, broaden results so the ticker stays useful</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={Boolean(selectedTickerLeague.fallbackWhenEmpty)}
                  onChange={(e) => updateLeague(selectedTickerLeagueIndex, 'fallbackWhenEmpty', e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          {/* Conference / group filter — only for team sports (not individual) */}
          {!isIndividualLeague && (
            <div className="ld-sub-panel">
              <div className="ld-sub-panel-header">
                <span className="ld-sub-panel-kicker">Conference / Division / Group Filter</span>
                <button type="button" className="button-link"
                  onClick={() => loadLeagueGroups(selectedTickerLeague)}
                  disabled={selectedLeagueGroupsLoadState.loading}
                >
                  {selectedLeagueGroupsLoadState.loading ? 'Refreshing...' : 'Refresh groups'}
                </button>
              </div>
              {selectedLeagueGroupsLoadState.error
                ? <p className="field-error" style={{ margin: 0 }}>{selectedLeagueGroupsLoadState.error}</p>
                : null}
              {selectedLeagueGroups.length > 0 ? (
                <>
                  <div className="ld-group-tags-input">
                    {includedGroupIds.map((id) => {
                      const grp = selectedLeagueGroups.find((g) => String(g.id) === id)
                      const label = grp ? (grp.name || grp.abbreviation || id) : id
                      return (
                        <span key={id} className="ld-group-tag"
                          onClick={() => toggleLeagueIncludedGroup(selectedTickerLeagueIndex, id, false)}
                        >
                          {label}
                          <span className="ld-group-tag-x">×</span>
                        </span>
                      )
                    })}
                    <span className="ld-group-tags-placeholder">
                      {includedGroupIds.length === 0 ? 'All conferences included — click below to filter' : 'Search to add a conference…'}
                    </span>
                    {includedGroupIds.length > 0 && (
                      <span className="ld-group-count-badge">{includedGroupIds.length} selected</span>
                    )}
                  </div>
                  <p className="ld-group-tags-help">Selected conferences pin here as removable tags — pick more from the list below.</p>
                  <div className="ld-groups-list">
                    {selectedLeagueGroups.map((group) => {
                      const id = String(group.id || '').trim()
                      if (!id) return null
                      const isSelected = includedGroupIds.includes(id)
                      const parentName = group.parent?.name ? ` (${group.parent.name})` : ''
                      const label = group.name || group.abbreviation || id
                      return (
                        <button key={`${selectedTickerLeague.id}-${id}`} type="button"
                          className={`ld-group-item${isSelected ? ' is-selected' : ''}`}
                          onClick={() => toggleLeagueIncludedGroup(selectedTickerLeagueIndex, id, !isSelected)}
                        >
                          <span>{label}{parentName}</span>
                          {isSelected
                            ? <span className="ld-group-check">✓</span>
                            : <span className="ld-group-add">+</span>}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="field-help" style={{ margin: 0 }}>No group metadata loaded. Click Refresh groups to load.</p>
              )}
            </div>
          )}

          {/* Ticker filter preview */}
          <div className="ld-sub-panel">
            <div className="ld-sub-panel-header">
              <span className="ld-sub-panel-kicker">Ticker filter preview</span>
              <button type="button" className="button-link"
                onClick={() => loadLeagueTickerPreview(selectedTickerLeague)}
                disabled={selectedLeagueTickerPreviewLoadState.loading}
              >
                {selectedLeagueTickerPreviewLoadState.loading ? 'Refreshing...' : 'Refresh preview'}
              </button>
            </div>
            {selectedLeagueTickerPreviewLoadState.error
              ? <p className="field-error" style={{ margin: 0 }}>{selectedLeagueTickerPreviewLoadState.error}</p>
              : null}
            {selectedLeagueTickerPreview ? (
              <>
                <p className="field-help" style={{ margin: '0 0 4px', fontSize: '13px', color: '#93969c' }}>
                  Showing {selectedLeagueTickerPreview.eventCount} of {selectedLeagueTickerPreview.rawEventCount || selectedLeagueTickerPreview.eventCount} events after filters.
                  {selectedLeagueTickerPreview.appliedFilters?.gameFilter && selectedLeagueTickerPreview.appliedFilters.gameFilter !== 'all' && (
                    <> (filter: {selectedLeagueTickerPreview.appliedFilters.gameFilter})</>
                  )}
                </p>
                {selectedLeaguePreviewMatchups.length > 0 && (
                  <p className="field-help" style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.6 }}>
                    Matchups: {selectedLeaguePreviewMatchupsText}
                    {selectedLeaguePreviewMatchups.length > 8 ? `, +${selectedLeaguePreviewMatchups.length - 8} more` : ''}
                  </p>
                )}
              </>
            ) : (
              <p className="field-help" style={{ margin: 0 }}>Load preview to verify week/team/group filters for this league.</p>
            )}
          </div>
        </div>
      )}

      {/* Explorer header */}
      <div className="ld-explorer-header">
        <div>
          <h3 style={{ margin: 0 }}>{entityType.label}</h3>
          <p className="ld-explorer-subtitle">
            {isNascarLeague
              ? nascarDriverList.length > 0
                ? `${nascarDriverList.length} drivers synced from cf.nascar.com — badges shown below`
                : 'Click "Sync NASCAR Drivers & Assets" to load driver badges'
              : isIndividualLeague
                ? `Select ${entityType.label.toLowerCase()} to view details`
                : `Select ${entityType.label.toLowerCase()} to include and open details`}
          </p>
        </div>
        <div className="ld-explorer-actions">
          {!isNascarLeague && !isF1League && (
            <button type="button" className="ld-explorer-btn"
              onClick={syncTeamsAndLogos}
              disabled={selectedLeagueLoadState.loading}
            >
              {selectedLeagueLoadState.loading ? 'Syncing...' : isNonRacingIndividualLeague ? 'Sync Players & Headshots' : 'Sync Teams & Logos'}
            </button>
          )}
          {selectedTickerLeague.id === 'f1' && (
            <button type="button" className="ld-explorer-btn"
              onClick={async () => {
                setLogoSyncingLeagues((prev) => ({ ...prev, f1: 'Syncing F1 drivers, cars & circuits…' }))
                try {
                  const res = await fetch('/api/v1/logos/cache/f1/sync', { method: 'POST' })
                  const data = await res.json()
                  const drivers = data?.drivers?.drivers_synced ?? 0
                  const cars = data?.team_cars?.teams_synced ?? 0
                  const circuits = data?.circuits?.circuits_synced ?? 0
                  const failed = data?.circuits?.circuits_failed ?? []
                  const failedMsg = failed.length
                    ? ` ⚠️ ${failed.length} circuit map(s) not found: ${failed.map(f => f.country).join(', ')} — add to _KNOWN_CIRCUITS in f1_cache_service.py`
                    : ''
                  setNotice(`F1 sync complete — ${drivers} drivers, ${cars} cars, ${circuits} circuits cached.${failedMsg}`)
                  loadLeagueLogoMeta('f1')
                  loadLeagueLogoMeta('f1-drivers')
                } catch (e) {
                  setNotice(`F1 sync failed: ${e.message}`)
                } finally {
                  setLogoSyncingLeagues((prev) => { const copy = { ...prev }; delete copy.f1; return copy })
                }
              }}
            >
              Sync F1 Drivers & Assets
            </button>
          )}
          {isNascarLeague && (
            <button type="button" className="ld-explorer-btn"
              disabled={!!logoSyncingLeagues[selectedTickerLeague.id]}
              onClick={async () => {
                const lid = selectedTickerLeague.id
                setLogoSyncingLeagues((prev) => ({ ...prev, [lid]: 'Syncing NASCAR drivers…' }))
                setNotice('Downloading NASCAR driver images from cf.nascar.com — this may take a minute…')
                try {
                  const res = await fetch('/api/v1/logos/cache/nascar/sync', { method: 'POST' })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
                  const d = data?.drivers || {}
                  const bySeries = d.by_series || {}
                  const cup = bySeries['nascar-cup'] ?? 0
                  const xfinity = bySeries['nascar-xfinity'] ?? 0
                  const trucks = bySeries['nascar-trucks'] ?? 0
                  const parts = [cup && `${cup} Cup`, xfinity && `${xfinity} Xfinity`, trucks && `${trucks} Trucks`].filter(Boolean)
                  const badges = d.badges_downloaded ?? 0
                  const headshots = d.headshots_downloaded ?? 0
                  const seriesLogos = d.series_logos_downloaded ?? 0
                  const imgParts = [badges && `${badges} badges`, headshots && `${headshots} headshots`, seriesLogos && `${seriesLogos} series logos`].filter(Boolean)
                  setNotice(`NASCAR sync complete — ${parts.join(', ')} drivers. ${imgParts.length ? `Downloaded: ${imgParts.join(', ')}.` : 'Images already cached.'}`)
                  loadLeagueLogoMeta('nascar-cup')
                  loadLeagueLogoMeta('nascar-xfinity')
                  loadLeagueLogoMeta('nascar-trucks')
                } catch (e) {
                  setNotice(`NASCAR sync failed: ${e.message}`)
                } finally {
                  setLogoSyncingLeagues((prev) => { const copy = { ...prev }; delete copy[lid]; return copy })
                }
              }}
            >
              {logoSyncingLeagues[selectedTickerLeague.id] ? 'Syncing NASCAR drivers…' : 'Sync NASCAR Drivers & Assets'}
            </button>
          )}
          <button type="button" className="ld-explorer-btn is-danger" onClick={clearCachedLogos}>
            Clear Cached Logos
          </button>
        </div>
      </div>

      {/* Status messages */}
      {logoClearMessageById[selectedTickerLeague.id] && (
        <p style={{ color: '#4ade80', fontSize: '0.85em', margin: '0 0 8px', fontWeight: 500 }}>
          {logoClearMessageById[selectedTickerLeague.id]}
        </p>
      )}
      {selectedLeagueLoadState.loading && !(isNonRacingIndividualLeague && individualPlayerList.length > 0) && <p className="field-help">Loading team data from ESPN...</p>}
      {selectedLeagueLoadState.error && <p className="field-error">{selectedLeagueLoadState.error}</p>}
      {logoSyncingLeagues[selectedTickerLeague.id] && (
        <p style={{ color: '#6b7480', fontStyle: 'italic', fontSize: '0.85rem', margin: '0 0 8px' }}>
          {typeof logoSyncingLeagues[selectedTickerLeague.id] === 'string'
            ? logoSyncingLeagues[selectedTickerLeague.id]
            : 'Downloading logo variants… (large leagues like NCAA can take a couple minutes)'}
        </p>
      )}
      {isNascarLeague && _ALL_NASCAR_CACHE_IDS.every((id) => !leagueLogoMetaById[id]) && (
        <p className="field-help">Loading driver data…</p>
      )}

      {/* Driver grid — racing leagues */}
      {isRacingLeague && (
        isNascarLeague
          ? nascarDriverList.length > 0 && (
            <div className="ld-driver-grid">
              {nascarDriverList.map((driver) => {
                const carNum = driver.remote_urls?.car_number || ''
                const teamName = driver.remote_urls?.team_name || ''
                const driverColor = String(driver.color || '').replace(/^#/, '')
                const hexColor = driverColor ? `#${driverColor}` : 'rgba(255,255,255,0.45)'
                const localBadge = driver.logos?.badge ? `/logos/${driver.logos.badge}` : null
                return (
                  <div key={driver.key} className="ld-driver-card"
                    role="button" tabIndex={0}
                    onClick={() => onSelectDriver?.(driver)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDriver?.(driver) } }}
                  >
                    {localBadge
                      ? <img src={localBadge} alt={driver.display_name} className="ld-driver-badge-img" />
                      : <div className="ld-driver-num" style={{ color: hexColor }}>{carNum || driver.abbreviation || '?'}</div>}
                    <div className="ld-driver-name">{driver.display_name}</div>
                    {(carNum || teamName) && (
                      <div className="ld-driver-meta">#{carNum || '?'}{teamName ? ` · ${teamName}` : ''}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
          : selectedLeagueTeams.length > 0 && (
            <div className="ld-driver-grid">
              {selectedLeagueTeams.map((team) => {
                const carNum = team.remote_urls?.car_number || team.abbreviation || ''
                const teamName = team.remote_urls?.team_name || team.name || ''
                const driverColor = String(team.color || '').replace(/^#/, '')
                const hexColor = driverColor ? `#${driverColor}` : 'rgba(255,255,255,0.45)'
                const cachedLogo = getCachedOrRemoteLogo(selectedTickerLeague.id, team) || resolveTeamPrimaryLogo(team, selectedTickerLeague.id)
                return (
                  <div key={`${selectedTickerLeague.id}-${team.id}`} className="ld-driver-card"
                    role="button" tabIndex={0}
                    onClick={() => { if (isF1League) { onSelectTeam?.(team.id); loadTeamLogosForLeagueTeam(selectedTickerLeague, team); loadLeagueLogoMeta(selectedTickerLeague.id) } else { onSelectDriver?.(team) } }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isF1League) { onSelectTeam?.(team.id); loadTeamLogosForLeagueTeam(selectedTickerLeague, team) } else { onSelectDriver?.(team) } } }}
                  >
                    {cachedLogo
                      ? <img src={cachedLogo} alt={team.name} className="ld-driver-badge-img" />
                      : <div className="ld-driver-num" style={{ color: hexColor }}>{carNum || '?'}</div>}
                    <div className="ld-driver-name">{team.name}</div>
                    {teamName && teamName !== team.name && (
                      <div className="ld-driver-meta">{teamName}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
      )}

      {/* Player grid — individual non-racing leagues (golf, MMA, boxing, tennis, etc.) */}
      {isNonRacingIndividualLeague && individualPlayerList.length > 0 && (
        <div className="ld-driver-grid">
          {individualPlayerList.map((player) => {
            const cachedLogo = getCachedOrRemoteLogo(selectedTickerLeague.id, player)
            const initials = player.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('')
            return (
              <div key={player.id} className="ld-driver-card"
                role="button" tabIndex={0}
                onClick={() => onSelectDriver?.(player)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDriver?.(player) } }}
              >
                {cachedLogo
                  ? <img src={cachedLogo} alt={player.name} className="ld-driver-badge-img" />
                  : <div className="ld-player-initials">{initials || '?'}</div>}
                <div className="ld-driver-name">{player.name}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Team grid — team sports only */}
      {!isIndividualLeague && selectedLeagueTeams.length > 0 && (
        <div className="ld-team-grid">
          {selectedLeagueTeams.map((team) => {
            const cachedMeta = leagueMeta?.teams?.[String(team.id)]
            const rawColor = cachedMeta?.color || team.color || ''
            const teamColor = rawColor ? (rawColor.startsWith('#') ? rawColor : `#${rawColor.replace(/^#/, '')}`) : ''
            const abbr = (team.abbreviation || team.name?.slice(0, 3) || '?').toUpperCase()
            const confName = cachedMeta?.conference_name || ''
            const includedTeamIds = Array.isArray(selectedTickerLeague.includedTeams) ? selectedTickerLeague.includedTeams : []
            const isIncluded = includedTeamIds.includes(String(team.id))
            const cachedLogo = getCachedOrRemoteLogo(selectedTickerLeague.id, team)
            return (
              <div key={`${selectedTickerLeague.id}-${team.id}`}
                className={`ld-team-card${isIncluded ? ' is-included' : ''}`}
                role="button" tabIndex={0}
                onClick={() => {
                  onSelectTeam(team.id)
                  loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                  loadLeagueLogoMeta(selectedTickerLeague.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectTeam(team.id)
                    loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                  }
                }}
              >
                <div className="ld-team-card-top">
                  <div className="ld-team-avatar" style={{ background: teamColor || 'rgba(255,255,255,0.08)' }}>
                    {cachedLogo
                      ? <img src={cachedLogo} alt={abbr} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      : abbr}
                  </div>
                  <div>
                    <div className="ld-team-name">{team.name}</div>
                    {confName && <div className="ld-team-conf">{confName}</div>}
                  </div>
                </div>
                <div className="ld-team-include"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleLeagueIncludedTeam(selectedTickerLeagueIndex, String(team.id), !isIncluded)
                  }}
                >
                  <span className={`ld-team-check${isIncluded ? ' is-checked' : ''}`}>{isIncluded ? '✓' : ''}</span>
                  <span className="ld-team-include-label">Include in ticker</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
