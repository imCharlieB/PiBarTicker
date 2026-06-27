import { useEffect, useState } from 'react'

export const WEATHER_ICON_MAP = {
  sunny:             { icon: 'mdi-weather-sunny',           color: '#f5b945' },
  'clear-night':     { icon: 'mdi-weather-night',           color: '#5ac8fa' },
  cloudy:            { icon: 'mdi-weather-cloudy',          color: '#9aa3b1' },
  partlycloudy:      { icon: 'mdi-weather-partly-cloudy',   color: '#f5b945' },
  'partly-cloudy':   { icon: 'mdi-weather-partly-cloudy',   color: '#f5b945' },
  fog:               { icon: 'mdi-weather-fog',             color: '#9aa3b1' },
  hail:              { icon: 'mdi-weather-hail',            color: '#5ac8fa' },
  lightning:         { icon: 'mdi-weather-lightning',       color: '#f5b945' },
  'lightning-rainy': { icon: 'mdi-weather-lightning-rainy', color: '#f5b945' },
  pouring:           { icon: 'mdi-weather-pouring',         color: '#5ac8fa' },
  rainy:             { icon: 'mdi-weather-rainy',           color: '#5ac8fa' },
  snowy:             { icon: 'mdi-weather-snowy',           color: '#e2e8f0' },
  'snowy-rainy':     { icon: 'mdi-weather-snowy-rainy',     color: '#b0c4de' },
  windy:             { icon: 'mdi-weather-windy',           color: '#4fd1c5' },
  'windy-variant':   { icon: 'mdi-weather-windy-variant',   color: '#4fd1c5' },
  exceptional:       { icon: 'mdi-alert-circle',            color: '#f87171' },
}

export function useHASensors() {
  const [values, setValues] = useState({})
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/v1/ha/sensors')
        if (res.ok && !cancelled) {
          const list = await res.json()
          const map = {}
          for (const s of list) map[s.entity_id] = s
          setValues(map)
        }
      } catch {}
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  return values
}

export function renderEntityValue(live, sensor, unitClass) {
  if (!live) return '—'
  const domain = live.domain || sensor.entityId.split('.')[0]

  if (domain === 'lock') {
    const locked = live.state === 'locked'
    return <span className={`ha-state-badge ${locked ? 'ha-state-on' : 'ha-state-off'}`}>{locked ? 'LOCKED' : 'UNLOCKED'}</span>
  }

  if (domain === 'binary_sensor' || domain === 'switch' || domain === 'input_boolean') {
    const on = live.state === 'on'
    return <span className={`ha-state-badge ${on ? 'ha-state-on' : 'ha-state-off'}`}>{on ? 'ON' : 'OFF'}</span>
  }

  if (domain === 'light') {
    const on = live.state === 'on'
    const brightness = live.attributes?.brightness
    if (on && brightness != null) {
      return <span className="ha-state-badge ha-state-on">{Math.round(brightness / 255 * 100)}%</span>
    }
    return <span className={`ha-state-badge ${on ? 'ha-state-on' : 'ha-state-off'}`}>{on ? 'ON' : 'OFF'}</span>
  }

  if (domain === 'climate') {
    const cur = live.attributes?.current_temperature
    const set = live.attributes?.temperature
    const mode = (live.attributes?.hvac_mode || '').toLowerCase()
    if (cur != null && set != null) {
      return (
        <>
          {cur}°<span className="ha-climate-arrow"> → </span>{set}°
          {mode && mode !== 'off' && <span className="ha-climate-mode">{mode.toUpperCase()}</span>}
        </>
      )
    }
    return <>{live.state}</>
  }

  const unit = sensor.unit || live.unit || ''
  return <>{live.state}{unit ? <span className={unitClass}>{unit}</span> : null}</>
}

export function haIconFor(live, sensor) {
  const haAttr = live?.attributes?.icon
  if (haAttr && haAttr.startsWith('mdi:')) return haAttr.replace('mdi:', 'mdi-')
  const domain = live?.domain || sensor.entityId.split('.')[0]
  const dc = live?.attributes?.device_class || ''
  switch (domain) {
    case 'climate':       return 'mdi-thermostat'
    case 'light':         return 'mdi-lightbulb'
    case 'lock':          return live?.state === 'locked' ? 'mdi-lock' : 'mdi-lock-open-variant'
    case 'switch':        return 'mdi-toggle-switch'
    case 'input_boolean': return 'mdi-toggle-switch'
    case 'binary_sensor':
      switch (dc) {
        case 'door':         return 'mdi-door'
        case 'window':       return 'mdi-window-closed'
        case 'motion':       return 'mdi-motion-sensor'
        case 'lock':         return 'mdi-lock'
        case 'garage_door':  return 'mdi-garage'
        case 'smoke':        return 'mdi-smoke-detector'
        case 'moisture':     return 'mdi-water'
        default:             return 'mdi-circle'
      }
    case 'sensor':
      switch (dc) {
        case 'temperature': return 'mdi-thermometer'
        case 'humidity':    return 'mdi-water-percent'
        case 'battery':     return 'mdi-battery'
        case 'energy':      return 'mdi-lightning-bolt'
        case 'power':       return 'mdi-flash'
        default:            return 'mdi-gauge'
      }
    default: return 'mdi-circle-small'
  }
}

export function HATickerCards({ homeAssistantBoard, sensorValues }) {
  const sensors = homeAssistantBoard?.haSensors ?? []
  const cards = homeAssistantBoard?.haCards ?? []
  const tickerSensors = sensors.filter((s) => s.position === 'ticker')

  if (cards.length === 0) {
    if (tickerSensors.length === 0) return null
    return <HASensorCard card={{ title: 'HOME', sub: '' }} sensors={tickerSensors} sensorValues={sensorValues} />
  }

  const cardEls = cards.map((card) => {
    if (card.enabled === false) return null
    const cardSensors = tickerSensors.filter((s) => s.cardId === card.id)
    if (cardSensors.length === 0) return null
    if (card.variant === 'weather') return <HAWeatherCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
    if (card.variant === 'printer') return <HAPrinterCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
    return <HASensorCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
  })

  // If every card returned null (no sensors assigned), fall back to a catch-all HOME card
  const hasVisible = cardEls.some(Boolean)
  if (!hasVisible) {
    if (tickerSensors.length === 0) return null
    return <HASensorCard card={{ title: 'HOME', sub: '' }} sensors={tickerSensors} sensorValues={sensorValues} />
  }

  return cardEls
}

function HASensorCard({ card, sensors, sensorValues }) {
  if (sensors.length === 0) return null
  return (
    <div className="card d-ha ticker-runtime-card" role="listitem">
      <div className="ha-head">
        <div className="ha-titles">
          <span className="ha-title">{card.title}</span>
          {card.sub && <span className="ha-sub">{card.sub}</span>}
        </div>
        <span className="ha-badge"><i className="mdi mdi-home-assistant" />HOME</span>
      </div>
      <div className="ha-rows">
        {sensors.map((sensor) => {
          const live = sensorValues[sensor.entityId]
          const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
          const icon = haIconFor(live, sensor)
          const color = haColorFor(live, sensor)
          return (
            <div key={sensor.entityId} className="ha-row">
              <i className={`mdi ${icon} ha-row-icon`} style={{ '--ic': color }} />
              <span className="ha-row-label">{label}</span>
              <span className="ha-row-val">{renderEntityValue(live, sensor, 'ha-unit')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HAWeatherCard({ card, sensors, sensorValues }) {
  let live = null
  for (const s of sensors) {
    const v = sensorValues[s.entityId]
    if ((v?.domain || s.entityId.split('.')[0]) === 'weather') { live = v; break }
  }
  const dailyLive = card.dailySensorId ? (sensorValues[card.dailySensorId] ?? null) : null
  const forecastSource = dailyLive ?? live
  const condition = live?.state ?? '—'
  const wx = WEATHER_ICON_MAP[condition] ?? { icon: 'mdi-weather-cloudy', color: '#9aa3b1' }
  const temp = live?.attributes?.temperature
  const tempUnit = live?.attributes?.temperature_unit ?? '°'
  const humidity = live?.attributes?.humidity
  const windSpeed = live?.attributes?.wind_speed
  const windUnit = live?.attributes?.wind_speed_unit ?? ''
  const forecast0 = forecastSource?.attributes?.forecast?.[0]
  const hiTemp = forecast0?.temperature ?? forecast0?.high_temperature
  const loTemp = forecast0?.templow ?? forecast0?.low_temperature
  return (
    <div className="card d-ha d-weather ticker-runtime-card" role="listitem">
      <div className="ha-head">
        <div className="ha-titles">
          <span className="ha-title">{card.title}</span>
          {card.sub && <span className="ha-sub">{card.sub}</span>}
        </div>
        <span className="ha-badge"><i className="mdi mdi-home-assistant" />HOME</span>
      </div>
      <div className="wx-hero">
        <i className={`mdi ${wx.icon} wx-icon`} style={{ '--ic': wx.color }} />
        <div className="wx-temp">{temp != null ? temp : '—'}<span className="wx-deg">{tempUnit}</span></div>
        <div className="wx-cond">{condition}</div>
      </div>
      <div className="wx-stats">
        {hiTemp != null && loTemp != null && (
          <div className="wx-stat">
            <i className="mdi mdi-thermometer" style={{ '--ic': '#f0894e' }} />
            <span className="wx-stat-val">{hiTemp}° / {loTemp}°</span>
            <span className="wx-stat-label">Hi / Lo</span>
          </div>
        )}
        {humidity != null && (
          <div className="wx-stat">
            <i className="mdi mdi-water-percent" style={{ '--ic': '#5ac8fa' }} />
            <span className="wx-stat-val">{humidity}%</span>
            <span className="wx-stat-label">Humidity</span>
          </div>
        )}
        {windSpeed != null && (
          <div className="wx-stat">
            <i className="mdi mdi-weather-windy" style={{ '--ic': '#4fd1c5' }} />
            <span className="wx-stat-val">{windSpeed}{windUnit ? ` ${windUnit}` : ''}</span>
            <span className="wx-stat-label">Wind</span>
          </div>
        )}
      </div>
    </div>
  )
}

function HAPrinterCard({ card, sensors, sensorValues }) {
  if (sensors.length === 0) return null
  let progressSensor = null
  let progressPct = null
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
    <div className="card d-ha d-printer ticker-runtime-card" role="listitem">
      <div className="ha-head">
        <div className="ha-titles">
          <span className="ha-title">{card.title}</span>
          {card.sub && <span className="ha-sub">{card.sub}</span>}
        </div>
        <span className="ha-badge"><i className="mdi mdi-printer-3d" />PRINT</span>
      </div>
      {progressPct != null && (
        <div className="printer-progress">
          <div className="printer-progress-bar"><div className="printer-progress-fill" style={{ width: `${progressPct}%` }} /></div>
          <span className="printer-progress-pct">{Math.round(progressPct)}%</span>
        </div>
      )}
      {otherSensors.length > 0 && (
        <div className="ha-rows">
          {otherSensors.map((sensor) => {
            const live = sensorValues[sensor.entityId]
            const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
            const icon = haIconFor(live, sensor)
            const color = haColorFor(live, sensor)
            return (
              <div key={sensor.entityId} className="ha-row">
                <i className={`mdi ${icon} ha-row-icon`} style={{ '--ic': color }} />
                <span className="ha-row-label">{label}</span>
                <span className="ha-row-val">{renderEntityValue(live, sensor, 'ha-unit')}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function haColorFor(live, sensor) {
  const domain = live?.domain || sensor?.entityId?.split('.')[0]
  const dc = live?.attributes?.device_class || ''
  const on = live?.state === 'on'
  switch (domain) {
    case 'climate':       return '#f0894e'
    case 'light':         return on ? '#ffc83d' : '#4b5563'
    case 'lock':          return live?.state === 'locked' ? '#7CF29B' : '#f87171'
    case 'switch':        return on ? '#7CF29B' : '#4b5563'
    case 'input_boolean': return on ? '#7CF29B' : '#4b5563'
    case 'binary_sensor':
      switch (dc) {
        case 'door':   return '#5ac8fa'
        case 'window': return '#5ac8fa'
        case 'motion': return on ? '#7CF29B' : '#9aa3b1'
        case 'lock':   return on ? '#7CF29B' : '#f87171'
        default:       return '#9aa3b1'
      }
    case 'sensor':
      switch (dc) {
        case 'temperature': return '#f0894e'
        case 'humidity':    return '#5ac8fa'
        case 'battery':     return '#7CF29B'
        case 'energy':      return '#f5b945'
        case 'power':       return '#f5b945'
        default:            return '#9aa3b1'
      }
    default: return '#9aa3b1'
  }
}
