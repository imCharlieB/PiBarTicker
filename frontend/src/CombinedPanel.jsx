import { useEffect, useRef, useState } from 'react'
import { useHASensors, renderEntityValue, haIconFor, haColorFor, WEATHER_ICON_MAP } from './ticker/haHelpers'
import './HAPanel.css'
import './ticker/NewsPanel.css'

function HASensorCard({ card, sensors, sensorValues }) {
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

function HAWeatherCard({ card, sensors, sensorValues }) {
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
          {humidity != null && <div className="ha-panel-wx-stat"><i className="mdi mdi-water-percent" /><span>{humidity}%</span></div>}
          {windSpeed != null && <div className="ha-panel-wx-stat"><i className="mdi mdi-weather-windy" /><span>{windSpeed}{windUnit ? ` ${windUnit}` : ''}</span></div>}
        </div>
      )}
    </div>
  )
}

function HAPrinterCard({ card, sensors, sensorValues }) {
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

function HACards({ homeAssistantBoard, sensorValues }) {
  const sensors = homeAssistantBoard?.haSensors ?? []
  const cards = homeAssistantBoard?.haCards ?? []

  if (cards.length > 0) {
    const rendered = cards
      .filter(c => c.enabled !== false)
      .map(card => {
        const cardSensors = sensors.filter(s => s.cardId === card.id)
        if (!cardSensors.length) return null
        if (card.variant === 'weather') return <HAWeatherCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        if (card.variant === 'printer') return <HAPrinterCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
        return <HASensorCard key={card.id} card={card} sensors={cardSensors} sensorValues={sensorValues} />
      })
      .filter(Boolean)
    if (rendered.length > 0) return rendered
  }

  return <HASensorCard card={{ title: 'HOME', sub: '' }} sensors={sensors} sensorValues={sensorValues} />
}

function NewsCard({ article }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const headline = String(article?.headline || '').trim()
  if (!headline) return null
  const leagueId = String(article?.leagueId || '').trim().toLowerCase()
  const logoUrl = leagueId ? `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png` : ''
  return (
    <div className="news-panel-card">
      <div className="news-panel-bar">
        {logoUrl && !logoFailed
          ? <img className="news-panel-logo" src={logoUrl} alt="" onError={() => setLogoFailed(true)} />
          : <span className="news-panel-bar-text">{leagueId.toUpperCase()}</span>
        }
      </div>
      <div className="news-panel-body">
        <span className="news-panel-headline">{headline}</span>
      </div>
    </div>
  )
}

export default function CombinedPanel({ homeAssistantBoard, articles, scrollSpeed }) {
  const sensorValues = useHASensors()
  const trackRef = useRef(null)
  const windowRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    const track = trackRef.current
    const win = windowRef.current
    if (!track || !win) return

    const totalWidth = track.scrollWidth
    const containerWidth = win.clientWidth || window.innerWidth
    if (totalWidth < 10 || containerWidth < 10) return

    const speed = scrollSpeed ?? 80
    const startX = containerWidth
    const endX = -totalWidth
    const dur = Math.round((startX - endX) / speed * 1000)

    const loop = () => {
      const anim = track.animate(
        [{ transform: `translateX(${startX}px)` }, { transform: `translateX(${endX}px)` }],
        { duration: dur, fill: 'forwards', easing: 'linear' }
      )
      animRef.current = anim
      anim.finished.then(loop).catch(() => {})
    }
    loop()

    return () => {
      if (animRef.current) { try { animRef.current.cancel() } catch (_) {} }
    }
  }, [articles, scrollSpeed])

  return (
    <div className="ha-panel" ref={windowRef}>
      <div className="ha-panel-track" ref={trackRef}>
        <HACards homeAssistantBoard={homeAssistantBoard} sensorValues={sensorValues} />
        {(articles ?? []).map((article, i) => (
          <NewsCard key={article.id || i} article={article} />
        ))}
      </div>
    </div>
  )
}
