import { useEffect, useRef, useState } from 'react'
import './NewsPanel.css'

function NewsPanelCard({ article }) {
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

export default function NewsPanel({ articles, scrollSpeed }) {
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

  if (!articles?.length) {
    return (
      <div className="news-panel news-panel-empty">
        <span>No news available</span>
      </div>
    )
  }

  return (
    <div className="news-panel" ref={windowRef}>
      <div className="news-panel-track" ref={trackRef}>
        {articles.map((article, i) => (
          <NewsPanelCard key={article.id || i} article={article} />
        ))}
      </div>
    </div>
  )
}
