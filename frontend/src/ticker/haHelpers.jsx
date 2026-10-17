import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { hexToRgb } from './cardHelpers.js'

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

// ── Animated weather icons (SVG + CSS keyframes in TickerCards.css, classes wi-*) — used by the weather card hero and its hourly strip ──
const WI_CLOUD = 'M28 70 a14 14 0 0 1 2-28 a21 21 0 0 1 40 5 a12 12 0 0 1 0 23 Z'
const WI_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]

function WiSun({ gid }) {
  return (
    <>
      <defs><radialGradient id={gid} cx=".4" cy=".35"><stop offset="0" stopColor="#ffe9a0" /><stop offset="1" stopColor="#f5a623" /></radialGradient></defs>
      <g className="wi-spin">{WI_RAYS.map((a) => <rect key={a} x="47" y="8" width="6" height="14" rx="3" fill="#f5b945" transform={`rotate(${a} 50 50)`} />)}</g>
      <circle className="wi-pulse" cx="50" cy="50" r="19" fill={`url(#${gid})`} />
    </>
  )
}
const WiCloud = ({ fill = '#aab4c3', transform }) => <path className="wi-drift" d={WI_CLOUD} fill={fill} transform={transform} />
const WiDrops = ({ xs, y = 64 }) => xs.map((x, i) => <line key={x} className={`wi-drop wi-d${i % 3}`} x1={x} y1={y} x2={x - 3} y2={y + 10} stroke="#5ac8fa" strokeWidth="4" strokeLinecap="round" />)
const WiFlakes = ({ xs, y = 66 }) => xs.map((x, i) => <circle key={x} className={`wi-flake wi-f${i % 3}`} cx={x} cy={y} r="3.4" fill="#e8f0fa" />)

// ── Home Assistant cards in the board's own look: a colour-washed half with a top bar and a big number, a dark seam with a status chip ──
// Cold = blue, hot = red, in between passes through a pale neutral then amber (never purple or green). Colours are computed here (no color-mix:
// the Pi's older Chromium ignores it). °C is converted to °F.
const TEMP_STOPS = [[30, [59, 130, 246]], [50, [56, 189, 248]], [62, [226, 232, 240]], [74, [251, 191, 36]], [86, [249, 115, 22]], [98, [239, 68, 68]]]
function tempRGB(temp, unit) {
  const f = /c/i.test(String(unit || '')) ? Number(temp) * 9 / 5 + 32 : Number(temp)
  if (!Number.isFinite(f)) return [154, 163, 177]
  if (f <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1]
  for (let k = 1; k < TEMP_STOPS.length; k++) {
    if (f <= TEMP_STOPS[k][0]) {
      const [x0, c0] = TEMP_STOPS[k - 1]; const [x1, c1] = TEMP_STOPS[k]
      return c0.map((v, n) => Math.round(v + (c1[n] - v) * (f - x0) / (x1 - x0)))
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1]
}
const rgbOf = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const washOf = (c) => `linear-gradient(160deg, ${rgbOf(c, 0.5)} 0%, ${rgbOf(c, 0.16)} 62%, #0e1117 100%)`
const hexRGB = (hex, fallback = [154, 163, 177]) => { const c = hexToRgb(String(hex || '').slice(0, 7)); return c ? [c.r, c.g, c.b] : fallback }
const numOf = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const fmtMinutes = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`)

export function WeatherIcon({ condition }) {
  const gid = `wig${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const c = String(condition || '').toLowerCase()
  let body
  if (c === 'sunny') body = <WiSun gid={gid} />
  else if (c === 'clear-night') {
    body = (
      <>
        <g className="wi-bob"><path d="M60 16 A34 34 0 1 0 84 62 A27 27 0 0 1 60 16 Z" fill="#7fd0ff" /></g>
        <path className="wi-twk1" d="M78 22 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5Z" fill="#cfeaff" />
        <path className="wi-twk2" d="M88 48 l1.6 3.8 3.8 1.6 -3.8 1.6 -1.6 3.8 -1.6 -3.8 -3.8 -1.6 3.8 -1.6Z" fill="#cfeaff" />
        <path className="wi-twk3" d="M66 8 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4Z" fill="#cfeaff" />
      </>
    )
  } else if (c === 'partlycloudy' || c === 'partly-cloudy') {
    body = (
      <>
        <g transform="translate(-12,-16) scale(.7)"><WiSun gid={gid} /></g>
        <WiCloud transform="translate(6,8)" />
      </>
    )
  } else if (c === 'rainy' || c === 'pouring') {
    body = <><WiCloud fill="#9aa7b8" transform="translate(0,-10)" /><WiDrops xs={c === 'pouring' ? [34, 44, 54, 64, 72] : [38, 52, 66]} /></>
  } else if (c === 'snowy') {
    body = <><WiCloud fill="#a9b6c8" transform="translate(0,-10)" /><WiFlakes xs={[36, 50, 64]} /></>
  } else if (c === 'snowy-rainy') {
    body = <><WiCloud fill="#9fb0c4" transform="translate(0,-10)" /><WiDrops xs={[40, 62]} /><WiFlakes xs={[51, 72]} /></>
  } else if (c === 'lightning' || c === 'lightning-rainy') {
    body = (
      <>
        <WiCloud fill="#7a8496" transform="translate(0,-12)" />
        {c === 'lightning-rainy' ? <WiDrops xs={[34, 70]} y={60} /> : null}
        <path className="wi-bolt" d="M55 52 L42 76 L52 76 L46 96 L66 68 L55 68 L61 52 Z" fill="#ffd84d" />
      </>
    )
  } else if (c === 'hail') {
    body = <><WiCloud fill="#9aa7b8" transform="translate(0,-10)" />{[38, 52, 66].map((x, i) => <circle key={x} className={`wi-drop wi-d${i}`} cx={x} cy="66" r="3.6" fill="#dff3ff" />)}</>
  } else if (c === 'fog') {
    body = <><WiCloud fill="#9aa3b1" transform="translate(0,-14)" />{[66, 76, 86].map((y, i) => <line key={y} className={`wi-fogline wi-d${i}`} x1="24" y1={y} x2="76" y2={y} stroke="#b8c2d0" strokeWidth="4.5" strokeLinecap="round" />)}</>
  } else if (c === 'windy' || c === 'windy-variant') {
    body = <>{[34, 50, 66].map((y, i) => <path key={y} className={`wi-wind wi-d${i}`} d={`M14 ${y} H62 a9 9 0 1 0 -9 -9`} fill="none" stroke="#4fd1c5" strokeWidth="5" strokeLinecap="round" />)}</>
  } else body = <WiCloud />
  return <svg className="wi" viewBox="0 0 100 100" aria-hidden="true">{body}</svg>
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
    // the thermostat's mode: the `hvac_mode` attribute when there is one, else the entity's own state (cool / heat / off ... - some thermostats, e.g. the Breez-i, only report it there)
    const mode = String(live.attributes?.hvac_mode || live.state || '').toLowerCase()
    const showMode = mode && !['unknown', 'unavailable'].includes(mode)
    if (cur != null && set != null && mode !== 'off') {
      return (
        <>
          {cur}°<span className="ha-climate-arrow"> → </span>{set}°
          {showMode && <span className="ha-climate-mode">{mode.replace('_', '/').toUpperCase()}</span>}
        </>
      )
    }
    if (cur != null) return <>{cur}°{showMode && <span className="ha-climate-mode">{mode.replace('_', '/').toUpperCase()}</span>}</>
    return <>{live.state}</>
  }

  const unit = sensor.unit || live.unit || ''
  return <>{live.state}{unit ? <span className={unitClass}>{unit}</span> : null}</>
}

// Home Assistant does not always send a device class: guess one from the unit / entity name so a temperature gets a thermometer, not the gauge.
function inferDeviceClass(live, sensor) {
  const unit = String(sensor?.unit || live?.unit || live?.attributes?.unit_of_measurement || '').trim()
  const id = String(sensor?.entityId || '').toLowerCase()
  if (/°/.test(unit) || /temperature/.test(id)) return 'temperature'
  if (/humidity/.test(id)) return 'humidity'
  if (/^k?w$/i.test(unit)) return 'power'
  if (/^k?wh$/i.test(unit)) return 'energy'
  return ''
}

export function haIconFor(live, sensor) {
  const haAttr = live?.attributes?.icon
  if (haAttr && haAttr.startsWith('mdi:')) return haAttr.replace('mdi:', 'mdi-')
  const domain = live?.domain || sensor.entityId.split('.')[0]
  const dc = live?.attributes?.device_class || inferDeviceClass(live, sensor)
  switch (domain) {
    case 'climate':
      switch (String(live?.state || '').toLowerCase()) {
        case 'cool':      return 'mdi-snowflake'
        case 'heat':      return 'mdi-fire'
        case 'heat_cool':
        case 'auto':      return 'mdi-thermometer-auto'
        case 'dry':       return 'mdi-water-percent'
        case 'fan_only':  return 'mdi-fan'
        case 'off':       return 'mdi-power'
        default:          return 'mdi-thermostat'
      }
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
  // a device row (device:<id>) only means something to a printer card
  const sensorsFor = (card) => tickerSensors.filter((s) => s.cardId === card.id && (card.variant === 'printer' || !s.entityId.startsWith('device:')))

  if (cards.length === 0) {
    if (tickerSensors.length === 0) return null
    return <HASensorCard card={{ title: 'HOME', sub: '' }} sensors={tickerSensors.filter((s) => !s.entityId.startsWith('device:'))} sensorValues={sensorValues} />
  }

  const cardEls = cards.map((card) => {
    if (card.enabled === false) return null
    const cardSensors = sensorsFor(card)
    if (cardSensors.length === 0 && !(card.variant === 'printer' && card.deviceIds?.length)) return null
    if (card.variant === 'weather') return <HAWeatherCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
    if (card.variant === 'printer') return <HAPrinterCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
    return <HASensorCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
  })

  // If every card returned null (no sensors assigned), fall back to a catch-all HOME card
  const hasVisible = cardEls.some(Boolean)
  if (!hasVisible) {
    if (tickerSensors.length === 0) return null
    return <HASensorCard card={{ title: 'HOME', sub: '' }} sensors={tickerSensors.filter((s) => !s.entityId.startsWith('device:'))} sensorValues={sensorValues} />
  }

  return cardEls
}

// A thermostat / mini split as an ordinary tile: room temperature -> target, and one line saying what it is running (mode, fan, preset such as Turbo). Nothing else.
function ClimateTile({ sensor, live, label, tone }) {
  const a = live?.attributes || {}
  const mode = String(a.hvac_mode || live?.state || '').toLowerCase()
  const off = mode === 'off'
  const action = String(a.hvac_action || '').toLowerCase()
  const running = [
    off ? 'OFF' : (action && action !== 'idle' ? action : mode.replace('_', '/')),
    !off && a.fan_mode ? `FAN ${a.fan_mode}` : '',
    !off && a.preset_mode && String(a.preset_mode).toLowerCase() !== 'none' ? String(a.preset_mode) : '',  // Turbo, Eco... (nothing when the preset is "none")
  ].filter((t) => t && t !== 'unknown' && t !== 'unavailable').join(' · ').toUpperCase()
  const cur = numOf(a.current_temperature)
  const set = numOf(a.temperature)
  return (
    <div className={`hs-tile${off ? ' hs-tile-off' : ''}`} style={{ background: washOf(tone), '--ac': rgbOf(tone) }}>
      <i className="hs-bar" style={{ background: rgbOf(tone) }} />
      <span className="hs-tile-l"><i className={`mdi ${haIconFor(live, sensor)}`} style={{ color: rgbOf(tone) }} />{label}</span>
      <span className="hs-tile-v">
        {cur != null ? `${Math.round(cur)}°` : '—'}
        {set != null && !off ? <><span className="hs-tile-arrow">→</span>{Math.round(set)}°</> : null}
      </span>
      {running ? <span className="hs-tile-run">{running}</span> : null}
    </div>
  )
}

export function HASensorCard({ card, sensors, sensorValues }) {
  if (sensors.length === 0) return null
  const cols = sensors.length <= 3 ? 1 : sensors.length <= 8 ? 2 : 3
  return (
    <div className="card hs-card hs-se" style={{ '--cols': cols }} role="listitem">
      <div className="hs-se-head">
        <span className="chip chip-live">{card.title}</span>
        {card.sub ? <span className="hs-se-sub">{card.sub}</span> : null}
      </div>
      <div className="hs-se-grid">
        {sensors.map((sensor) => {
          const live = sensorValues[sensor.entityId]
          const label = sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')
          const tone = hexRGB(haColorFor(live, sensor))
          if ((live?.domain || sensor.entityId.split('.')[0]) === 'climate') return <ClimateTile key={sensor.entityId} sensor={sensor} live={live} label={label} tone={tone} />
          return (
            <div key={sensor.entityId} className="hs-tile" style={{ background: washOf(tone) }}>
              <i className="hs-bar" style={{ background: rgbOf(tone) }} />
              <span className="hs-tile-l"><i className={`mdi ${haIconFor(live, sensor)}`} style={{ color: rgbOf(tone) }} />{label}</span>
              <span className="hs-tile-v">{renderEntityValue(live, sensor, 'ha-unit')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HAWeatherCard({ card, sensors, sensorValues }) {
  let live = null
  for (const s of sensors) {
    const v = sensorValues[s.entityId]
    if ((v?.domain || s.entityId.split('.')[0]) === 'weather') { live = v; break }
  }
  const dailyLive = card.dailySensorId ? (sensorValues[card.dailySensorId] ?? null) : null
  const forecastSource = dailyLive ?? live
  const condition = live?.state ?? '—'
  const temp = live?.attributes?.temperature
  const feels = live?.attributes?.apparent_temperature
  const tempUnit = live?.attributes?.temperature_unit ?? '°'
  const humidity = live?.attributes?.humidity
  const windSpeed = live?.attributes?.wind_speed
  const windUnit = live?.attributes?.wind_speed_unit ?? ''
  const forecast0 = forecastSource?.attributes?.forecast?.[0]
  const hiTemp = forecast0?.temperature ?? forecast0?.high_temperature
  const loTemp = forecast0?.templow ?? forecast0?.low_temperature
  // Hourly forecast (the "Hourly forecast" sensor chosen on the Home Assistant Setup page): the next 7 hours after the current one (the big panel already shows now)
  const hourlyRows = (() => {
    const rows = card.hourlySensorId ? sensorValues[card.hourlySensorId]?.attributes?.forecast : null
    if (!Array.isArray(rows)) return []
    const from = Date.now()
    return rows.filter((r) => Number.isFinite(Date.parse(r?.datetime)) && Date.parse(r.datetime) >= from && r.temperature != null).slice(0, 7)
  })()
  const hourLabel = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '')
  const tone = tempRGB(temp, tempUnit)
  return (
    <div className="card hs-card hs-wx" role="listitem">
      <div className="hs-half" style={{ background: washOf(tone) }}>
        <i className="hs-bar" style={{ background: rgbOf(tone) }} />
        <div className="hs-top"><span className="hs-wicon"><WeatherIcon condition={condition} /></span><span className="hs-abbr">NOW</span></div>
        <div className="hs-score">{temp != null ? Math.round(Number(temp)) : '—'}<small>{tempUnit}</small></div>
        <div className="hs-stats">
          {feels != null ? <span>FEELS {Math.round(Number(feels))}°</span> : null}
          {hiTemp != null ? <span>H {Math.round(hiTemp)}°</span> : null}
          {loTemp != null ? <span>L {Math.round(loTemp)}°</span> : null}
          {humidity != null ? <span><i className="mdi mdi-water-percent" />{Math.round(humidity)}%</span> : null}
          {windSpeed != null ? <span><i className="mdi mdi-weather-windy" />{Math.round(windSpeed)} {windUnit}</span> : null}
        </div>
      </div>
      {hourlyRows.length > 1 ? (
        <div className="hs-hours">
          {hourlyRows.map((r) => {
            const hc = tempRGB(r.temperature, tempUnit)
            const rain = Math.round(Number(r.precipitation_probability) || 0)
            return (
              <div key={r.datetime} className="hs-hour" style={{ background: washOf(hc) }}>
                <i className="hs-bar" style={{ background: rgbOf(hc) }} />
                <span className="chip chip-final hs-hchip">{hourLabel(r.datetime)}</span>
                <span className="hs-hicon"><WeatherIcon condition={r.condition} /></span>
                <div className="hs-hbot">
                  <span className="hs-htemp">{Math.round(Number(r.temperature))}°</span>
                  {rain > 0 ? <span className="hs-hrain">{rain}%</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// The pushed sensors that belong to the Home Assistant devices picked on a printer card (a Bambu Lab printer + its AMS units), grouped per device and keyed by the integration's own key
function sensorsOfDevices(card, sensorValues) {
  const wanted = new Set(card.deviceIds || [])
  const devices = {}
  for (const s of Object.values(sensorValues)) {
    if (!s?.device_id || !wanted.has(s.device_id)) continue
    const d = (devices[s.device_id] = devices[s.device_id] || { id: s.device_id, name: s.device_name, model: s.device_model, byKey: {} })
    // the Bambu plugin gives every tray sensor the key "tray": the slot number is in the entity id (..._tray_1)
    const slot = (!s.key || s.key === 'tray') ? String(s.entity_id || '').match(/(tray_\d+)$/) : null
    const key = slot ? slot[1] : s.key
    if (key) d.byKey[key] = s
  }
  return Object.values(devices)
}

// Product picture of a Home Assistant device (the Pi downloads it once and caches it; see backend/app/api/ha_images.py). Shown in a light tile
// like the logo boxes on the sports cards; each picture has its own framing so the product fills the tile.
const DEVICE_IMAGE_FRAME = { h2d: [1.5, 52, 56], ams: [1.25, 50, 50], ams_ht: [1.4, 50, 50] }
function deviceImageKey(model) {
  const m = String(model || '').toLowerCase()
  if (m.includes('ams') && m.includes('ht')) return 'ams_ht'
  if (m.includes('ams')) return 'ams'
  if (m.includes('h2d')) return 'h2d'
  return null
}
function DeviceImage({ model, fallback }) {
  const [failed, setFailed] = useState(false)
  const key = deviceImageKey(model)
  if (!key || failed) return fallback ?? null
  const [scale, x, y] = DEVICE_IMAGE_FRAME[key]
  return (
    <span className="hs-dimg">
      <img src={`/api/v1/ha/device-image/${key}`} alt="" onError={() => setFailed(true)} style={{ transform: `scale(${scale})`, transformOrigin: `${x}% ${y}%` }} />
    </span>
  )
}

// The picture of the print that is running (the Bambu Lab plugin's cover image, sent to the Pi by the Home Assistant integration). Falls back to
// `fallback` (the printer's product photo) when it cannot be loaded.
function CoverImage({ url, fallback }) {
  const [failedUrl, setFailedUrl] = useState('')
  if (!url || failedUrl === url) return fallback ?? null
  return (
    <span className="hs-dimg hs-cover">
      <img src={url} alt="" onError={() => setFailedUrl(url)} />
    </span>
  )
}

// "H2D_0947AJ612800457_AMS_1" -> "AMS 2" (AMS 2 Pro), "AMS HT"; a label typed on the device row in Setup wins
function amsShortName(model, name) {
  const m = String(model || name || '').toLowerCase()
  if (m.includes('ht')) return 'AMS HT'
  if (/2\s*pro/.test(m)) return 'AMS 2'
  return 'AMS'
}

function AmsUnit({ unit, label }) {
  const trays = Object.entries(unit.byKey).filter(([k]) => /^tray_\d+$/.test(k) || k === 'external_spool').sort(([x], [y]) => x.localeCompare(y))
  const humidity = numOf(unit.byKey.humidity?.state)
  const drying = unit.byKey.drying?.state === 'on'
  const amsTemp = numOf(unit.byKey.temperature?.state)
  return (
    <div className="hs-ams">
      <div className="hs-ams-head">
        <DeviceImage model={unit.model} />
        <span className="chip chip-final">{label || amsShortName(unit.model, unit.name)}</span>
        {humidity != null ? <span className="hs-ams-hum"><i className="mdi mdi-water-percent" />{Math.round(humidity)}%</span> : null}
        {amsTemp != null ? <span className="hs-ams-hum hs-ams-temp"><i className="mdi mdi-thermometer" />{Math.round(amsTemp)}°</span> : null}
        {drying ? <span className="chip chip-live">Drying</span> : null}
      </div>
      <div className="hs-spools">
        {trays.map(([key, sensor]) => {
          const a = sensor.attributes || {}
          const color = hexRGB(a.color || a.colour, [70, 78, 92])
          const remaining = numOf(a.remain ?? a.remaining)
          const empty = a.empty === true || /empty/i.test(String(sensor.state)) || (!a.color && !a.colour && !a.type)
          return (
            <div key={key} className={`hs-spool${empty ? ' empty' : ''}`}>
              <span className="hs-spool-bar"><i style={{ height: `${empty ? 0 : remaining != null && remaining >= 0 ? remaining : 100}%`, background: rgbOf(color) }} /></span>
              <span className="hs-spool-t">{empty ? '—' : (a.type || a.filament_type || '').toString().replace(/^Bambu /i, '')}</span>
              <span className="hs-spool-r">{!empty && remaining != null && remaining >= 0 ? `${Math.round(remaining)}%` : '\u00a0'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The card is exactly as wide as what is in it. `width: max-content` normally does that; when the browser works the width out too small (the Pi's
// Chromium cut the AMS header off) the contents' real width is used instead. Runs after every render because the contents change with the data.
function useFitWidth(cardRef, mainRef) {
  useLayoutEffect(() => {
    const card = cardRef.current
    const main = mainRef.current
    if (!card || !main) return undefined
    const fit = () => {
      card.style.width = ''
      if (main.scrollWidth > main.clientWidth + 1) card.style.width = `${main.scrollWidth}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(fit)
    observer.observe(main)
    Array.from(main.children).forEach((child) => observer.observe(child))
    if (document.fonts?.ready) document.fonts.ready.then(fit)
    return () => observer.disconnect()
  })
}

export function HAPrinterCard({ card, sensors, sensorValues }) {
  const cardRef = useRef(null)
  const mainRef = useRef(null)
  useFitWidth(cardRef, mainRef)
  // devices assigned to this card in Setup (rows named device:<id>) + single sensors
  const deviceIds = sensors.filter((x) => x.entityId.startsWith('device:')).map((x) => x.entityId.slice(7))
  const deviceLabels = Object.fromEntries(sensors.filter((x) => x.entityId.startsWith('device:') && x.label).map((x) => [x.entityId.slice(7), x.label]))
  sensors = sensors.filter((x) => !x.entityId.startsWith('device:'))
  const devices = deviceIds.length ? sensorsOfDevices({ deviceIds }, sensorValues) : []
  const printer = devices.find((d) => d.byKey.print_progress || d.byKey.stage)
  const amsUnits = devices.filter((d) => d !== printer && Object.keys(d.byKey).some((k) => /^tray_\d+$/.test(k) || k === 'external_spool'))
  let pct = null
  let stage = ''
  let left = null
  let eta = ''
  let layer = null
  let layers = null
  let nozzle = null
  let nozzleT = null
  let bed = null
  let bedT = null
  let chamber = null
  let chamberT = null
  let speed = ''
  let printError = false
  let job = ''
  const extras = []
  if (printer) {
    const k = printer.byKey
    pct = numOf(k.print_progress?.state)
    stage = String(k.stage?.state || k.print_status?.state || '')
    left = numOf(k.remaining_time?.state)
    eta = k.end_time?.state && k.end_time.state !== 'unknown' ? k.end_time.state : ''
    layer = numOf(k.current_layer?.state)
    layers = numOf(k.total_layers?.state)
    nozzle = numOf(k.nozzle_temp?.state)
    nozzleT = numOf(k.target_nozzle_temp?.state)
    bed = numOf(k.bed_temp?.state)
    bedT = numOf(k.target_bed_temp?.state)
    chamber = numOf(k.chamber_temp?.state)
    chamberT = numOf(k.target_chamber_temp?.state)
    speed = ['unknown', 'unavailable'].includes(String(k.speed_profile?.state)) ? '' : String(k.speed_profile?.state || '')
    printError = k.print_error?.state === 'on'
    job = String(k.subtask_name?.state || k.gcode_file?.state || '')
  } else {
    // single sensors picked by hand: the first one in % is the progress, the rest are listed in the middle
    for (const sensor of sensors) {
      const live = sensorValues[sensor.entityId]
      const unit = sensor.unit || live?.unit || live?.attributes?.unit_of_measurement || ''
      const val = parseFloat(live?.state)
      if (pct == null && unit === '%' && !isNaN(val) && val >= 0 && val <= 100) pct = val
      else extras.push(sensor)
    }
    if (pct == null && extras.length === 0) return null
  }
  const stageKey = stage.toLowerCase()
  const chipCls = printError ? 'chip-flag-red' : /print|run/.test(stageKey) ? 'chip-live' : /pause/.test(stageKey) ? 'chip-pre' : /fail|error/.test(stageKey) ? 'chip-flag-red' : 'chip-final'
  const idle = printer && (!stageKey || /idle|offline|unavailable|unknown|finish/.test(stageKey)) && !(pct > 0 && pct < 100)
  const tone = [255, 122, 89]
  const showPct = pct != null && !idle
  const printing = showPct
  // the running print's picture: its entity's state is a timestamp that changes with every new picture, so it is also the cache-buster
  const cover = printer?.byKey?.cover_image
  const coverUrl = cover && !['unknown', 'unavailable', ''].includes(String(cover.state)) ? `/api/v1/ha/cover/${cover.entity_id}?v=${encodeURIComponent(cover.state)}` : ''
  const productPhoto = <DeviceImage model={printer?.model} fallback={<span className="hs-box hs-box-i"><i className="mdi mdi-printer-3d" /></span>} />
  const fmtEta = eta ? new Date(eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  const temp = (v, t) => (v == null ? null : t != null && t > 0 ? `${Math.round(v)}→${Math.round(t)}°` : `${Math.round(v)}°`)
  return (
    <div className="card hs-card hs-pr" role="listitem" ref={cardRef}>
      <div className="hs-pr-main" ref={mainRef}>
        <div className="hs-half hs-pr-half" style={{ background: washOf(tone) }}>
          <i className="hs-bar" style={{ background: rgbOf(tone) }} />
          <div className="hs-top">{printing && coverUrl ? <CoverImage url={coverUrl} fallback={productPhoto} /> : productPhoto}<span className="hs-abbr">{card.title && card.title.length <= 7 ? card.title : 'PRINT'}</span></div>
          {showPct
            ? <div className="hs-score">{Math.round(pct)}<small>%</small></div>
            : <div className="hs-score"><span className="hs-score-word">{printer ? (stage ? stage.replace(/[-_]/g, ' ') : 'idle') : '—'}</span></div>}
          <div className="hs-plate">{showPct && layers ? `LAYER ${layer ?? 0} / ${layers}` : (showPct ? job : null) || deviceLabels[printer?.id] || printer?.model || card.sub || 'PRINTER'}</div>
          {idle ? (
            <div className="hs-stats">
              {temp(nozzle, nozzleT) ? <span>NOZZLE {temp(nozzle, nozzleT)}</span> : null}
              {temp(bed, bedT) ? <span>BED {temp(bed, bedT)}</span> : null}
              {temp(chamber, chamberT) ? <span>CHAMBER {temp(chamber, chamberT)}</span> : null}
            </div>
          ) : null}
        </div>
        {idle ? null : <div className="hs-seam hs-pr-seam">
          <span className={`chip ${chipCls}`}>{chipCls === 'chip-live' ? <i className="chip-dot" /> : null}{printError ? 'Print error' : stage ? stage.replace(/[-_]/g, ' ') : (printer ? 'Idle' : 'Printing')}</span>
          {left != null && !idle ? <div className="hs-meta"><b>{fmtMinutes(left)}</b><span>left</span></div> : null}
          {fmtEta && !idle ? <div className="hs-meta hs-meta-eta"><span>ETA</span><b>{fmtEta}</b></div> : null}
          <div className="hs-meta hs-meta2">
            {temp(nozzle, nozzleT) ? <span><em>NOZZLE</em>{temp(nozzle, nozzleT)}</span> : null}
            {temp(bed, bedT) ? <span><em>BED</em>{temp(bed, bedT)}</span> : null}
            {temp(chamber, chamberT) ? <span><em>CHAMBER</em>{temp(chamber, chamberT)}</span> : null}
            {speed ? <span><em>SPEED</em>{speed.replace(/[-_]/g, ' ')}</span> : null}
            {extras.slice(0, 3).map((sensor) => (
              <span key={sensor.entityId}>{sensor.label || sensor.entityId.split('.').pop().replace(/_/g, ' ')} {renderEntityValue(sensorValues[sensor.entityId], sensor, 'ha-unit')}</span>
            ))}
          </div>
        </div>}
        {amsUnits.map((u) => <AmsUnit key={u.id} unit={u} label={deviceLabels[u.id]} />)}
      </div>
      {showPct ? (
        <div className="hs-track">
          <div className="hs-track-bar">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => <i key={t} style={{ left: `${t * 12.5}%` }} />)}
            <div className="hs-track-fill" style={{ width: `${pct}%` }} />
            <span className="hs-track-ball" style={{ left: `${pct}%` }} />
          </div>
          <div className="hs-track-l"><span>{job ? job.slice(0, 60) : 'START'}</span><span>DONE</span></div>
        </div>
      ) : null}
    </div>
  )
}

export function haColorFor(live, sensor) {
  const domain = live?.domain || sensor?.entityId?.split('.')[0]
  const dc = live?.attributes?.device_class || inferDeviceClass(live, sensor)
  const on = live?.state === 'on'
  switch (domain) {
    case 'climate':
      switch (String(live?.state || '').toLowerCase()) {
        case 'cool':      return '#5ac8fa'
        case 'heat':      return '#f0894e'
        case 'heat_cool':
        case 'auto':      return '#f5b945'
        case 'dry':       return '#5ac8fa'
        case 'off':       return '#6b7480'
        default:          return '#9aa3b1'
      }
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
