import {
  formatRuntimeDate,
  racingCardTitle,
  racingEntrySummary,
  racingHasTelemetry,
  racingLiveHeader,
  racingTelemetryFallback,
} from './cardHelpers.js'

export default function RacingCard({ game, isSoloSlate, renderLeague }) {
  const state = String(game?.state || '').toLowerCase()
  const isPre = state === 'pre'
  const isFinishedRace = state === 'post'
  const seriesName = String(renderLeague?.name || renderLeague?.id || 'Motorsport').trim()

  const entryLimit = Number.isInteger(renderLeague?.entryLimit) ? renderLeague.entryLimit : null
  const allRacingEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
  const cappedEntries = entryLimit ? allRacingEntries.slice(0, entryLimit) : allRacingEntries

  if (isPre) {
    const title = racingCardTitle(game, renderLeague)
    const venueParts = [game?.venue?.name, game?.venue?.city].filter(Boolean)
    const venueText = venueParts.join(' · ')
    const timeText = formatRuntimeDate(game) || String(game?.status?.shortDetail || '').trim()
    const showTV = renderLeague?.showTV !== false
    const tv = showTV && game?.broadcasts?.[0] ? String(game.broadcasts[0]).replace(/^TV\s+/, '') : ''
    const preEntryCount = isSoloSlate ? (entryLimit ?? 14) : (entryLimit ?? 4)
    const preEntries = cappedEntries.slice(0, preEntryCount)

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
        {preEntries.length > 0 ? (
          <>
            <div className="ticker-runtime-divider" />
            <div className={[
              'ticker-runtime-racing-leaders',
              isSoloSlate ? 'ticker-runtime-racing-leaders-solo' : '',
            ].filter(Boolean).join(' ')}>
              {preEntries.map((entry, i) => (
                <div
                  key={`${game.id}-pre-${entry.id || i}`}
                  className="ticker-runtime-racing-driver-row"
                >
                  <span className="ticker-runtime-racing-position">{entry.position ?? (i + 1)}</span>
                  <span className="ticker-runtime-racing-driver-block">
                    <span className="ticker-runtime-racing-driver">
                      {entry?.flag?.href ? (
                        <img src={entry.flag.href} alt={entry.flag.alt || entry.name || 'Flag'} />
                      ) : null}
                      <span>{entry.shortName || entry.name || 'Driver'}</span>
                    </span>
                  </span>
                  <span className="ticker-runtime-racing-status" />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  const hasLiveRacingTelemetry = racingHasTelemetry(cappedEntries)
  const podiumEntries = isFinishedRace && isSoloSlate ? cappedEntries.slice(0, 3) : []
  const racingEntries = isFinishedRace && isSoloSlate
    ? cappedEntries.slice(3, 15)
    : cappedEntries.slice(0, isSoloSlate ? 16 : 6)

  return (
    <>
      <div className="ticker-runtime-racing-head">
        <div className="ticker-runtime-racing-head-main">
          <span className="ticker-runtime-racing-series">{seriesName}</span>
          <strong className="ticker-runtime-racing-title">{racingCardTitle(game, renderLeague)}</strong>
        </div>
        {game?.racingTopInfo?.tv ? (
          <div className="ticker-runtime-racing-head-side" aria-label="Race schedule and TV">
            <p className="ticker-runtime-racing-head-line ticker-runtime-racing-head-tv">
              <span>TV</span>
              <strong>{String(game.racingTopInfo.tv).replace(/^TV\s+/, '')}</strong>
            </p>
          </div>
        ) : null}
      </div>

      <div className="ticker-runtime-divider" />

      {game?.isLiveFeatured && game?.showLiveState ? (
        <div className="ticker-runtime-racing-live-bar">{racingLiveHeader(game)}</div>
      ) : null}

      {game?.isLiveFeatured && !hasLiveRacingTelemetry ? (
        <div className="ticker-runtime-racing-telemetry-fallback">
          {racingTelemetryFallback(game, allRacingEntries)}
        </div>
      ) : null}

      {podiumEntries.length ? (
        <div className="ticker-runtime-racing-podium" aria-label="Race podium">
          {podiumEntries.map((entry) => (
            <div
              key={`${game.id}-podium-${entry.id || entry.position || entry.name}`}
              className="ticker-runtime-racing-podium-item"
            >
              <span className="ticker-runtime-racing-podium-rank">P{entry.position || '-'}</span>
              <span className="ticker-runtime-racing-podium-name">{entry.shortName || entry.name || 'Driver'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className={[
        'ticker-runtime-racing-leaders',
        isSoloSlate ? 'ticker-runtime-racing-leaders-solo' : '',
        game?.isLiveFeatured ? 'ticker-runtime-racing-leaders-live' : '',
        isFinishedRace && isSoloSlate ? 'ticker-runtime-racing-leaders-finished' : '',
      ].filter(Boolean).join(' ')}>
        {racingEntries.map((entry) => (
          <div
            key={`${game.id}-${entry.id || entry.position || entry.name}`}
            className="ticker-runtime-racing-driver-row"
          >
            <span className="ticker-runtime-racing-position">P{entry.position || '-'}</span>
            <span className="ticker-runtime-racing-driver-block">
              <span className="ticker-runtime-racing-driver">
                {entry?.flag?.href ? (
                  <img src={entry.flag.href} alt={entry.flag.alt || entry.name || 'Flag'} />
                ) : null}
                <span>{entry.shortName || entry.name || 'Driver'}</span>
              </span>
              {game?.isLiveFeatured && racingEntrySummary(entry) ? (
                <span className="ticker-runtime-racing-detail">{racingEntrySummary(entry)}</span>
              ) : null}
            </span>
            <span className="ticker-runtime-racing-status">{entry.winner ? 'WIN' : ''}</span>
          </div>
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
