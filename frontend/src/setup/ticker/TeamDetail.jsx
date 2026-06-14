import { useState, useEffect } from 'react'
import { useAppContext } from '../../AppContext'
import { getLeagueEntityType } from '../helpers'

function sanitizeColor(raw) {
  if (!raw) return ''
  const s = String(raw).trim().replace(/^#/, '')
  return /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? `#${s}` : ''
}

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
  const teamColor = sanitizeColor(cachedTeamMeta?.color || selectedTickerTeam?.color)
  const abbr = (selectedTickerTeam.abbreviation || selectedTickerTeam.name?.slice(0, 3) || '?').toUpperCase()

  return (
    <>
      <div className="section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            className="team-avatar-box"
            style={{ background: teamColor || 'rgba(255,255,255,0.08)' }}
          >
            {abbr}
          </div>
          <div>
            <p className="section-kicker">Team</p>
            <h2>{selectedTickerTeam.name}</h2>
            <p className="section-note">ESPN team info and logo variants.</p>
          </div>
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
            <p><strong>Conference</strong><span>{cachedTeamMeta?.conference_name || selectedTeamProfile?.group?.name || selectedTeamProfile?.standings?.group?.name || 'N/A'}</span></p>
            <p><strong>Abbreviation</strong><span>{selectedTickerTeam.abbreviation || 'N/A'}</span></p>
            <p><strong>Nickname</strong><span>{selectedTeamProfile?.nickname || 'N/A'}</span></p>
            <p><strong>Location</strong><span>{selectedTickerTeam.location || 'N/A'}</span></p>
            <p><strong>Slug</strong><span>{selectedTeamProfile?.slug || 'N/A'}</span></p>
          </div>

          <h3>Team colors (from cache)</h3>
          <div className="team-meta-grid">
            <p>
              <strong>Primary color</strong>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {teamColor && <i style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: teamColor, flexShrink: 0 }} />}
                {cachedTeamMeta?.color || selectedTickerTeam?.color || 'N/A'}
              </span>
            </p>
            <p>
              <strong>Alternate color</strong>
              <span>{cachedTeamMeta?.alternate_color || selectedTickerTeam?.alternateColor || 'N/A'}</span>
            </p>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {f1Drivers.length > 0 && (
            <div className="team-card-panel">
              <h3 style={{ margin: 0 }}>Drivers</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {f1Drivers.map((d) => {
                  const headshotPath = d.logos?.headshot
                  const dColor = String(d.color || '').replace(/^#/, '')
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
                        ? <img src={`/logos/${headshotPath}`} alt={d.display_name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: `3px solid #${dColor || '444'}` }} />
                        : <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#1a1f2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: `#${dColor || 'fff'}` }}>{d.abbreviation}</div>}
                      <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}>{d.display_name}</span>
                      <span style={{ fontSize: 11, color: '#6b7480', fontWeight: 800, letterSpacing: '.06em' }}>{d.abbreviation}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="team-card-panel">
            <h3 style={{ margin: 0 }}>More logo variants from ESPN</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              The full set of logo variants is available from ESPN. Download them for this team only.
            </p>
            {logoSyncingLeagues[selectedTickerLeague.id] &&
            typeof logoSyncingLeagues[selectedTickerLeague.id] === 'string' &&
            logoSyncingLeagues[selectedTickerLeague.id].includes('extra') ? (
              <p style={{ margin: 0, color: '#666', fontStyle: 'italic', fontSize: '0.85rem' }}>
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
            <div className="team-card-panel">
              <div className="team-card-panel-header">
                <h3 style={{ margin: 0 }}>Local cached logos</h3>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => loadLeagueLogoMeta(selectedTickerLeague.id)}
                >
                  Refresh
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Downloaded locally for this team. Click one to set it as the preferred variant in the ticker.
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
                      style={{
                        border: isPreferred ? '2px solid var(--accent)' : '1px solid var(--panel-border)',
                      }}
                    >
                      {isPreferred && <span className="team-variant-star">★</span>}
                      <img src={href} alt={variant} />
                      <p style={{ color: isPreferred ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {variant}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="team-card-panel">
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {logoSyncingLeagues[selectedTickerLeague.id]
                  ? 'Logos are still downloading for this league…'
                  : `No locally cached logos yet for this ${entityType.singular.toLowerCase()}.`}
                {' '}Use "Sync Teams &amp; Logos" from the league page to download logos.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
