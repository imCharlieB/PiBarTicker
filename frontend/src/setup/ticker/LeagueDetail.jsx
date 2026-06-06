import { useAppContext } from '../../AppContext'
import { parseLeagueApiParams, isIndividualSport, harvestRacingEntities } from '../../api/espnApi'
import { resolveTeamPrimaryLogo, getLeagueEntityType } from '../helpers'

export default function LeagueDetail({
  selectedTickerLeague,
  selectedTickerLeagueIndex,
  selectedLeagueTeams,
  selectedLeagueLoadState,
  onBack,
  onSelectTeam,
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

  return (
    <>
      <div className="league-hero">
        <div className="league-hero-main">
          <p className="section-kicker">Ticker</p>
          <h2>{selectedTickerLeague.name}</h2>
          <p className="league-hero-meta">{selectedLeagueTeams.length} teams loaded</p>
        </div>
        <div className="league-hero-actions">
          <button type="button" className="button-secondary" onClick={onBack}>
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
                  <input type="checkbox" checked={selectedTickerLeague.enabled} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'enabled', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Show TV</span>
                  <input type="checkbox" checked={selectedTickerLeague.showTV} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showTV', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Show odds</span>
                  <input type="checkbox" checked={selectedTickerLeague.showOdds} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showOdds', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Show location</span>
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.showNews)} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showNews', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Live game mode</span>
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.liveGameMode)} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'liveGameMode', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Use team card colors</span>
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.useTeamCardColors)} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'useTeamCardColors', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Card stat: team records</span>
                  <input type="checkbox" checked={selectedTickerLeague.showStatRecords !== false} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatRecords', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Card stat: game clock/period</span>
                  <input type="checkbox" checked={selectedTickerLeague.showStatClock !== false} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatClock', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Card stat: situation detail</span>
                  <input type="checkbox" checked={selectedTickerLeague.showStatSituation !== false} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatSituation', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Card stat: venue detail</span>
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.showStatVenue)} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatVenue', event.target.checked)} />
                </label>
                <label className="field field-checkbox">
                  <span>Card stat: odds detail</span>
                  <input type="checkbox" checked={Boolean(selectedTickerLeague.showStatOdds)} onChange={(event) => updateLeague(selectedTickerLeagueIndex, 'showStatOdds', event.target.checked)} />
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
                  if (!id) return null
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
                        onChange={(event) => toggleLeagueIncludedGroup(selectedTickerLeagueIndex, id, event.target.checked)}
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
                    {selectedLeaguePreviewMatchups.length > 8 ? `, +${selectedLeaguePreviewMatchups.length - 8} more` : ''}
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
          <h3 style={{ margin: 0 }}>{entityType.label}</h3>
          <p className="team-explorer-subtitle">
            Select {entityType.label.toLowerCase()} to include and open details
            {isIndividualSport(leagueApiParams.sport, leagueApiParams.league) ? ' (driver list is best-effort for now)' : ''}
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
                    if (!byId.has(key)) byId.set(key, ent)
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
                onSelectTeam(team.id)
                loadTeamLogosForLeagueTeam(selectedTickerLeague, team)
                loadLeagueLogoMeta(selectedTickerLeague.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectTeam(team.id)
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
                    toggleLeagueIncludedTeam(selectedTickerLeagueIndex, String(team.id), event.target.checked)
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              </label>
            </div>
          )
        })}
      </div>
    </>
  )
}
