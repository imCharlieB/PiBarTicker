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
    <article className="page-card">
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
            <span className="readiness-item-left">
              <span className={`readiness-dot ${check.complete ? 'is-complete' : 'is-incomplete'}`} />
              <span className="readiness-title">{check.label}</span>
              {!check.complete && check.errors[0] ? (
                <span className="readiness-error">{check.errors[0]}</span>
              ) : null}
            </span>
            <span className={`readiness-badge ${check.complete ? 'is-complete' : 'is-incomplete'}`}>
              {check.complete ? 'Complete' : 'Needs attention'}
            </span>
          </button>
        ))}
      </div>

      <div className="overview-grid">
        <button type="button" className="overview-item" onClick={() => setActivePage('display')}>
          <div className="overview-item-header">
            <h3>Display</h3>
            <span className="overview-item-arrow">›</span>
          </div>
          <div className="overview-kv-list">
            <div className="overview-kv-row"><span>Mode</span><span>{config.monitor.mode}</span></div>
            <div className="overview-kv-row"><span>Resolution</span><span>{config.monitor.width} × {config.monitor.height}</span></div>
            <div className="overview-kv-row"><span>Kiosk startup</span><span>{config.kiosk.autoStart}</span></div>
          </div>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('theme')}>
          <div className="overview-item-header">
            <h3>Theme</h3>
            <span className="overview-item-arrow">›</span>
          </div>
          <div className="overview-kv-list">
            <div className="overview-kv-row"><span>Mode</span><span>{config.theme.mode}</span></div>
            <div className="overview-kv-row"><span>Background</span><span>{config.theme.background || 'Default'}</span></div>
            <div className="overview-kv-row"><span>Accent</span><span>{config.theme.accent || 'Default'}</span></div>
          </div>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('services')}>
          <div className="overview-item-header">
            <h3>Services</h3>
            <span className="overview-item-arrow">›</span>
          </div>
          <div className="overview-kv-list">
            <div className="overview-kv-row"><span>HTTP</span><span>{config.http.enabled ? `Enabled · :${config.http.port}` : 'Disabled'}</span></div>
            <div className="overview-kv-row"><span>Home Assistant</span><span>{config.homeAssistant.url || 'Not set'}</span></div>
            <div className="overview-kv-row"><span>Sensors</span><span>{homeAssistantBoard?.haSensors.length || 0}</span></div>
          </div>
        </button>
        <button type="button" className="overview-item" onClick={() => setActivePage('ticker')}>
          <div className="overview-item-header">
            <h3>Ticker</h3>
            <span className="overview-item-arrow">›</span>
          </div>
          <div className="overview-kv-list">
            <div className="overview-kv-row"><span>Board</span><span>{sportsBoard?.enabled ? 'Enabled' : 'Disabled'}</span></div>
            <div className="overview-kv-row"><span>Leagues enabled</span><span>{enabledLeagues.length}</span></div>
            <div className="overview-kv-row"><span>Rotation</span><span>{sportsBoard?.rotateSeconds || 0}s</span></div>
          </div>
        </button>
      </div>
    </article>
  )
}
