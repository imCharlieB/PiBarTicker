import { parseLeagueApiParams, isIndividualSport } from '../../api/espnApi'

function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 6) return `rgba(100,100,100,${alpha})`
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(100,100,100,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}

export default function DriverDetail({ selectedTickerLeague, driver, onBack }) {
  const leagueParams = parseLeagueApiParams(selectedTickerLeague?.url || '')
  const isRacing = leagueParams.sport === 'racing'
  // Any individual sport that isn't racing (golf, MMA, boxing, tennis, etc.) gets the athlete layout
  const isIndividualAthlete = !isRacing && isIndividualSport(leagueParams.sport, leagueParams.league)

  const displayName = driver.display_name || driver.name || ''
  const color = String(driver.color || '').replace(/^#/, '')
  const hexColor = color ? `#${color}` : '#888'
  const headshotPath = driver.logos?.headshot
  const renderPath = driver.logos?.render
  const badgePath = driver.logos?.badge

  const carNum = driver.remote_urls?.car_number || ''
  const teamName = driver.remote_urls?.team_name || ''
  const series = driver.remote_urls?.driver_series || ''
  const manufacturerRaw = driver.remote_urls?.manufacturer || ''
  const manufacturer = manufacturerRaw.startsWith('http') ? '' : manufacturerRaw

  // MMA-specific fields
  const isMma = leagueParams.sport === 'mma'
  const mmaRecord = driver.remote_urls?.record || ''
  const mmaWeightClass = driver.remote_urls?.weight_class || ''
  const mmaHeight = driver.remote_urls?.height || ''
  const mmaWeight = driver.remote_urls?.weight || ''
  const mmaReach = driver.remote_urls?.reach || ''
  const mmaStance = driver.remote_urls?.stance || ''
  const mmaNationality = driver.remote_urls?.citizenship || ''
  const mmaNickname = driver.remote_urls?.nickname || ''
  const mmaAge = driver.remote_urls?.age || ''
  const mmaGym = driver.remote_urls?.association || ''
  const mmaFlag = driver.remote_urls?.flag || ''

  const badgeStyle = {
    color: hexColor,
    borderColor: color ? hexToRgba(color, 0.4) : 'rgba(255,255,255,0.14)',
    background: color ? hexToRgba(color, 0.12) : 'rgba(255,255,255,0.04)',
  }

  return (
    <>
      <div className="section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {isIndividualAthlete ? (
            headshotPath ? (
              <img
                src={`/logos/${headshotPath}`}
                alt={displayName}
                style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${hexColor}` }}
              />
            ) : (
              <div className="ld-player-initials" style={{ flexShrink: 0 }}>
                {displayName.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('') || '?'}
              </div>
            )
          ) : (
            <div className="driver-num-badge" style={badgeStyle}>
              {carNum || driver.abbreviation || '?'}
            </div>
          )}
          <div>
            <p className="section-kicker">{isMma ? 'Fighter' : isIndividualAthlete ? 'Player' : 'Driver'}</p>
            <h2>{displayName}</h2>
            <p className="section-note">{selectedTickerLeague.name}{!isIndividualAthlete && teamName ? ` · ${teamName}` : ''}</p>
          </div>
        </div>
        <button type="button" className="button-secondary" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="team-details-grid">
        <div className="team-meta-card">
          <h3>{isMma ? 'Fighter info' : isIndividualAthlete ? 'Player info' : 'Driver info'}</h3>
          <div className="team-meta-grid">
            <p><strong>Name</strong><span>{displayName}</span></p>
            {isMma && mmaNickname ? <p><strong>Nickname</strong><span>"{mmaNickname}"</span></p> : null}
            {isMma && mmaRecord ? <p><strong>Record</strong><span>{mmaRecord}</span></p> : null}
            {isMma && mmaWeightClass ? <p><strong>Division</strong><span>{mmaWeightClass}</span></p> : null}
            {isMma && mmaNationality ? (
              <p>
                <strong>Nationality</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {mmaFlag ? <img src={mmaFlag} alt={mmaNationality} style={{ height: 14, width: 'auto' }} /> : null}
                  {mmaNationality}
                </span>
              </p>
            ) : null}
            {isMma && mmaHeight ? <p><strong>Height</strong><span>{mmaHeight}</span></p> : null}
            {isMma && mmaWeight ? <p><strong>Weight</strong><span>{mmaWeight}</span></p> : null}
            {isMma && mmaReach ? <p><strong>Reach</strong><span>{mmaReach}</span></p> : null}
            {isMma && mmaStance ? <p><strong>Stance</strong><span>{mmaStance}</span></p> : null}
            {isMma && mmaAge ? <p><strong>Age</strong><span>{mmaAge}</span></p> : null}
            {isMma && mmaGym ? <p><strong>Gym</strong><span>{mmaGym}</span></p> : null}
            {!isMma && !isIndividualAthlete && carNum ? <p><strong>Car #</strong><span>{carNum}</span></p> : null}
            {!isMma && !isIndividualAthlete && <p><strong>Team</strong><span>{teamName || 'N/A'}</span></p>}
            {!isMma && !isIndividualAthlete && series ? <p><strong>Series</strong><span>{series}</span></p> : null}
            {!isMma && !isIndividualAthlete && manufacturer ? <p><strong>Manufacturer</strong><span>{manufacturer}</span></p> : null}
            {!isMma && color ? (
              <p>
                <strong>Colour</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: hexColor, flexShrink: 0 }} />
                  {hexColor}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="driver-assets-grid">
          <div className="team-card-panel driver-headshot-panel">
            <div className="team-card-panel-kicker">Headshot</div>
            {headshotPath ? (
              <img
                src={`/logos/${headshotPath}`}
                alt={displayName}
                className="driver-headshot-img"
                style={{ borderColor: hexColor }}
              />
            ) : (
              <div className="driver-asset-placeholder">no headshot cached</div>
            )}
          </div>

          {!isIndividualAthlete && (
            <div className="team-card-panel">
              <div className="team-card-panel-kicker">Car badge</div>
              {badgePath ? (
                <img
                  src={`/logos/${badgePath}`}
                  alt={`${displayName} car badge`}
                  style={{ width: 120, height: 120, objectFit: 'contain', display: 'block', margin: '0 auto' }}
                />
              ) : (
                <div className="driver-car-num-placeholder" style={{ color: hexColor }}>
                  {carNum || driver.abbreviation || '?'}
                </div>
              )}
            </div>
          )}

          {!isIndividualAthlete && (
            <div className="team-card-panel driver-render-panel">
              <div className="team-card-panel-kicker">Full render</div>
              {renderPath ? (
                <img
                  src={`/logos/${renderPath}`}
                  alt={`${displayName} render`}
                  style={{ height: 200, width: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto' }}
                />
              ) : (
                <div className="driver-asset-placeholder" style={{ height: 180 }}>
                  car render — run sync from league page to download
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
