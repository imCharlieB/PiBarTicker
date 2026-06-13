export default function DriverDetail({ selectedTickerLeague, driver, onBack }) {
  const color = String(driver.color || '').replace(/^#/, '')
  const headshotPath = driver.logos?.headshot
  const renderPath = driver.logos?.render
  const badgePath = driver.logos?.badge

  const carNum = driver.remote_urls?.car_number || ''
  const teamName = driver.remote_urls?.team_name || ''
  const series = driver.remote_urls?.driver_series || ''
  const manufacturerRaw = driver.remote_urls?.manufacturer || ''
  const manufacturer = manufacturerRaw.startsWith('http') ? '' : manufacturerRaw

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Driver</p>
          <h2>{driver.display_name}</h2>
          <p className="section-note">{selectedTickerLeague.name}{teamName ? ` · ${teamName}` : ''}</p>
        </div>
        <button type="button" className="button-secondary" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="team-details-grid">
        <div className="team-meta-card">
          <h3>Driver info</h3>
          <div className="team-meta-grid">
            <p><strong>Name</strong><span>{driver.display_name}</span></p>
            {driver.abbreviation ? <p><strong>Code (TLA)</strong><span>{driver.abbreviation}</span></p> : null}
            {carNum ? <p><strong>Car #</strong><span>{carNum}</span></p> : null}
            <p><strong>Team</strong><span>{teamName || 'N/A'}</span></p>
            {series ? <p><strong>Series</strong><span>{series}</span></p> : null}
            {manufacturer ? <p><strong>Manufacturer</strong><span>{manufacturer}</span></p> : null}
            {color ? (
              <p><strong>Colour</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 3, background: `#${color}` }} />
                  {`#${color}`}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {headshotPath ? (
            <div>
              <h3>Headshot</h3>
              <img
                src={`/logos/${headshotPath}`}
                alt={driver.display_name}
                style={{ width: 160, height: 160, borderRadius: '50%', objectFit: 'cover', border: `4px solid #${color || '444'}`, display: 'block', marginBottom: 12 }}
              />
            </div>
          ) : (
            <p className="team-explorer-subtitle">No headshot cached — run the sync from the league page.</p>
          )}
          {renderPath ? (
            <div>
              <h3>Full render</h3>
              <img
                src={`/logos/${renderPath}`}
                alt={`${driver.display_name} render`}
                style={{ height: 240, width: 'auto', objectFit: 'contain', display: 'block' }}
              />
            </div>
          ) : null}
          {badgePath ? (
            <div>
              <h3>Car Badge</h3>
              <img
                src={`/logos/${badgePath}`}
                alt={`${driver.display_name} car badge`}
                style={{ width: 120, height: 120, objectFit: 'contain', display: 'block' }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
