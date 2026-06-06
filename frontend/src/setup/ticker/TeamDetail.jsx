import { useAppContext } from '../../AppContext'
import { getLeagueEntityType } from '../helpers'

export default function TeamDetail({ selectedTickerLeague, selectedTickerTeam, onBack }) {
  const {
    leagueLogoMetaById, logoSyncingLeagues,
    loadLeagueLogoMeta, downloadExtrasForTeam, teamLogoDetailsByKey,
  } = useAppContext()

  const cachedTeamMeta = leagueLogoMetaById[selectedTickerLeague.id]?.teams?.[String(selectedTickerTeam.id)] || null
  const cachedVariants = cachedTeamMeta?.logos
    ? Object.entries(cachedTeamMeta.logos).map(([variant, relativePath]) => ({
        variant,
        href: `/logos/${relativePath}`,
        isCached: true,
      }))
    : []

  const selectedTeamLogoDetail = teamLogoDetailsByKey[`${selectedTickerLeague.id}:${selectedTickerTeam.id}`] || null
  const selectedTeamProfile = selectedTeamLogoDetail?.teamProfile || null
  const selectedTeamStandingsStats = selectedTeamProfile?.standings?.stats || {}
  const selectedTeamVenueLocation = selectedTeamProfile?.venue
    ? [selectedTeamProfile.venue.city, selectedTeamProfile.venue.state, selectedTeamProfile.venue.country]
        .filter(Boolean)
        .join(', ')
    : ''

  const entityType = getLeagueEntityType(selectedTickerLeague)

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Team</p>
          <h2>{selectedTickerTeam.name}</h2>
          <p className="section-note">ESPN team info and logo variants.</p>
        </div>
        <button type="button" className="button-secondary" onClick={onBack}>
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
            <p><strong>Primary color</strong><span>{cachedTeamMeta?.color || selectedTickerTeam?.color || 'N/A'}</span></p>
            <p><strong>Alternate color</strong><span>{cachedTeamMeta?.alternate_color || selectedTickerTeam?.alternateColor || 'N/A'}</span></p>
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
                : `No locally cached logos yet for this ${entityType.singular.toLowerCase()}.`}
              <br />
              Use "Sync Teams &amp; Logos" above to download logos.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
