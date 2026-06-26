import './HAPanel.css'
import { useHASensors, renderEntityValue, haIconFor, haColorFor, WEATHER_ICON_MAP } from './ticker/haHelpers'

function HAPanelSensorCard({ card, sensors, sensorValues }) {
  if (sensors.length === 0) return null
  return (
    <div className="ha-panel-card">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
        <span className="ha-panel-badge"><i className="mdi mdi-home-assistant" /> HOME</span>
      </div>
      <div className="ha-panel-rows">
        {sensors.map(sensor => {
          const live = sensorValues[sensor.entityId]
          const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
          const icon = haIconFor(live, sensor)
          const color = haColorFor(live, sensor)
          return (
            <div key={sensor.entityId} className="ha-panel-row">
              <i className={`mdi ${icon} ha-panel-row-icon`} style={{ '--ic': color }} />
              <span className="ha-panel-row-label">{label}</span>
              <span className="ha-panel-row-val">{renderEntityValue(live, sensor, 'ha-unit')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HAPanelWeatherCard({ card, sensors, sensorValues }) {
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
  const forecast0 = live?.attributes?.forecast?.[0]
  const hiTemp = forecast0?.temperature ?? forecast0?.high_temperature
  const loTemp = forecast0?.templow ?? forecast0?.low_temperature

  return (
    <div className="ha-panel-card ha-panel-weather">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
        <span className="ha-panel-badge"><i className="mdi mdi-weather-cloudy" /> WEATHER</span>
      </div>
      <div className="ha-panel-wx-hero">
        <i className={`mdi ${wx.icon} ha-panel-wx-icon`} style={{ '--ic': wx.color }} />
        <div className="ha-panel-wx-temp">{temp != null ? temp : '—'}<span className="ha-panel-wx-deg">{tempUnit}</span></div>
        <div className="ha-panel-wx-cond">{condition}</div>
      </div>
      <div className="ha-panel-wx-stats">
        {hiTemp != null && loTemp != null && (
          <div className="ha-panel-wx-stat">
            <i className="mdi mdi-thermometer" style={{ '--ic': '#f0894e' }} />
            <span>{hiTemp}° / {loTemp}°</span>
          </div>
        )}
        {humidity != null && (
          <div className="ha-panel-wx-stat">
            <i className="mdi mdi-water-percent" style={{ '--ic': '#5ac8fa' }} />
            <span>{humidity}%</span>
          </div>
        )}
        {windSpeed != null && (
          <div className="ha-panel-wx-stat">
            <i className="mdi mdi-weather-windy" style={{ '--ic': '#4fd1c5' }} />
            <span>{windSpeed}{windUnit ? ` ${windUnit}` : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function HAPanelPrinterCard({ card, sensors, sensorValues }) {
  if (sensors.length === 0) return null

  let progressSensor = null
  let progressPct = null
  const otherSensors = []
  for (const sensor of sensors) {
    const live = sensorValues[sensor.entityId]
    const unit = sensor.unit || live?.unit || live?.attributes?.unit_of_measurement || ''
    const val = parseFloat(live?.state)
    if (!progressSensor && unit === '%' && !isNaN(val) && val >= 0 && val <= 100) {
      progressSensor = sensor
      progressPct = val
    } else {
      otherSensors.push(sensor)
    }
  }

  return (
    <div className="ha-panel-card">
      <div className="ha-panel-card-head">
        <span className="ha-panel-card-title">{card.title}</span>
        <span className="ha-panel-badge"><i className="mdi mdi-printer-3d" /> PRINT</span>
      </div>
      {progressPct != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5cqh' }}>
          <div className="ha-panel-progress-bar" style={{ flex: 1 }}>
            <div className="ha-panel-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="ha-panel-progress-pct">{Math.round(progressPct)}%</span>
        </div>
      )}
      {otherSensors.length > 0 && (
        <div className="ha-panel-rows">
          {otherSensors.map(sensor => {
            const live = sensorValues[sensor.entityId]
            const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
            const icon = haIconFor(live, sensor)
            const color = haColorFor(live, sensor)
            return (
              <div key={sensor.entityId} className="ha-panel-row">
                <i className={`mdi ${icon} ha-panel-row-icon`} style={{ '--ic': color }} />
                <span className="ha-panel-row-label">{label}</span>
                <span className="ha-panel-row-val">{renderEntityValue(live, sensor, 'ha-unit')}</span>
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
  const tickerSensors = sensors.filter(s => s.position === 'ticker')

  if (tickerSensors.length === 0 && cards.length === 0) {
    return <div className="ha-panel ha-panel-empty">No HA sensors configured</div>
  }

  if (cards.length === 0) {
    return (
      <div className="ha-panel">
        <HAPanelSensorCard
          card={{ title: 'HOME', sub: '' }}
          sensors={tickerSensors}
          sensorValues={sensorValues}
        />
      </div>
    )
  }

  return (
    <div className="ha-panel">
      {cards.map(card => {
        if (card.enabled === false) return null
        const cardSensors = tickerSensors.filter(s => s.cardId === card.id)
        if (cardSensors.length === 0) return null
        if (card.variant === 'weather') {
          return <HAPanelWeatherCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        }
        if (card.variant === 'printer') {
          return <HAPanelPrinterCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        }
        return <HAPanelSensorCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
      })}
    </div>
  )
}
