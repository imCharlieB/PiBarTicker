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

export function haColorFor(live, sensor) {
  const domain = live?.domain || sensor?.entityId?.split('.')[0]
  const dc = live?.attributes?.device_class || ''
  const on = live?.state === 'on'
  switch (domain) {
    case 'climate':       return '#f0894e'
    case 'light':         return on ? '#ffc83d' : '#4b5563'
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
