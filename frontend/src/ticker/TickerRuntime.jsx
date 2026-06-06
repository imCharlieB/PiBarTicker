import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// ── Pure helpers (ticker-only, no React state) ──────────────────────────────

function sanitizeHexColor(value) {
  const token = String(value || '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(token)) return `#${token}`
  if (/^[0-9a-fA-F]{6}$/.test(token)) return `#${token}`
  return ''
}

function hexToRgb(hex) {
  const cleaned = sanitizeHexColor(hex).replace('#', '')
  if (!cleaned) return null
  const normalized = cleaned.length === 3
    ? cleaned.split('').map((c) => `${c}${c}`).join('')
    : cleaned
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return null
  return { r, g, b }
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : ''
}

function readableTextForColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#f5fbff'
  const luma = (0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b)
  return luma > 162 ? '#061018' : '#f5fbff'
}

function cssToken(value, fallback = 'unknown') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return token || fallback
}

function teamRecordText(team) {
  return String(team?.record || '').trim()
}

function runtimeTeamName(team) {
  if (!team) return 'TBD'
  return team.abbreviation || team.name || team.slug || 'TBD'
}

function teamRowStyle(team) {
  const primary = sanitizeHexColor(team?.palette?.primary || team?.color)
  if (!primary) return undefined
  const alternate = sanitizeHexColor(team?.palette?.alternate || team?.alternateColor)
  const textColor = readableTextForColor(primary)
  const base = rgbaFromHex(primary, 0.84)
  const blend = alternate ? rgbaFromHex(alternate, 0.74) : rgbaFromHex(primary, 0.62)
  return {
    '--team-row-bg': `linear-gradient(115deg, ${base}, ${blend})`,
    '--team-row-border': rgbaFromHex(primary, 0.6),
    '--team-row-text': textColor,
    '--team-row-score': textColor,
    '--team-row-glow': rgbaFromHex(primary, 0.48),
  }
}

function runtimeCardStyle(game, useTeamCardColors = false) {
  if (game?.isRacing || !useTeamCardColors) return undefined
  const homePrimary = sanitizeHexColor(game?.teams?.home?.palette?.primary || game?.teams?.home?.color)
  if (!homePrimary) return undefined
  return {
    '--card-accent': homePrimary,
    '--card-accent-soft': rgbaFromHex(homePrimary, 0.24),
    '--card-accent-glow': rgbaFromHex(homePrimary, 0.34),
  }
}

function racingCardTitle(game, league) {
  const explicitTitle = String(game?.title || '').trim()
  if (explicitTitle) {
    return explicitTitle
  }
  return String(league?.name || 'Race').trim()
}

function racingEntrySummary(entry) {
  const statItems = Array.isArray(entry?.stats) ? entry.stats : []
  const summary = statItems
    .slice(0, 2)
    .map((item) => {
      const label = String(item?.label || '').trim()
      const value = String(item?.value || '').trim()
      if (!value) return ''
      return label ? `${label} ${value}` : value
    })
    .filter(Boolean)
  if (summary.length) return summary.join(' • ')
  const score = String(entry?.score || '').trim()
  return score || ''
}

function racingHasTelemetry(entries) {
  if (!Array.isArray(entries) || !entries.length) return false
  return entries.some((entry) => {
    const score = String(entry?.score || '').trim()
    if (score) return true
    const statItems = Array.isArray(entry?.stats) ? entry.stats : []
    return statItems.some((item) => String(item?.value || '').trim())
  })
}

function racingTelemetryFallback(game, entries) {
  const parts = ['Running Order']
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) parts.push(`Lap ${lap}`)
  const leader = entries?.[0]
  const leaderName = String(leader?.shortName || leader?.name || '').trim()
  if (leaderName) parts.push(`Leader ${leaderName}`)
  return parts.join(' • ')
}

function racingLiveHeader(game) {
  const detail = String(game?.liveState?.detail || game?.status?.detail || game?.status?.shortDetail || '').trim()
  const lap = Number.isInteger(Number(game?.status?.period)) ? Number(game.status.period) : null
  if (lap && lap > 0) return detail ? `Lap ${lap} • ${detail}` : `Lap ${lap}`
  if (detail) return detail
  return 'Race in progress'
}

function resolveLeagueLogo(league, payload) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) return explicitLogo
  const payloadLogo = String(payload?.scoreboard?.leagues?.[0]?.logos?.[0]?.href || '').trim()
  if (payloadLogo) return payloadLogo
  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) return ''
  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
}

// ── TickerRuntime ────────────────────────────────────────────────────────────

export default function TickerRuntime({
  leagues,
  displayLeague,
  renderLeague,
  brandLeague,
  payloadByLeagueId,
  games,
  themeTokens,
  shellStyle,
  boardWidth,
  config,
  watermarkUrl,
  homeAssistantBoard,
  initialPreFetchesComplete,
  sportsBoard,
  sessionKey,
  // Shared refs (owned by App.jsx, read+written by both sides)
  handoffGraceRef,
  scrolledThisSlotRef,
  leagueSlotStartTimeRef,
  currentSlotLeagueIdRef,
  // Callbacks into App.jsx
  onAdvance,
  onHandoffCheck,
}) {
  // ── Internal state ──────────────────────────────────────────────────────
  const [scrollReady, setScrollReady] = useState(false)
  const [scrollSeconds, setScrollSeconds] = useState(45)
  const [trackWidth, setTrackWidth] = useState(0)
  const [windowWidth, setWindowWidth] = useState(0)
  const [watermarkSize, setWatermarkSize] = useState('82%')
  const [slotDuration, setSlotDuration] = useState(30000)

  // ── DOM refs ────────────────────────────────────────────────────────────
  const trackRef = useRef(null)
  const windowRef = useRef(null)
  const firstCardRef = useRef(null)

  // ── rAF / marquee refs ──────────────────────────────────────────────────
  const rafRef = useRef(null)
  const offsetRef = useRef(0)
  const lastTimeRef = useRef(0)
  const trackWidthRef = useRef(0)
  const windowWidthRef = useRef(0)
  const speedRef = useRef(110) // px per second

  // ── Slot-tracking refs ──────────────────────────────────────────────────
  const didInitialLateMeasureRef = useRef(false)
  const slotDurationRef = useRef(30000)
  const slotIsK1Ref = useRef(true)
  const hasStartedRef = useRef(false)

  // ── Stable callback refs ─────────────────────────────────────────────────
  const onAdvanceRef = useRef(onAdvance)
  useEffect(() => { onAdvanceRef.current = onAdvance }, [onAdvance])
  const onHandoffCheckRef = useRef(onHandoffCheck)
  useEffect(() => { onHandoffCheckRef.current = onHandoffCheck }, [onHandoffCheck])

  // ── Session reset: new ticker session or league-set change ──────────────
  useEffect(() => {
    didInitialLateMeasureRef.current = false
    setScrollReady(false)
    setTrackWidth(0)
    setWindowWidth(0)
    setSlotDuration(((sportsBoard?.rotateSeconds) || 30) * 1000)
    trackWidthRef.current = 0
    windowWidthRef.current = 0
    offsetRef.current = boardWidth
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop marquee on league change (cleanup) ─────────────────────────────
  useEffect(() => {
    if (!scrollReady) stopMarqueeAnimation()
    return () => stopMarqueeAnimation()
  }, [displayLeague?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── League-change reset (pre-paint, synchronous with React commit) ───────
  useLayoutEffect(() => {
    if (!displayLeague) return
    setScrollReady(false)
    hasStartedRef.current = false
    offsetRef.current = boardWidth
    windowWidthRef.current = boardWidth
    if (trackRef.current) {
      trackRef.current.style.setProperty('--marquee-offset', `${boardWidth}px`)
    }
    leagueSlotStartTimeRef.current = 0
    scrolledThisSlotRef.current = 0
    currentSlotLeagueIdRef.current = displayLeague.id
    handoffGraceRef.current = Date.now() + 400
    setTimeout(() => onHandoffCheckRef.current(), 500)
  }, [displayLeague?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Measurement: measure DOM, compute widths, start rAF scroller ─────────
  useEffect(() => {
    if (!displayLeague || games.length === 0) return
    // Guard: once started, ignore subsequent dep changes (e.g. fresh data arriving mid-scroll).
    if (hasStartedRef.current) return
    // During initial pre-fetch, only allow start once initialPreFetchesComplete flips to true
    // OR if we're already on the display league and it has data. The outer games.length===0 check
    // already gates on data arrival; no additional pre-fetch logic needed here.

    const runMeasure = () => {
      const track = trackRef.current
      if (!track) return
      const winW = boardWidth
      const k = games.length

      let cardW = 520
      if (k === 1 && firstCardRef.current) {
        const r = firstCardRef.current.getBoundingClientRect()
        if (r && r.width > 80) cardW = r.width
      }
      cardW = Math.max(cardW, 550)

      let oneCopy = winW
      if (k === 1) {
        oneCopy = winW + cardW + 100
      } else {
        if (track.scrollWidth > 100) oneCopy = track.scrollWidth
      }

      trackWidthRef.current = oneCopy
      windowWidthRef.current = winW
      setTrackWidth(oneCopy)
      setWindowWidth(winW)

      const pxPerSec = 110
      const secs = Math.max(10, Math.round((oneCopy / pxPerSec) * 10) / 10)
      setScrollSeconds(secs)
      setScrollReady(true)

      const baseDur = ((sportsBoard?.rotateSeconds) || 30) * 1000
      let dur = baseDur
      const exitMarginMs = 2000
      if (k <= 1) {
        const onePassMs = Math.round((oneCopy || winW) / pxPerSec * 1000)
        dur = Math.max(8000, onePassMs + exitMarginMs)
      } else {
        const fullExitMs = Math.round((winW + (oneCopy || winW)) / pxPerSec * 1000)
        dur = Math.max(baseDur, fullExitMs + exitMarginMs)
      }
      setSlotDuration(dur)
      slotIsK1Ref.current = (k <= 1)

      offsetRef.current = winW
      track.style.setProperty('--marquee-offset', `${winW}px`)
      currentSlotLeagueIdRef.current = displayLeague?.id || ''
      hasStartedRef.current = true
      startMarqueeAnimation()

      leagueSlotStartTimeRef.current = performance.now()
      slotDurationRef.current = dur
      scrolledThisSlotRef.current = 0
    }

    // Double rAF: lets complex multi-card content (many logos, NFL scores) settle before measuring.
    const raf1 = window.requestAnimationFrame(() => window.requestAnimationFrame(runMeasure))
    let tLate = null
    if (!didInitialLateMeasureRef.current) {
      didInitialLateMeasureRef.current = true
      tLate = window.setTimeout(() => {
        if (trackRef.current) runMeasure()
      }, 350)
    }
    return () => {
      cancelAnimationFrame(raf1)
      if (tLate) clearTimeout(tLate)
    }
  }, [displayLeague?.id, games.length, boardWidth, initialPreFetchesComplete]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watermark image size measurement ─────────────────────────────────────
  useEffect(() => {
    if (!watermarkUrl) {
      setWatermarkSize('82%')
      return
    }
    const img = new Image()
    img.onload = () => {
      const boardH = Number(config?.monitor?.height) || 380
      const targetHeight = boardH * 0.85
      let sizePercent = (targetHeight / img.naturalHeight) * 100
      sizePercent = Math.max(60, Math.min(95, sizePercent))
      setWatermarkSize(`${sizePercent.toFixed(0)}%`)
    }
    img.src = watermarkUrl
  }, [watermarkUrl, config?.monitor?.height])

  // ── Animation functions ───────────────────────────────────────────────────

  function stopMarqueeAnimation() {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastTimeRef.current = 0
  }

  function startMarqueeAnimation() {
    stopMarqueeAnimation()
    const W = trackWidthRef.current
    if (!W) return
    lastTimeRef.current = 0

    const track = trackRef.current
    if (track) {
      const initial = offsetRef.current || 0
      track.style.setProperty('--marquee-offset', `${initial}px`)
      track.style.willChange = 'transform'
    }

    const tick = (ts) => {
      // Abort any rAF callback belonging to a previous league's slot. The currentSlotLeagueIdRef
      // is updated by the layout effect to the new league's id; the old tick's closed-over
      // displayLeague?.id still holds the previous id, so the mismatch is detected here.
      if (currentSlotLeagueIdRef.current && displayLeague?.id &&
          currentSlotLeagueIdRef.current !== displayLeague.id) {
        return
      }
      if (!lastTimeRef.current) lastTimeRef.current = ts
      const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = ts

      let offset = offsetRef.current - speedRef.current * dt
      const startX = windowWidthRef.current || 0
      const minX = -(W + startX)

      if (leagueSlotStartTimeRef.current > 0) {
        scrolledThisSlotRef.current += speedRef.current * dt
      }

      const oneCopy = W

      const triggerAdvance = () => {
        const cleared = minX - 800
        offsetRef.current = cleared
        const liveTrack = trackRef.current
        if (liveTrack) {
          liveTrack.style.setProperty('--marquee-offset', `${cleared}px`)
          liveTrack.style.opacity = '0'
        }
        stopMarqueeAnimation()
        setScrollReady(false)
        setTimeout(() => {
          onAdvanceRef.current()
          scrolledThisSlotRef.current = 0
          leagueSlotStartTimeRef.current = 0
          currentSlotLeagueIdRef.current = ''
          handoffGraceRef.current = Date.now() + 800
          setTimeout(() => onHandoffCheckRef.current(), 900)
        }, 100)
      }

      // k=1: distance-based advance — card must scroll oneCopy+150 to fully clear left edge.
      if (slotIsK1Ref.current && scrolledThisSlotRef.current >= oneCopy + 150) {
        triggerAdvance()
        return
      }
      // k>1: position-based advance — last card right edge has crossed screen-left 0.
      if (!slotIsK1Ref.current && offset + W <= 0) {
        triggerAdvance()
        return
      }

      offsetRef.current = offset
      const liveTrack = trackRef.current
      if (liveTrack) {
        liveTrack.style.setProperty('--marquee-offset', `${offset}px`)
      }

      // Time backup — fires if rAF-position advance didn't fire within the expected slot time.
      if (leagueSlotStartTimeRef.current > 0) {
        const elapsed = (ts - leagueSlotStartTimeRef.current) / 1000
        const target = (slotDurationRef.current || 30000) / 1000
        if (elapsed >= target) {
          const cleared = minX - 700
          offsetRef.current = cleared
          const liveTrack2 = trackRef.current
          if (liveTrack2) {
            liveTrack2.style.setProperty('--marquee-offset', `${cleared}px`)
            liveTrack2.style.opacity = '0'
          }
          stopMarqueeAnimation()
          setScrollReady(false)
          setTimeout(() => {
            onAdvanceRef.current()
            scrolledThisSlotRef.current = 0
            leagueSlotStartTimeRef.current = 0
            currentSlotLeagueIdRef.current = ''
            handoffGraceRef.current = Date.now() + 800
          }, 100)
          return
        }
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const seamlessGames = games.length > 0 ? [...games] : games
  const hasEnabledLeagues = leagues.length > 0
  const boardHeight = Math.max(120, Number(config?.monitor?.height) || 380)

  // Prime offset ref so the track's first paint positions content off-screen right.
  if (offsetRef.current === 0 || (offsetRef.current < 0 && !scrollReady)) {
    offsetRef.current = boardWidth
  }
  if (!windowWidthRef.current) {
    windowWidthRef.current = boardWidth
  }

  // Watermark background positions (sparse elegant pattern).
  let watermarkPositions = 'center'
  let watermarkImages = 'none'
  if (watermarkUrl) {
    const url = `url(${watermarkUrl})`
    if (boardWidth > 3000) {
      watermarkPositions = '8% center, 30% center, 70% center, 92% center'
      watermarkImages = `${url}, ${url}, ${url}, ${url}`
    } else if (boardWidth > 1800) {
      watermarkPositions = '12% center, 88% center'
      watermarkImages = `${url}, ${url}`
    } else {
      watermarkPositions = '15% center, 85% center'
      watermarkImages = `${url}, ${url}`
    }
  }

  return (
    <main className={`ticker-runtime-shell ${themeTokens.modeClass}`} style={{ ...shellStyle, '--ticker-watermark-size': watermarkSize }}>
      {!hasEnabledLeagues ? (
        <p className="ticker-runtime-empty">Enable at least one league.</p>
      ) : (
        <section
          className="ticker-runtime-board"
          style={{
            width: '100%',
            maxWidth: `${boardWidth}px`,
            height: '100%',
            '--ticker-watermark-images': watermarkImages,
            '--ticker-watermark-positions': watermarkPositions,
          }}
        >
          <div className="ticker-runtime-marquee-window" ref={windowRef}>
            <div
              key={`marquee-${renderLeague?.id || 'none'}`}
              className={`ticker-runtime-track ${scrollReady ? 'ticker-runtime-track-animated' : ''}`}
              ref={trackRef}
              role="list"
              aria-label="Ticker games"
              style={{
                '--marquee-offset': `${offsetRef.current || boardWidth}px`,
                opacity: scrollReady ? 1 : 0,
                ...(scrollReady ? {
                  '--runtime-scroll-seconds': `${scrollSeconds}s`,
                  '--runtime-track-width': `${Math.max(1, trackWidth)}px`,
                  '--runtime-window-width': `${Math.max(1, windowWidth)}px`,
                } : {}),
              }}
            >
              {seamlessGames.map((item, index) => {
                if (item && item._spacer) {
                  return (
                    <div
                      key={`spacer-${index}`}
                      style={{ width: `${item.width}px`, flexShrink: 0, height: '100%' }}
                      aria-hidden="true"
                    />
                  )
                }
                const game = item
                const isSoloSlate = games.length === 1
                const isDuoSlate = games.length === 2
                const isFinishedRace = game?.isRacing && String(game?.state || '').toLowerCase() === 'post'
                const sportToken = cssToken(game?.sport, 'generic')
                const stateToken = cssToken(game?.state, 'unknown')
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
                const allRacingEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
                const hasLiveRacingTelemetry = racingHasTelemetry(allRacingEntries)
                const podiumEntries = isFinishedRace && isSoloSlate ? allRacingEntries.slice(0, 3) : []
                const racingEntries = isFinishedRace && isSoloSlate
                  ? allRacingEntries.slice(3, 15)
                  : allRacingEntries.slice(0, isSoloSlate ? 16 : 6)
                const isFirstCardForMeasure = !item._spacer && index === 0

                return (
                  <article
                    key={`${game.id || `${away?.id}-${home?.id}-${game?.startTimeUtc || ''}`}-${index}`}
                    ref={isFirstCardForMeasure ? firstCardRef : null}
                    className={`ticker-runtime-card ticker-runtime-card-sport-${sportToken} ticker-runtime-card-state-${stateToken} ticker-runtime-card-style-${game.cardStyle || 'standard'}${isSoloSlate ? ' ticker-runtime-card-solo' : ''}${isDuoSlate ? ' ticker-runtime-card-duo' : ''}${game?.isRacing ? ' ticker-runtime-card-racing' : ''}${game?.isRacing && isSoloSlate ? ' ticker-runtime-card-racing-solo' : ''}${game?.isLiveFeatured ? ` ticker-runtime-card-live ticker-runtime-card-live-${game.liveTheme || 'generic'}` : ''}${game?.useTeamCardColors ? ' ticker-runtime-card-use-team-colors' : ''}`}
                    style={runtimeCardStyle(game, game?.useTeamCardColors)}
                    role="listitem"
                    data-card-style={game.cardStyle || 'standard'}
                  >
                    {game?.isLiveFeatured ? (
                      <p className="ticker-runtime-live-flag">LIVE</p>
                    ) : null}

                    {game?.isRacing ? (
                      <>
                        <div className="ticker-runtime-racing-head">
                          <div className="ticker-runtime-racing-head-main">
                            <span className="ticker-runtime-racing-series">MOTORSPORT</span>
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
                              <div key={`${game.id}-podium-${entry.id || entry.position || entry.name}`} className="ticker-runtime-racing-podium-item">
                                <span className="ticker-runtime-racing-podium-rank">P{entry.position || '-'}</span>
                                <span className="ticker-runtime-racing-podium-name">{entry.shortName || entry.name || 'Driver'}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className={`ticker-runtime-racing-leaders${isSoloSlate ? ' ticker-runtime-racing-leaders-solo' : ''}${game?.isLiveFeatured ? ' ticker-runtime-racing-leaders-live' : ''}${isFinishedRace && isSoloSlate ? ' ticker-runtime-racing-leaders-finished' : ''}`}>
                          {racingEntries.map((entry) => (
                            <div key={`${game.id}-${entry.id || entry.position || entry.name}`} className="ticker-runtime-racing-driver-row">
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
                            <span className="ticker-runtime-racing-next-text">{game.nextRace.label}{game.nextRace.dateText ? ` • ${game.nextRace.dateText}` : ''}</span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      game.cardStyle === 'large-logo' ? (
                        <div className="ticker-runtime-ll">
                          {String(game?.state || '').toLowerCase() === 'in' && game.baseballLiveData ? (
                            <div className="ll-live">
                              <div className="ll-logos">
                                <div className="ll-logo ll-away">
                                  {awayLogo ? (
                                    <img src={awayLogo} alt={runtimeTeamName(away)} />
                                  ) : (
                                    <span className="ll-badge">{awayBadge}</span>
                                  )}
                                </div>
                                <div className="ll-logo ll-home">
                                  {homeLogo ? (
                                    <img src={homeLogo} alt={runtimeTeamName(home)} />
                                  ) : (
                                    <span className="ll-badge">{homeBadge}</span>
                                  )}
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
                                  <div className="ll-infield"></div>
                                  <div className="base" id="second-base"></div>
                                  <div className="base" id="first-base"></div>
                                  <div className="base" id="third-base"></div>
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
                          ) : String(game?.state || '').toLowerCase() === 'post' ? (
                            <div className="ll-final">
                              <div className="ll-final-top">FINAL</div>
                              <div className="ll-final-logos">
                                <div className="ll-final-logo">
                                  {awayLogo ? (
                                    <img src={awayLogo} alt={runtimeTeamName(away)} />
                                  ) : (
                                    <span className="ll-badge ll-big">{awayBadge}</span>
                                  )}
                                </div>
                                <div className="ll-final-logo">
                                  {homeLogo ? (
                                    <img src={homeLogo} alt={runtimeTeamName(home)} />
                                  ) : (
                                    <span className="ll-badge ll-big">{homeBadge}</span>
                                  )}
                                </div>
                              </div>
                              <div className="ll-final-score-bottom">
                                {away?.score ?? '-'} — {home?.score ?? '-'}
                              </div>
                            </div>
                          ) : (
                            <div className="ll-scheduled">
                              <div className="ll-sched-logos">
                                <div className="ll-logo ll-away ll-sched-logo">
                                  {awayLogo ? (
                                    <img src={awayLogo} alt={runtimeTeamName(away)} />
                                  ) : (
                                    <span className="ll-badge">{awayBadge}</span>
                                  )}
                                </div>
                                <div className="ll-sched-vs">VS</div>
                                <div className="ll-logo ll-home ll-sched-logo">
                                  {homeLogo ? (
                                    <img src={homeLogo} alt={runtimeTeamName(home)} />
                                  ) : (
                                    <span className="ll-badge">{homeBadge}</span>
                                  )}
                                </div>
                              </div>
                              <div className="ll-sched-time">
                                {game.runtimeDateText || 'TBD'}
                              </div>
                              {game?.status?.detail && !/scheduled|pre/i.test(String(game.status.detail)) ? (
                                <div className="ll-sched-detail">{game.status.detail}</div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="ticker-runtime-row ticker-runtime-row-away" style={game?.useTeamCardColors ? teamRowStyle(away) : undefined}>
                            <div className="ticker-runtime-team">
                              {awayLogo ? (
                                <img src={awayLogo} alt={runtimeTeamName(away)} />
                              ) : (
                                <span className="ticker-runtime-team-mark" aria-hidden="true">{awayBadge}</span>
                              )}
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
                              {homeLogo ? (
                                <img src={homeLogo} alt={runtimeTeamName(home)} />
                              ) : (
                                <span className="ticker-runtime-team-mark" aria-hidden="true">{homeBadge}</span>
                              )}
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
                                <p key={`${game.id || index}-${item.label}`} className="ticker-runtime-stat-item">
                                  <span>{item.label}</span>
                                  <strong>{item.value}</strong>
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )
                    )}

                    <p className="ticker-runtime-meta">{game.cardInfo}</p>
                  </article>
                )
              })}
            </div>
          </div>

          <footer className="ticker-runtime-lower" aria-label="Lower third">
            <div className="ticker-runtime-lower-brand">
              {resolveLeagueLogo(brandLeague, payloadByLeagueId[brandLeague?.id]) ? (
                <img
                  src={resolveLeagueLogo(brandLeague, payloadByLeagueId[brandLeague?.id])}
                  alt={brandLeague?.name || 'Ticker'}
                />
              ) : (
                brandLeague?.name || 'Ticker'
              )}
            </div>
            <div className="ticker-runtime-lower-scroll">
              <div className="ticker-runtime-lower-item">
                {(homeAssistantBoard?.haSensors || []).length
                  ? homeAssistantBoard.haSensors.slice(0, 6).join('  •  ')
                  : 'Home Assistant sensors not configured'}
              </div>
            </div>
          </footer>
        </section>
      )}
    </main>
  )
}
