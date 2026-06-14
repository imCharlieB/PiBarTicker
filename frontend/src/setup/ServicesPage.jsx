import { useAppContext } from '../AppContext'
import { computeServicesErrors } from './helpers'

const POSITION_OPTIONS = [
  { value: 'ticker', label: 'Ticker (rotation)' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

function emptySensor() {
  return { entityId: '', label: '', unit: '', position: 'ticker' }
}

export default function ServicesPage() {
  const { config, updateConfigSection, updateBoard } = useAppContext()
  const homeAssistantBoard = config.boards.find((b) => b.type === 'home-assistant')
  const servicesErrors = computeServicesErrors(config)
  const sensors = homeAssistantBoard?.haSensors ?? []

  function updateSensor(index, patch) {
    const updated = sensors.map((s, i) => (i === index ? { ...s, ...patch } : s))
    updateBoard('home-assistant', { haSensors: updated })
  }

  function addSensor() {
    updateBoard('home-assistant', { haSensors: [...sensors, emptySensor()] })
  }

  function removeSensor(index) {
    updateBoard('home-assistant', { haSensors: sensors.filter((_, i) => i !== index) })
  }

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
          <input
            type="text"
            value={config.homeAssistant.url}
            onChange={(e) => updateConfigSection('homeAssistant', 'url', e.target.value)}
          />
          {servicesErrors.url ? <small className="field-error">{servicesErrors.url}</small> : null}
        </label>

        <label className="field field-full">
          <span>Home Assistant access token</span>
          <input
            type="password"
            value={config.homeAssistant.token}
            onChange={(e) => updateConfigSection('homeAssistant', 'token', e.target.value)}
          />
          <small className="field-help">Used only to fetch local Home Assistant sensor values.</small>
        </label>

        <div className="page-toggle-group">
          <div className="page-toggle-row">
            <div>
              <div className="page-toggle-label">HTTP enabled</div>
              <div className="page-toggle-desc">Expose a local HTTP server for remote control and status</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={config.http.enabled}
                onChange={(e) => updateConfigSection('http', 'enabled', e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <label className="field">
          <span>HTTP port</span>
          <input
            type="number"
            value={config.http.port}
            onChange={(e) => updateConfigSection('http', 'port', Number(e.target.value))}
          />
          {servicesErrors.port ? <small className="field-error">{servicesErrors.port}</small> : null}
        </label>
      </div>

      {homeAssistantBoard ? (
        <div className="ha-sensor-section">
          <div className="ha-sensor-header">
            <div>
              <div className="ha-sensor-title">Display sensors</div>
              <div className="ha-sensor-desc">
                Pick HA entities to show on the display. The HA integration will push their values here automatically.
              </div>
            </div>
            <button className="btn-add-sensor" type="button" onClick={addSensor}>
              + Add sensor
            </button>
          </div>

          {sensors.length > 0 && (
            <div className="ha-sensor-list">
              <div className="ha-sensor-list-head">
                <span>Entity ID</span>
                <span>Label</span>
                <span>Unit</span>
                <span>Position</span>
                <span />
              </div>
              {sensors.map((sensor, i) => (
                <div className="ha-sensor-row" key={i}>
                  <input
                    type="text"
                    placeholder="sensor.living_room_temp"
                    value={sensor.entityId}
                    onChange={(e) => updateSensor(i, { entityId: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Living Room"
                    value={sensor.label}
                    onChange={(e) => updateSensor(i, { label: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="°F"
                    value={sensor.unit}
                    onChange={(e) => updateSensor(i, { unit: e.target.value })}
                  />
                  <select
                    value={sensor.position}
                    onChange={(e) => updateSensor(i, { position: e.target.value })}
                  >
                    {POSITION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn-remove-sensor"
                    type="button"
                    onClick={() => removeSensor(i)}
                    aria-label="Remove sensor"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {sensors.length === 0 && (
            <p className="ha-sensor-empty">No sensors configured. Click &ldquo;+ Add sensor&rdquo; to start.</p>
          )}
        </div>
      ) : null}
    </article>
  )
}
