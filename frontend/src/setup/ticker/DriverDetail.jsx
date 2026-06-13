export default function DriverDetail({ selectedTickerLeague, driver, onBack }) {
  const color = String(driver.color || '').replace(/^#/, '')
  const headshotPath = driver.logos?.headshot

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Driver</p>
          <h2>{driver.display_name}</h2>
          <p className="section-note">{selectedTickerLeague.name} · {driver.remote_urls?.team_name || ''}</p>
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
            <p><strong>Code (TLA)</strong><span>{driver.abbreviation}</span></p>
            <p><strong>Team</strong><span>{driver.remote_urls?.team_name || 'N/A'}</span></p>
            <p><strong>Team colour</strong>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {color ? <i style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 3, background: `#${color}` }} /> : null}
                {color ? `#${color}` : 'N/A'}
              </span>
            </p>
          </div>
        </div>

        <div>
          {headshotPath ? (
            <>
              <h3>Headshot</h3>
              <img
                src={`/logos/${headshotPath}`}
                alt={driver.display_name}
                style={{ width: 160, height: 160, borderRadius: '50%', objectFit: 'cover', border: `4px solid #${color || '444'}`, display: 'block', marginBottom: 12 }}
              />
            </>
          ) : (
            <p className="team-explorer-subtitle">No headshot cached yet — run "Sync F1 Drivers &amp; Assets" from the league page.</p>
          )}
        </div>
      </div>
    </>
  )
}
