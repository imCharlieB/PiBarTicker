import { runtimeTeamName, teamRecordText, teamRowStyle } from './cardHelpers.js'

export default function GameCard({ game }) {
  const away = game?.teams?.away
  const home = game?.teams?.home
  const awayLogo = away?.logo || ''
  const homeLogo = home?.logo || ''
  const awayBadge = String(away?.abbreviation || away?.name || '?').slice(0, 3).toUpperCase()
  const homeBadge = String(home?.abbreviation || home?.name || '?').slice(0, 3).toUpperCase()
  const gameState = String(game?.state || '').toLowerCase()

  if (game?.cardStyle === 'large-logo') {
    if (gameState === 'post') {
      return (
        <div className="ticker-runtime-ll">
          <div className="ll-final">
            <div className="ll-final-top">FINAL</div>
            <div className="ll-final-logos">
              <div className="ll-final-logo">
                {awayLogo
                  ? <img src={awayLogo} alt={runtimeTeamName(away)} />
                  : <span className="ll-badge ll-big">{awayBadge}</span>}
              </div>
              <div className="ll-final-logo">
                {homeLogo
                  ? <img src={homeLogo} alt={runtimeTeamName(home)} />
                  : <span className="ll-badge ll-big">{homeBadge}</span>}
              </div>
            </div>
            <div className="ll-final-score-bottom">{away?.score ?? '-'} — {home?.score ?? '-'}</div>
          </div>
        </div>
      )
    }

    return (
      <div className="ticker-runtime-ll">
        <div className="ll-scheduled">
          <div className="ll-sched-logos">
            <div className="ll-logo ll-away ll-sched-logo">
              {awayLogo
                ? <img src={awayLogo} alt={runtimeTeamName(away)} />
                : <span className="ll-badge">{awayBadge}</span>}
            </div>
            <div className="ll-sched-vs">VS</div>
            <div className="ll-logo ll-home ll-sched-logo">
              {homeLogo
                ? <img src={homeLogo} alt={runtimeTeamName(home)} />
                : <span className="ll-badge">{homeBadge}</span>}
            </div>
          </div>
          <div className="ll-sched-time">{game.runtimeDateText || 'TBD'}</div>
          {game?.status?.detail && !/scheduled|pre/i.test(String(game.status.detail)) ? (
            <div className="ll-sched-detail">{game.status.detail}</div>
          ) : null}
        </div>
      </div>
    )
  }

  // Standard two-row layout
  return (
    <>
      <div className="ticker-runtime-row ticker-runtime-row-away" style={game?.useTeamCardColors ? teamRowStyle(away) : undefined}>
        <div className="ticker-runtime-team">
          {awayLogo
            ? <img src={awayLogo} alt={runtimeTeamName(away)} />
            : <span className="ticker-runtime-team-mark" aria-hidden="true">{awayBadge}</span>}
          <span className="ticker-runtime-team-name-block">
            {game?.showStatRecords && teamRecordText(away) ? (
              <span className="ticker-runtime-team-meta-row">
                <span className="ticker-runtime-team-name">{runtimeTeamName(away)}</span>
                <span className="ticker-runtime-team-record">{teamRecordText(away)}</span>
              </span>
            ) : (
              <span className="ticker-runtime-team-name">{runtimeTeamName(away)}</span>
            )}
          </span>
        </div>
        <span className="ticker-runtime-score-block">
          <strong className="ticker-runtime-score">{away?.score || '-'}</strong>
        </span>
      </div>

      <div className="ticker-runtime-divider" />

      <div className="ticker-runtime-row ticker-runtime-row-home" style={game?.useTeamCardColors ? teamRowStyle(home) : undefined}>
        <div className="ticker-runtime-team">
          {homeLogo
            ? <img src={homeLogo} alt={runtimeTeamName(home)} />
            : <span className="ticker-runtime-team-mark" aria-hidden="true">{homeBadge}</span>}
          <span className="ticker-runtime-team-name-block">
            {game?.showStatRecords && teamRecordText(home) ? (
              <span className="ticker-runtime-team-meta-row">
                <span className="ticker-runtime-team-name">{runtimeTeamName(home)}</span>
                <span className="ticker-runtime-team-record">{teamRecordText(home)}</span>
              </span>
            ) : (
              <span className="ticker-runtime-team-name">{runtimeTeamName(home)}</span>
            )}
          </span>
        </div>
        <span className="ticker-runtime-score-block">
          <strong className="ticker-runtime-score">{home?.score || '-'}</strong>
        </span>
      </div>

      {game?.runtimeDateText ? (
        <p className="ticker-runtime-game-date">{game.runtimeDateText}</p>
      ) : null}

      {Array.isArray(game?.detailStats) && game.detailStats.length ? (
        <div className="ticker-runtime-stats" aria-label="Game detail stats">
          {game.detailStats.map((item) => (
            <p key={`${game.id}-${item.label}`} className="ticker-runtime-stat-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </p>
          ))}
        </div>
      ) : null}
    </>
  )
}
