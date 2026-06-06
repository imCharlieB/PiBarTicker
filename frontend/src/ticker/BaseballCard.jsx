import { runtimeTeamName, teamRecordText, teamRowStyle } from './cardHelpers.js'

export default function BaseballCard({ game }) {
  const away = game?.teams?.away
  const home = game?.teams?.home
  const awayLogo = away?.logo || ''
  const homeLogo = home?.logo || ''
  const awayBadge = String(away?.abbreviation || away?.name || '?').slice(0, 3).toUpperCase()
  const homeBadge = String(home?.abbreviation || home?.name || '?').slice(0, 3).toUpperCase()
  const hasBaseballLiveDiamond = Boolean(game?.showLiveState && game?.baseballLiveData)
  const resolvedBattingSide = game?.baseballBattingSide === 'home' || game?.baseballBattingSide === 'away'
    ? game.baseballBattingSide
    : 'away'
  const showAwayBaseDiamond = hasBaseballLiveDiamond && resolvedBattingSide === 'away'
  const showHomeBaseDiamond = hasBaseballLiveDiamond && resolvedBattingSide === 'home'
  const gameState = String(game?.state || '').toLowerCase()

  if (game?.cardStyle === 'large-logo') {
    if (gameState === 'in' && game.baseballLiveData) {
      return (
        <div className="ticker-runtime-ll">
          <div className="ll-live">
            <div className="ll-logos">
              <div className="ll-logo ll-away">
                {awayLogo
                  ? <img src={awayLogo} alt={runtimeTeamName(away)} />
                  : <span className="ll-badge">{awayBadge}</span>}
              </div>
              <div className="ll-logo ll-home">
                {homeLogo
                  ? <img src={homeLogo} alt={runtimeTeamName(home)} />
                  : <span className="ll-badge">{homeBadge}</span>}
              </div>
            </div>
            <div className="ll-scorebox">
              <div
                className="ll-score ll-away-score"
                style={away?.palette?.primary ? { backgroundColor: away.palette.primary, color: '#fff' } : {}}
              >
                {away?.score ?? '-'}
              </div>
              <div
                className="ll-score ll-home-score"
                style={home?.palette?.primary ? { backgroundColor: home.palette.primary, color: '#fff' } : {}}
              >
                {home?.score ?? '-'}
              </div>
            </div>
            <div className="ll-side">
              <div className="ll-baseball-field">
                <div className="ll-infield" />
                <div className="base" id="second-base" />
                <div className="base" id="first-base" />
                <div className="base" id="third-base" />
              </div>
              <div className="ll-meta">
                <div className="ll-inning-count">
                  <div className="ll-inning">
                    {game.baseballLiveData?.inning || '?'}
                    <span className="ll-arrow">
                      {(game.baseballLiveData?.halfInning || '').toLowerCase().startsWith('top') ? '▲' : '▼'}
                    </span>
                  </div>
                  <div className="ll-count">
                    {game.baseballLiveData?.balls ?? 0}-{game.baseballLiveData?.strikes ?? 0}
                  </div>
                </div>
                <div className="ll-outs">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`ll-out ${i < (game.baseballLiveData?.outs || 0) ? 'filled' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

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

  // Standard two-row layout with baseball live elements
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
          {showAwayBaseDiamond ? (
            <div className="ticker-runtime-baseball-diamond ticker-runtime-baseball-diamond-score" aria-label="Away team at bat">
              <span className={`ticker-runtime-base ticker-runtime-base-second${game.baseballLiveData.onSecond ? ' is-occupied' : ''}`} />
              <span className={`ticker-runtime-base ticker-runtime-base-first${game.baseballLiveData.onFirst ? ' is-occupied' : ''}`} />
              <span className="ticker-runtime-base ticker-runtime-base-home" />
              <span className={`ticker-runtime-base ticker-runtime-base-third${game.baseballLiveData.onThird ? ' is-occupied' : ''}`} />
            </div>
          ) : null}
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
          {showHomeBaseDiamond ? (
            <div className="ticker-runtime-baseball-diamond ticker-runtime-baseball-diamond-score" aria-label="Home team at bat">
              <span className={`ticker-runtime-base ticker-runtime-base-second${game.baseballLiveData.onSecond ? ' is-occupied' : ''}`} />
              <span className={`ticker-runtime-base ticker-runtime-base-first${game.baseballLiveData.onFirst ? ' is-occupied' : ''}`} />
              <span className="ticker-runtime-base ticker-runtime-base-home" />
              <span className={`ticker-runtime-base ticker-runtime-base-third${game.baseballLiveData.onThird ? ' is-occupied' : ''}`} />
            </div>
          ) : null}
        </span>
      </div>

      {game?.showLiveState && game?.baseballLiveData ? (
        <div className="ticker-runtime-baseball-situation-right" aria-label="Baseball live situation">
          <div className="ticker-runtime-baseball-live-text">
            <p>
              {[
                game.baseballLiveData.outs !== null
                  ? `${game.baseballLiveData.outs} out${game.baseballLiveData.outs === 1 ? '' : 's'}`
                  : 'Live',
                game.baseballLiveData.balls !== null && game.baseballLiveData.strikes !== null
                  ? `Count ${game.baseballLiveData.balls}-${game.baseballLiveData.strikes}`
                  : '',
              ].filter(Boolean).join(' • ')}
            </p>
          </div>
        </div>
      ) : null}

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
