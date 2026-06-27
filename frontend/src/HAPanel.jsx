import { useEffect, useRef } from 'react'
import { useHASensors, HATickerCards } from './ticker/haHelpers'
import './HAPanel.css'
import './ticker/TickerCards.css'

export default function HAPanel({ homeAssistantBoard, scrollSpeed }) {
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

    const speed = scrollSpeed ?? 110
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
  }, [scrollSpeed]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ha-panel ticker-runtime-shell">
      <div className="ticker-runtime-marquee-window" ref={windowRef}>
        <div className="ticker-runtime-track" ref={trackRef} role="list">
          <HATickerCards homeAssistantBoard={homeAssistantBoard} sensorValues={sensorValues} />
        </div>
      </div>
    </div>
  )
}
