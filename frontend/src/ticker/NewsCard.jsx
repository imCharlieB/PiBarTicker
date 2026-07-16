import './NewsCard.css'

export default function NewsCard({ game }) {
  const headline = String(game?.headline || '').trim()
  if (!headline) return null
  return (
    <div className="d-news">
      <div className="d-news-type-bar">
        <span className="d-news-type-label">News</span>
      </div>
      <div className="d-news-body">
        <div className="d-news-headline">{headline}</div>
      </div>
    </div>
  )
}
