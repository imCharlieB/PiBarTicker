import {
  formatRuntimeDate,
  racingCardTitle,
  racingEntrySummary,
  racingHasTelemetry,
  racingLiveHeader,
  racingTelemetryFallback,
} from './cardHelpers.js'

function DriverBox({ entry, index, gameId }) {
  const pos = entry.position ?? index + 1
  const stat = racingEntrySummary(entry) || entry.score || ''
  const podiumClass = pos === 1 ? 'ticker-runtime-racing-driver-card-p1'
    : pos === 2 ? 'ticker-runtime-racing-driver-card-p2'
    : pos === 3 ? 'ticker-runtime-racing-driver-card-p3'
    : ''
  return (
    <div
      className={['ticker-runtime-racing-driver-card', podiumClass].filter(Boolean).join(' ')}
      key={`${gameId}-box-${entry.id || index}`}
    >
      <span className="ticker-runtime-racing-card-pos">{pos}</span>
      {entry.flag?.href ? (
        <img
          className="ticker-runtime-racing-card-flag"
          src={entry.flag.href}
          alt={entry.flag.alt || entry.name || ''}
        />
      ) : (
        <span className="ticker-runtime-racing-card-flag-placeholder" />
      )}
      <div className="ticker-runtime-racing-card-name-group">
        <span className="ticker-runtime-racing-card-name">{entry.shortName || entry.name || 'Driver'}</span>
        {entry.team ? <span className="ticker-runtime-racing-card-team">{entry.team}</span> : null}
      </div>
      {stat ? <span className="ticker-runtime-racing-card-stat">{stat}</span> : null}
    </div>
  )
}

export default function RacingCard({ game, isSoloSlate, renderLeague }) {
  const state = String(game?.state || '').toLowerCase()
  const isPre = state === 'pre'
  const isFinishedRace = state === 'post'
  const seriesName = String(renderLeague?.name || renderLeague?.id || 'Motorsport').trim()
  const title = racingCardTitle(game, renderLeague)

  const entryLimit = Number.isInteger(renderLeague?.entryLimit) ? renderLeague.entryLimit : null
  const allRacingEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
  const cappedEntries = entryLimit ? allRacingEntries.slice(0, entryLimit) : allRacingEntries
  const displayEntries = isSoloSlate ? cappedEntries : cappedEntries.slice(0, entryLimit ?? 6)

  const hasEntries = displayEntries.length > 0
  const showTV = renderLeague?.showTV !== false
  const tv = showTV && game?.racingTopInfo?.tv ? String(game.racingTopInfo.tv).replace(/^TV\s+/, '') : ''
  const showVenue = Boolean(renderLeague?.showStatVenue)

  // ── Pre-race: no entries → simple upcoming card ──────────────────────────────
  if (isPre && !hasEntries) {
    const venueParts = showVenue ? [game?.venue?.name, game?.venue?.city].filter(Boolean) : []
    const venueText = venueParts.join(' · ')
    const timeText = formatRuntimeDate(game) || String(game?.status?.shortDetail || '').trim()

    return (
      <div className="ticker-runtime-racing-pre">
        <div className="ticker-runtime-racing-pre-header">
          <span className="ticker-runtime-racing-series">{seriesName}</span>
          {tv ? <span className="ticker-runtime-racing-pre-tv">{tv}</span> : null}
        </div>
        <strong className="ticker-runtime-racing-pre-title">{title}</strong>
        <div className="ticker-runtime-racing-pre-footer">
          {venueText ? <span>{venueText}</span> : null}
          {timeText ? <span>{timeText}</span> : null}
        </div>
      </div>
    )
  }

  // ── Header bar shared by pre+grid, live, and post ────────────────────────────
  let statePill = null
  if (isPre && hasEntries) {
    statePill = <span className="ticker-runtime-racing-state-pill ticker-runtime-racing-state-pill-grid">GRID</span>
  } else if (game?.isLiveFeatured) {
    const liveLabel = racingHasTelemetry(displayEntries)
      ? racingLiveHeader(game)
      : racingTelemetryFallback(game, allRacingEntries)
    statePill = <span className="ticker-runtime-racing-state-pill ticker-runtime-racing-state-pill-live">{liveLabel}</span>
  } else if (isFinishedRace) {
    statePill = <span className="ticker-runtime-racing-state-pill ticker-runtime-racing-state-pill-final">FINAL</span>
  }

  // ── Driver box strip (pre+grid / live / post) ────────────────────────────────
  return (
    <>
      <div className="ticker-runtime-racing-bar">
        <div className="ticker-runtime-racing-bar-left">
          <span className="ticker-runtime-racing-series">{seriesName}</span>
          <div className="ticker-runtime-racing-bar-title-row">
            <strong className="ticker-runtime-racing-bar-title">{title}</strong>
            {game?.sessionLabel ? <span className="ticker-runtime-racing-session-label">{game.sessionLabel}</span> : null}
          </div>
        </div>
        <div className="ticker-runtime-racing-bar-right">
          {statePill}
          {tv ? <span className="ticker-runtime-racing-tv-pill">{tv}</span> : null}
        </div>
      </div>

      <div className="ticker-runtime-racing-strip">
        {displayEntries.map((entry, i) => (
          <DriverBox
            key={`${game.id}-box-${entry.id || i}`}
            entry={entry}
            index={i}
            gameId={game.id}
          />
        ))}
      </div>

      {game?.nextRace?.label ? (
        <div className="ticker-runtime-racing-next-bar">
          <span className="ticker-runtime-racing-next-label">Next</span>
          <span className="ticker-runtime-racing-next-text">
            {game.nextRace.label}{game.nextRace.dateText ? ` • ${game.nextRace.dateText}` : ''}
          </span>
        </div>
      ) : null}
    </>
  )
}
