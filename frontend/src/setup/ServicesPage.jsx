import { useAppContext } from '../AppContext'
import { parseList, listToText, computeServicesErrors } from './helpers'

export default function ServicesPage() {
  const { config, updateConfigSection, updateBoard } = useAppContext()
  const homeAssistantBoard = config.boards.find((b) => b.type === 'home-assistant')
  const servicesErrors = computeServicesErrors(config)

  return (
    <article className="card page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Services</p>
          <h2>Home Assistant and HTTP</h2>
        </div>
      </div>

      <div className="field-grid field-grid-2">
        <label className="field field-full">
          <span>Home Assistant URL</span>
          <input type="text" value={config.homeAssistant.url} onChange={(event) => updateConfigSection('homeAssistant', 'url', event.target.value)} />
          {servicesErrors.url ? <small className="field-error">{servicesErrors.url}</small> : null}
        </label>

        <label className="field field-full">
          <span>Home Assistant access token</span>
          <input type="password" value={config.homeAssistant.token} onChange={(event) => updateConfigSection('homeAssistant', 'token', event.target.value)} />
          <small className="field-help">Used only to fetch local Home Assistant sensor values.</small>
        </label>

        <label className="field field-checkbox">
          <span>HTTP enabled</span>
          <input type="checkbox" checked={config.http.enabled} onChange={(event) => updateConfigSection('http', 'enabled', event.target.checked)} />
        </label>

        <label className="field">
          <span>HTTP port</span>
          <input type="number" value={config.http.port} onChange={(event) => updateConfigSection('http', 'port', Number(event.target.value))} />
          {servicesErrors.port ? <small className="field-error">{servicesErrors.port}</small> : null}
        </label>

        {homeAssistantBoard ? (
          <label className="field field-full">
            <span>Lower-third sensors</span>
            <textarea rows="6" value={listToText(homeAssistantBoard.haSensors)} onChange={(event) => updateBoard('home-assistant', { haSensors: parseList(event.target.value) })} />
          </label>
        ) : null}
      </div>
    </article>
  )
}
