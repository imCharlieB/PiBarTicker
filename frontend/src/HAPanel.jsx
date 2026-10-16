import { useEffect, useRef, useState } from 'react'
import { useHASensors, HATickerCards } from './ticker/haHelpers'
import './HAPanel.css'

/* The Home Assistant panel of the grid layout: the SAME cards as the ticker's Home Assistant slot (weather, sensors, printer), scrolling in the panel.
   (The panel used to carry its own flat copies of every card; they showed no temperature and drifted from the ticker's look.)
   `ticker-runtime-shell` on the track gives the cards their styles, and the panel is a size container so the cards' cqh units follow the panel's height. */
export default function HAPanel({ homeAssistantBoard, scrollSpeed }) {
  const sensorValues = useHASensors()
  const trackRef = useRef(null)
  const windowRef = useRef(null)
  const animRef = useRef(null)
  const measuredRef = useRef(0)
  const [trackWidth, setTrackWidth] = useState(0)

  // the cards get wider once the sensor data arrives: scroll again with the real width (only a big change, never for a changing number)
  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const width = Math.round(track.scrollWidth)
      if (Math.abs(width - measuredRef.current) > 60) setTrackWidth(width)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const track = trackRef.current
    const win = windowRef.current
    if (!track || !win) return undefined

    const totalWidth = track.scrollWidth
    measuredRef.current = totalWidth
    const containerWidth = win.clientWidth || window.innerWidth
    if (totalWidth < 10 || containerWidth < 10) return undefined

    const speed = scrollSpeed ?? 80
    const startX = containerWidth
    const endX = -totalWidth
    const dur = Math.round((startX - endX) / speed * 1000)

    let cancelled = false
    const loop = () => {
      if (cancelled) return
      const anim = track.animate(
        [{ transform: `translateX(${startX}px)` }, { transform: `translateX(${endX}px)` }],
        { duration: dur, fill: 'forwards', easing: 'linear' }
      )
      animRef.current = anim
      anim.finished.then(loop).catch(() => {})
    }
    loop()

    return () => {
      cancelled = true
      if (animRef.current) { try { animRef.current.cancel() } catch { /* already finished */ } }
    }
  }, [scrollSpeed, trackWidth])

  return (
    <div className="ha-panel" ref={windowRef}>
      <div className="ha-panel-track ticker-runtime-shell" ref={trackRef}>
        <HATickerCards homeAssistantBoard={homeAssistantBoard} sensorValues={sensorValues} />
      </div>
    </div>
  )
}
