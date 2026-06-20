import { useEffect, useState } from 'react'
import { useAppContext } from '../AppContext'
import { computeServicesErrors } from './helpers'

const POSITION_OPTIONS = [
  { value: 'none', label: "Don't show" },
  { value: 'ticker', label: 'Ticker (rotation)' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

function makeCardId() { return `c${Date.now().toString(36)}` }

export default function ServicesPage() {
  const { config, updateConfigSection, updateBoard } = useAppContext()
  const homeAssistantBoard = config.boards.find((b) => b.type === 'home-assistant')
  const servicesErrors = computeServicesErrors(config)
  const savedSensors = homeAssistantBoard?.haSensors ?? []
  const haCards = homeAssistantBoard?.haCards ?? []

  const [pushedSensors, setPushedSensors] = useState([])
  const [loadingState, setLoadingState] = useState('loading') // 'loading' | 'done' | 'error'

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      fetch('/api/v1/ha/sensors')
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => { if (!cancelled) { setPushedSensors(list); setLoadingState('done') } })
        .catch(() => { if (!cancelled) setLoadingState('error') })
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  function getSavedConfig(entityId) {
    return savedSensors.find((s) => s.entityId === entityId) ?? {
      entityId,
      label: '',
      unit: '',
      position: 'ticker',
      cardId: '',
    }
  }

  function updateSensor(entityId, patch) {
    const exists = savedSensors.some((s) => s.entityId === entityId)
    const updated = exists
      ? savedSensors.map((s) => s.entityId === entityId ? { ...s, ...patch } : s)
      : [...savedSensors, { entityId, label: '', unit: '', position: 'ticker', cardId: '', ...patch }]
    updateBoard('home-assistant', { haSensors: updated })
  }

  function addCard() {
    const newCard = { id: makeCardId(), title: 'HOME', sub: '', variant: 'home' }
    updateBoard('home-assistant', { haCards: [...haCards, newCard] })
  }

  function updateCard(id, patch) {
    updateBoard('home-assistant', { haCards: haCards.map((c) => c.id === id ? { ...c, ...patch } : c) })
  }

  function removeCard(id) {
    updateBoard('home-assistant', { haCards: haCards.filter((c) => c.id !== id) })
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
                Pick entities in the PiBarTicker integration options in Home Assistant — they'll appear here automatically. Then choose where each one shows on the display.
              </div>
            </div>
          </div>

          <div className="ha-card-builder">
            <div className="ha-card-builder-head">
              <span className="ha-card-builder-label">Ticker cards</span>
              <button className="ha-card-add-btn" onClick={addCard}>+ Add card</button>
            </div>
            {haCards.length === 0 && (
              <p className="ha-sensor-empty" style={{ textAlign: 'left', paddingTop: 8 }}>
                No cards yet. Add one to group entities into named ticker blocks (HOME, WEATHER, SECURITY, etc.).
              </p>
            )}
            {haCards.map((card) => (
              <div key={card.id} className="ha-card-row">
                <input
                  className="ha-card-input"
                  value={card.title}
                  onChange={(e) => updateCard(card.id, { title: e.target.value })}
                  placeholder="Title"
                />
                <input
                  className="ha-card-input"
                  value={card.sub}
                  onChange={(e) => updateCard(card.id, { sub: e.target.value })}
                  placeholder="Subtitle (optional)"
                />
                <select
                  className="ha-card-select"
                  value={card.variant}
                  onChange={(e) => updateCard(card.id, { variant: e.target.value })}
                >
                  <option value="home">Home</option>
                  <option value="weather">Weather</option>
                  <option value="printer">Printer</option>
                </select>
                <button className="ha-card-remove-btn" onClick={() => removeCard(card.id)}>×</button>
              </div>
            ))}
          </div>

          {loadingState === 'loading' && (
            <p className="ha-sensor-empty">Loading…</p>
          )}

          {loadingState === 'done' && pushedSensors.length === 0 && (
            <p className="ha-sensor-empty">
              No sensors received yet. Open the PiBarTicker integration in Home Assistant, go to <strong>Configure</strong>, and select entities to mirror.
            </p>
          )}

          {loadingState === 'error' && (
            <p className="ha-sensor-empty">Could not reach the backend to load sensor data.</p>
          )}

          {loadingState === 'done' && pushedSensors.length > 0 && (
            <div className="ha-sensor-list">
              <div className={`ha-sensor-list-head ${haCards.length > 0 ? 'ha-sensor-list-head-cards' : 'ha-sensor-list-head-pushed'}`}>
                <span>Sensor</span>
                <span>Current value</span>
                <span>Label override</span>
                <span>Unit</span>
                <span>Position</span>
                {haCards.length > 0 && <span>Card</span>}
              </div>
              {pushedSensors.map((sensor) => {
                const cfg = getSavedConfig(sensor.entity_id)
                return (
                  <div className={`ha-sensor-row ${haCards.length > 0 ? 'ha-sensor-row-cards' : 'ha-sensor-row-pushed'}`} key={sensor.entity_id}>
                    <div className="ha-sensor-entity">
                      <span className="ha-sensor-entity-name">
                        {sensor.friendly_name || sensor.entity_id}
                      </span>
                      <span className="ha-sensor-entity-id">{sensor.entity_id}</span>
                      {sensor.domain && sensor.domain !== 'sensor' && (
                        <span className="ha-sensor-domain-chip">{sensor.domain}</span>
                      )}
                    </div>
                    <span className="ha-sensor-live">
                      {sensor.state}
                      {sensor.unit ? <span className="ha-sensor-live-unit">{sensor.unit}</span> : null}
                    </span>
                    <input
                      type="text"
                      placeholder={sensor.friendly_name || 'Label'}
                      value={cfg.label}
                      onChange={(e) => updateSensor(sensor.entity_id, { label: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder={sensor.unit || 'Unit'}
                      value={cfg.unit}
                      onChange={(e) => updateSensor(sensor.entity_id, { unit: e.target.value })}
                    />
                    <select
                      value={cfg.position}
                      onChange={(e) => updateSensor(sensor.entity_id, { position: e.target.value })}
                    >
                      {POSITION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {haCards.length > 0 && (
                      cfg.position === 'ticker' ? (
                        <select
                          value={cfg.cardId || ''}
                          onChange={(e) => updateSensor(sensor.entity_id, { cardId: e.target.value })}
                        >
                          <option value="">— unassigned —</option>
                          {haCards.map((c) => (
                            <option key={c.id} value={c.id}>{c.title}</option>
                          ))}
                        </select>
                      ) : <span />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </article>
  )
}
