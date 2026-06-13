import { useState, useEffect } from 'react'
import { useAppContext } from '../../AppContext'
import { getLeagueEntityType } from '../helpers'

export default function TeamDetail({ selectedTickerLeague, selectedTickerTeam, onBack, onSelectDriver }) {
  const {
    leagueLogoMetaById, logoSyncingLeagues,
    loadLeagueLogoMeta, downloadExtrasForTeam, teamLogoDetailsByKey,
  } = useAppContext()

  const cachedTeamMeta = leagueLogoMetaById[selectedTickerLeague.id]?.teams?.[String(selectedTickerTeam.id)] || null

  const [f1Drivers, setF1Drivers] = useState([])
  useEffect(() => {
    if (selectedTickerLeague.id !== 'f1') { setF1Drivers([]); return }
    const constructorColor = String(cachedTeamMeta?.color || '').replace(/^#/, '').toLowerCase()
    const constructorName = String(selectedTickerTeam.displayName || selectedTickerTeam.name || '').toLowerCase()
    fetch('/api/v1/logos/meta/f1-drivers')
      .then((r) => r.json())
      .then((data) => {
        const matched = Object.values(data.teams || {}).filter((d) => {
          const dColor = String(d.color || '').replace(/^#/, '').toLowerCase()
          if (constructorColor && dColor && dColor === constructorColor) return true
          const teamName = String(d.remote_urls?.team_name || '').toLowerCase()
          if (!teamName) return false
          return constructorName === teamName || constructorName.includes(teamName) || teamName.includes(constructorName)
        })
        setF1Drivers(matched)
      })
      .catch(() => setF1Drivers([]))
  }, [selectedTickerLeague.id, selectedTickerTeam.id, cachedTeamMeta?.color])
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
          {f1Drivers.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 6 }}>Drivers</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {f1Drivers.map((d) => {
                  const headshotPath = d.logos?.headshot
                  const color = String(d.color || '').replace(/^#/, '')
                  return (
                    <div
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectDriver?.(d)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectDriver?.(d) }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 80, cursor: 'pointer' }}
                    >
                      {headshotPath
                        ? <img src={`/logos/${headshotPath}`} alt={d.display_name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: `3px solid #${color || '444'}` }} />
                        : <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#1a1f2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: `#${color || 'fff'}` }}>{d.abbreviation}</div>}
                      <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}>{d.display_name}</span>
                      <span style={{ fontSize: 11, color: '#6b7480', fontWeight: 800, letterSpacing: '.06em' }}>{d.abbreviation}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
