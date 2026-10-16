import { useState } from 'react'
import './NewsCard.css'
import { newsAgo } from './newsTime.js'
import { newsLogoCandidates } from './newsLogo.js'

export default function NewsCard({ game, leagueLogoUrl }) {
  const [failed, setFailed] = useState([])
  const headline = String(game?.headline || '').trim()
  if (!headline) return null
  // first candidate that has not failed to load (a failed earlier URL must not hide a corrected one)
  const logo = newsLogoCandidates(game?.leagueId, leagueLogoUrl || game?.leagueLogo).find((u) => !failed.includes(u)) || ''
  const ago = newsAgo(game?.published)
  // ESPN's one-line description under the headline; skipped when it just repeats the headline
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const rawDesc = String(game?.description || '').trim()
  const description = rawDesc && norm(rawDesc) !== norm(headline) && !norm(rawDesc).startsWith(norm(headline)) ? rawDesc : ''
  return (
    <div className="d-news">
      <div className="d-news-league">
        {logo
          ? <img className="d-news-logo" src={logo} alt="" onError={() => setFailed((f) => [...f, logo])} />
          : null}
        {logo ? null : <span className="d-news-league-name">{game?.leagueName}</span>}
      </div>
      <div className="d-news-body">
        <div className="d-news-meta"><em>LATEST</em>{ago ? ` · ${ago}` : ''}</div>
        <div className="d-news-headline">{headline}</div>
        {description ? <div className="d-news-desc">{description}</div> : null}
        <div className="d-news-rule" />
      </div>
    </div>
  )
}
