import { useAppContext } from '../AppContext'
import { parseList, listToText, computeServicesErrors } from './helpers'

export default function ServicesPage() {
  const { config, updateConfigSection, updateBoard } = useAppContext()
  const homeAssistantBoard = config.boards.find((b) => b.type === 'home-assistant')
  const servicesErrors = computeServicesErrors(config)

  return (
    <article className="page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Services</p>
          <h2>Home Assistant and HTTP</h2>
        </div>
      </div>

      <div className="field-grid field-grid-2">
        <label className="field field-full">
          <span>Home Assistant URL</span>
          <input type="text"
            value={config.homeAssistant.url}
            onChange={(e) => updateConfigSection('homeAssistant', 'url', e.target.value)} />
          {servicesErrors.url ? <small className="field-error">{servicesErrors.url}</small> : null}
        </label>

        <label className="field field-full">
          <span>Home Assistant access token</span>
          <input type="password"
            value={config.homeAssistant.token}
            onChange={(e) => updateConfigSection('homeAssistant', 'token', e.target.value)} />
          <small className="field-help">Used only to fetch local Home Assistant sensor values.</small>
        </label>

        {/* HTTP enabled — toggle switch */}
        <div className="page-toggle-group">
          <div className="page-toggle-row">
            <div>
              <div className="page-toggle-label">HTTP enabled</div>
              <div className="page-toggle-desc">Expose a local HTTP server for remote control and status</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox"
                checked={config.http.enabled}
                onChange={(e) => updateConfigSection('http', 'enabled', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <label className="field">
          <span>HTTP port</span>
          <input type="number"
            value={config.http.port}
            onChange={(e) => updateConfigSection('http', 'port', Number(e.target.value))} />
          {servicesErrors.port ? <small className="field-error">{servicesErrors.port}</small> : null}
        </label>

        {homeAssistantBoard ? (
          <label className="field field-full">
            <span>Lower-third sensors</span>
            <textarea
              rows="6"
              value={listToText(homeAssistantBoard.haSensors)}
              onChange={(e) => updateBoard('home-assistant', { haSensors: parseList(e.target.value) })} />
          </label>
        ) : null}
      </div>
    </article>
  )
}
