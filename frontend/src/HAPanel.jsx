import { useHASensors, renderEntityValue, haIconFor, haColorFor, WEATHER_ICON_MAP } from './ticker/haHelpers'
import './HAPanel.css'

function PanelSensorCard({ card, sensors, sensorValues }) {
  if (!sensors.length) return null
  return (
    <div className="ha-panel-card">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
        {card.sub && <span className="ha-panel-badge">{card.sub}</span>}
      </div>
      <div className="ha-panel-rows">
        {sensors.map(sensor => {
          const live = sensorValues[sensor.entityId]
          const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
          return (
            <div key={sensor.entityId} className="ha-panel-row">
              <i className={`mdi ${haIconFor(live, sensor)} ha-panel-row-icon`} style={{ '--ic': haColorFor(live, sensor) }} />
              <span className="ha-panel-row-label">{label}</span>
              <span className="ha-panel-row-val">{renderEntityValue(live, sensor, '')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PanelWeatherCard({ card, sensors, sensorValues }) {
  let live = null
  for (const s of sensors) {
    const v = sensorValues[s.entityId]
    if ((v?.domain || s.entityId.split('.')[0]) === 'weather') { live = v; break }
  }
  const condition = live?.state ?? '—'
  const wx = WEATHER_ICON_MAP[condition] ?? { icon: 'mdi-weather-cloudy', color: '#9aa3b1' }
  const temp = live?.attributes?.temperature
  const tempUnit = live?.attributes?.temperature_unit ?? '°'
  const humidity = live?.attributes?.humidity
  const windSpeed = live?.attributes?.wind_speed
  const windUnit = live?.attributes?.wind_speed_unit ?? ''
  return (
    <div className="ha-panel-card ha-panel-weather">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
      </div>
      <div className="ha-panel-wx-hero">
        <i className={`mdi ${wx.icon} ha-panel-wx-icon`} style={{ '--ic': wx.color }} />
        <span className="ha-panel-wx-temp">{temp != null ? temp : '—'}<span className="ha-panel-wx-deg">{tempUnit}</span></span>
        <span className="ha-panel-wx-cond">{condition}</span>
      </div>
      {(humidity != null || windSpeed != null) && (
        <div className="ha-panel-wx-stats">
          {humidity != null && (
            <div className="ha-panel-wx-stat">
              <i className="mdi mdi-water-percent" />
              <span>{humidity}%</span>
            </div>
          )}
          {windSpeed != null && (
            <div className="ha-panel-wx-stat">
              <i className="mdi mdi-weather-windy" />
              <span>{windSpeed}{windUnit ? ` ${windUnit}` : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PanelPrinterCard({ card, sensors, sensorValues }) {
  if (!sensors.length) return null
  let progressSensor = null, progressPct = null
  const otherSensors = []
  for (const sensor of sensors) {
    const live = sensorValues[sensor.entityId]
    const unit = sensor.unit || live?.unit || live?.attributes?.unit_of_measurement || ''
    const val = parseFloat(live?.state)
    if (!progressSensor && unit === '%' && !isNaN(val) && val >= 0 && val <= 100) {
      progressSensor = sensor; progressPct = val
    } else { otherSensors.push(sensor) }
  }
  return (
    <div className="ha-panel-card">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
        {card.sub && <span className="ha-panel-badge">{card.sub}</span>}
      </div>
      {progressPct != null && (
        <>
          <div className="ha-panel-progress-bar"><div className="ha-panel-progress-fill" style={{ width: `${progressPct}%` }} /></div>
          <span className="ha-panel-progress-pct">{Math.round(progressPct)}%</span>
        </>
      )}
      {otherSensors.length > 0 && (
        <div className="ha-panel-rows">
          {otherSensors.map(sensor => {
            const live = sensorValues[sensor.entityId]
            const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
            return (
              <div key={sensor.entityId} className="ha-panel-row">
                <i className={`mdi ${haIconFor(live, sensor)} ha-panel-row-icon`} style={{ '--ic': haColorFor(live, sensor) }} />
                <span className="ha-panel-row-label">{label}</span>
                <span className="ha-panel-row-val">{renderEntityValue(live, sensor, '')}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function HAPanel({ homeAssistantBoard }) {
  const sensorValues = useHASensors()
  const sensors = homeAssistantBoard?.haSensors ?? []
  const cards = homeAssistantBoard?.haCards ?? []

  let cardEls = null
  if (cards.length > 0) {
    const rendered = cards
      .filter(c => c.enabled !== false)
      .map(card => {
        const cardSensors = sensors.filter(s => s.cardId === card.id)
        if (!cardSensors.length) return null
        if (card.variant === 'weather') return <PanelWeatherCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        if (card.variant === 'printer') return <PanelPrinterCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        return <PanelSensorCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
      })
      .filter(Boolean)
    cardEls = rendered.length > 0 ? rendered : null
  }

  if (!cardEls) {
    cardEls = <PanelSensorCard card={{ title: 'HOME', sub: '' }} sensors={sensors} sensorValues={sensorValues} />
  }

  return (
    <div className="ha-panel">
      {cardEls}
    </div>
  )
}
