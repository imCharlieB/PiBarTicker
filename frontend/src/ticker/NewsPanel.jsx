import { useEffect, useRef, useState } from 'react'
import './NewsPanel.css'
import { newsAgo } from './newsTime.js'
import { newsLogoCandidates } from './newsLogo.js'

function NewsPanelCard({ article }) {
  const [failed, setFailed] = useState([])
  const headline = String(article?.headline || '').trim()
  if (!headline) return null
  // first candidate that has not failed to load (a failed earlier URL must not hide a corrected one)
  const logo = newsLogoCandidates(article?.leagueId, article?.logo).find((u) => !failed.includes(u)) || ''
  const leagueName = String(article?.leagueName || article?.leagueId || '').toUpperCase()
  const ago = newsAgo(article?.published)
  return (
    <div className="news-panel-card">
      {logo
        ? <img className="news-panel-logo" src={logo} alt="" onError={() => setFailed((f) => [...f, logo])} />
        : null}
      <div className="news-panel-text">
        <div className="news-panel-meta">{leagueName}{ago ? <span> · {ago}</span> : null}</div>
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
