import { useAppContext } from '../AppContext'
import { computeSectionChecks } from './helpers'

export default function OverviewPage() {
  const { config, setActivePage } = useAppContext()

  const sportsBoard = config.boards.find((b) => b.type === 'sports')
  const homeAssistantBoard = config.boards.find((b) => b.type === 'home-assistant')
  const enabledLeagues = sportsBoard?.leagues.filter((l) => l.enabled) ?? []
  const sectionChecks = computeSectionChecks(config)
  const completedSetupSections = sectionChecks.filter((c) => c.complete).length

  return (
    <article className="card page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Overview</p>
          <h2>Current configuration snapshot</h2>
          <p className="setup-progress">
            Setup readiness: {completedSetupSections}/{sectionChecks.length} required sections complete
          </p>
        </div>
      </div>

      <div className="readiness-list" aria-label="Setup readiness checklist">
        {sectionChecks.map((check) => (
          <button
            key={check.id}
            type="button"
            className={`readiness-item ${check.complete ? 'is-complete' : 'is-incomplete'}`}
            onClick={() => setActivePage(check.id)}
          >
            <span className="readiness-title">{check.label}</span>
            <span className="readiness-state">{check.complete ? 'Complete' : 'Needs attention'}</span>
            {!check.complete && check.errors[0] ? (
              <span className="readiness-error">{check.errors[0]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="overview-grid">
        <button type="button" className="overview-item" onClick={() => setActivePage('display')}>
          <h3>Display</h3>
          <p>Mode: {config.monitor.mode}</p>
          <p>Resolution: {config.monitor.width} x {config.monitor.height}</p>
          <p>Kiosk startup: {config.kiosk.autoStart}</p>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('theme')}>
          <h3>Theme</h3>
          <p>Mode: {config.theme.mode}</p>
          <p>Background override: {config.theme.background || 'None'}</p>
          <p>Accent override: {config.theme.accent || 'None'}</p>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('services')}>
          <h3>Services</h3>
          <p>HTTP: {config.http.enabled ? `Enabled on ${config.http.port}` : 'Disabled'}</p>
          <p>Home Assistant URL: {config.homeAssistant.url || 'Not set'}</p>
          <p>Sensors: {homeAssistantBoard?.haSensors.length || 0}</p>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('ticker')}>
          <h3>Ticker</h3>
          <p>Board: {sportsBoard?.enabled ? 'Enabled' : 'Disabled'}</p>
          <p>Leagues enabled: {enabledLeagues.length}</p>
          <p>Rotation: {sportsBoard?.rotateSeconds || 0}s</p>
        </button>
      </div>
    </article>
  )
}
