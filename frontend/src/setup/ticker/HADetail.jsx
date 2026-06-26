import { useEffect, useState } from 'react'
import { useAppContext } from '../../AppContext'

const POSITION_OPTIONS = [
  { value: 'none', label: "Don't show" },
  { value: 'ticker', label: 'Ticker (rotation)' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

function makeCardId() { return `c${Date.now().toString(36)}` }

export default function HADetail({ onBack }) {
  const { config, updateBoard } = useAppContext()
  const haBoard = config.boards.find((b) => b.type === 'home-assistant')
  const haCards = haBoard?.haCards ?? []
  const savedSensors = haBoard?.haSensors ?? []

  const [pushedSensors, setPushedSensors] = useState([])
  const [loadingState, setLoadingState] = useState('loading')

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
      entityId, label: '', unit: '', position: 'ticker', cardId: '',
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
    updateBoard('home-assistant', { haCards: [...haCards, { id: makeCardId(), title: 'HOME', sub: '', variant: 'home' }] })
  }

  function updateCard(id, patch) {
    updateBoard('home-assistant', { haCards: haCards.map((c) => c.id === id ? { ...c, ...patch } : c) })
  }

  function removeCard(id) {
    updateBoard('home-assistant', { haCards: haCards.filter((c) => c.id !== id) })
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Ticker</p>
          <h2>Home Assistant</h2>
        </div>
        <div className="ticker-top-actions">
          <button type="button" className="button-link" onClick={onBack}>← Back</button>
        </div>
      </div>

      <div className="field-grid field-grid-3 compact-controls" style={{ marginBottom: '1rem' }}>
        <label className="field field-checkbox">
          <span>Enabled in rotation</span>
          <input
            type="checkbox"
            checked={haBoard?.enabled !== false}
            onChange={(e) => updateBoard('home-assistant', { enabled: e.target.checked })}
          />
        </label>
      </div>

      <div className="ha-card-builder">
        <div className="ha-card-builder-head">
          <span className="ha-card-builder-label">Ticker cards</span>
          <button className="ha-card-add-btn" onClick={addCard}>+ Add card</button>
        </div>
        {haCards.length === 0 && (
          <p className="ha-sensor-empty" style={{ textAlign: 'left', paddingTop: 8 }}>
            No cards yet. Add one to group entities into named ticker blocks (HOME, WEATHER, etc.).
          </p>
        )}
        {haCards.map((card) => (
          <div key={card.id} className="ha-card-block">
            <div className="ha-card-row">
              <input className="ha-card-input" value={card.title}
                onChange={(e) => updateCard(card.id, { title: e.target.value })} placeholder="Title" />
              <input className="ha-card-input" value={card.sub}
                onChange={(e) => updateCard(card.id, { sub: e.target.value })} placeholder="Subtitle (optional)" />
              <select className="ha-card-select" value={card.variant}
                onChange={(e) => updateCard(card.id, { variant: e.target.value })}>
                <option value="home">Home</option>
                <option value="weather">Weather</option>
                <option value="printer">Printer</option>
              </select>
              <label className="toggle-switch" title={card.enabled !== false ? 'Card visible' : 'Card hidden'}>
                <input type="checkbox" checked={card.enabled !== false}
                  onChange={(e) => updateCard(card.id, { enabled: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
              <button className="ha-card-remove-btn" onClick={() => removeCard(card.id)}>×</button>
            </div>
            {card.variant === 'weather' && (
              <div className="ha-card-weather-sensors">
                <label className="ha-card-weather-sensor-label">
                  <span>Hourly forecast</span>
                  <select className="ha-card-select" value={card.hourlySensorId || ''}
                    onChange={(e) => updateCard(card.id, { hourlySensorId: e.target.value })}>
                    <option value="">— none —</option>
                    {pushedSensors.map((s) => (
                      <option key={s.entity_id} value={s.entity_id}>{s.friendly_name || s.entity_id}</option>
                    ))}
                  </select>
                </label>
                <label className="ha-card-weather-sensor-label">
                  <span>Daily forecast</span>
                  <select className="ha-card-select" value={card.dailySensorId || ''}
                    onChange={(e) => updateCard(card.id, { dailySensorId: e.target.value })}>
                    <option value="">— none —</option>
                    {pushedSensors.map((s) => (
                      <option key={s.entity_id} value={s.entity_id}>{s.friendly_name || s.entity_id}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      {loadingState === 'loading' && <p className="ha-sensor-empty">Loading…</p>}
      {loadingState === 'error' && <p className="ha-sensor-empty">Could not reach the backend to load sensor data.</p>}
      {loadingState === 'done' && pushedSensors.length === 0 && (
        <p className="ha-sensor-empty">
          No sensors received yet. Open the PiBarTicker integration in Home Assistant, go to <strong>Configure</strong>, and select entities to mirror.
        </p>
      )}

      <div className="ha-alert-example" style={{ marginTop: '1.5rem' }}>
        <div className="ha-alert-example-title">Alert automations</div>
        <div className="ha-alert-example-desc">
          Use <code>pibarticker.notify</code> with a <code>key</code> and <code>ttl: 0</code> to show a persistent alert on the ticker.
          Use <code>pibarticker.clear_alert</code> with the same key to dismiss it.
        </div>
        <pre className="ha-alert-yaml">{`alias: PiBarTicker — Water Leak
trigger:
  - platform: state
    entity_id: binary_sensor.water_sensor
    to: "on"
    id: wet
  - platform: state
    entity_id: binary_sensor.water_sensor
    to: "off"
    id: dry
action:
  - choose:
      - conditions:
          - condition: trigger
            id: wet
        sequence:
          - service: pibarticker.notify
            data:
              message: "Water detected!"
              level: critical
              key: water_leak
              ttl: 0
      - conditions:
          - condition: trigger
            id: dry
        sequence:
          - service: pibarticker.clear_alert
            data:
              key: water_leak`}</pre>
      </div>

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
                  <span className="ha-sensor-entity-name">{sensor.friendly_name || sensor.entity_id}</span>
                  <span className="ha-sensor-entity-id">{sensor.entity_id}</span>
                  {sensor.domain && sensor.domain !== 'sensor' && (
                    <span className="ha-sensor-domain-chip">{sensor.domain}</span>
                  )}
                </div>
                <span className="ha-sensor-live">
                  {sensor.state}
                  {sensor.unit ? <span className="ha-sensor-live-unit">{sensor.unit}</span> : null}
                </span>
                <input type="text" placeholder={sensor.friendly_name || 'Label'} value={cfg.label}
                  onChange={(e) => updateSensor(sensor.entity_id, { label: e.target.value })} />
                <input type="text" placeholder={sensor.unit || 'Unit'} value={cfg.unit}
                  onChange={(e) => updateSensor(sensor.entity_id, { unit: e.target.value })} />
                <select value={cfg.position} onChange={(e) => updateSensor(sensor.entity_id, { position: e.target.value })}>
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {haCards.length > 0 && (
                  cfg.position === 'ticker' ? (
                    <select value={cfg.cardId || ''} onChange={(e) => updateSensor(sensor.entity_id, { cardId: e.target.value })}>
                      <option value="">— unassigned —</option>
                      {haCards.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  ) : <span />
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
