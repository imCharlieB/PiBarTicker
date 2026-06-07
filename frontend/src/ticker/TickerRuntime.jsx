import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './TickerRuntime.css'
import RacingCard from './RacingCard.jsx'
import BaseballCard from './BaseballCard.jsx'
import FootballCard from './FootballCard.jsx'
import BasketballCard from './BasketballCard.jsx'
import HockeyCard from './HockeyCard.jsx'
import GameCard from './GameCard.jsx'
import { sanitizeHexColor, rgbaFromHex } from './cardHelpers.js'

// ── TickerRuntime-only helpers ───────────────────────────────────────────────

function cssToken(value, fallback = 'unknown') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return token || fallback
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

function resolveLeagueLogo(league, payload) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) return explicitLogo
  const payloadLogo = String(payload?.scoreboard?.leagues?.[0]?.logos?.[0]?.href || '').trim()
  if (payloadLogo) return payloadLogo
  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) return ''
  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
}

function pickCardComponent(game) {
  if (game?.isRacing) return null // handled separately (needs extra props)
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball') return BaseballCard
  if (sport === 'football') return FootballCard
  if (sport === 'basketball') return BasketballCard
  if (sport === 'hockey') return HockeyCard
  return GameCard
}

function LiveClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return <>{time}</>
}

// ── TickerRuntime ────────────────────────────────────────────────────────────

function TickerRuntime({
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
  // Only watermarkSize needs to be React state (it drives a CSS var on the shell).
  // Everything else that used to be state is now a ref — no re-renders during animation.
  const [watermarkSize, setWatermarkSize] = useState('82%')
  // ── DOM refs ────────────────────────────────────────────────────────────
  const trackRef = useRef(null)
  const windowRef = useRef(null)
  const firstCardRef = useRef(null)

  // ── Animation refs ──────────────────────────────────────────────────────
  // Web Animation object — holds the running element.animate() instance.
  // element.animate() runs on the GPU compositor thread with no per-frame JS.
  const animRef = useRef(null)
  const advanceTimerRef = useRef(null) // backup setTimeout in case onfinish doesn't fire
  const trackWidthRef = useRef(0)
  const windowWidthRef = useRef(0)
  // scrollReadyRef: track visibility driven by direct DOM writes — no React state, no re-renders
  const scrollReadyRef = useRef(false)

  // ── Slot-tracking refs ──────────────────────────────────────────────────
  const didInitialLateMeasureRef = useRef(false)
  const slotDurationRef = useRef(30000)
  const hasStartedRef = useRef(false)

  // ── Stable callback refs ─────────────────────────────────────────────────
  const onAdvanceRef = useRef(onAdvance)
  useEffect(() => { onAdvanceRef.current = onAdvance }, [onAdvance])
  const onHandoffCheckRef = useRef(onHandoffCheck)
  useEffect(() => { onHandoffCheckRef.current = onHandoffCheck }, [onHandoffCheck])

  // ── Animation functions ───────────────────────────────────────────────────

  function stopCSSAnimation() {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
    if (animRef.current) {
      try { animRef.current.cancel() } catch (_) {}
      animRef.current = null
    }
  }

  // Called when the animation ends (by onfinish or backup timer).
  // expectedLeagueId guards against stale closures from a prior slot.
  function triggerAdvance(expectedLeagueId, oneCopy) {
    if (currentSlotLeagueIdRef.current !== expectedLeagueId) return
    const liveTrack = trackRef.current
    if (liveTrack) liveTrack.style.opacity = '0'
    stopCSSAnimation()
    scrolledThisSlotRef.current = oneCopy
    scrollReadyRef.current = false
    setTimeout(() => {
      onAdvanceRef.current()
      scrolledThisSlotRef.current = 0
      leagueSlotStartTimeRef.current = 0
      currentSlotLeagueIdRef.current = ''
      handoffGraceRef.current = Date.now() + 800
      setTimeout(() => onHandoffCheckRef.current(), 900)
    }, 100)
  }

  // Start a compositor-threaded animation via element.animate().
  // JS only touches the DOM once here; all per-frame movement is GPU-side.
  function startCSSAnimation(track, winW, scrollEndPx, dur, oneCopy, leagueId) {
    stopCSSAnimation()

    const anim = track.animate([
      { transform: `translateX(${winW}px) translateZ(0)` },
      { transform: `translateX(${scrollEndPx}px) translateZ(0)` },
    ], {
      duration: dur,
      easing: 'linear',
      fill: 'forwards', // hold end position until we cancel
    })
    animRef.current = anim

    anim.onfinish = () => {
      // Commit end position to base style so cancel() in triggerAdvance
      // doesn't snap the track back to its start position.
      track.style.transform = `translateX(${scrollEndPx}px) translateZ(0)`
      triggerAdvance(leagueId, oneCopy)
    }

    // Backup: if onfinish doesn't fire (tab hidden, suspended, etc.) force advance
    advanceTimerRef.current = setTimeout(() => {
      track.style.transform = `translateX(${scrollEndPx}px) translateZ(0)`
      triggerAdvance(leagueId, oneCopy)
    }, dur + 800)
  }

  // ── Session reset: new ticker session or league-set change ──────────────
  useEffect(() => {
    didInitialLateMeasureRef.current = false
    scrollReadyRef.current = false
    stopCSSAnimation()
    trackWidthRef.current = 0
    windowWidthRef.current = 0
    slotDurationRef.current = ((sportsBoard?.rotateSeconds) || 30) * 1000
    if (trackRef.current) trackRef.current.style.opacity = '0'
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop animation on league change (cleanup) ───────────────────────────
  useEffect(() => {
    if (!scrollReadyRef.current) stopCSSAnimation()
    return () => {
      // Set opacity 0 before cancelling so the position snap from cancel()
      // is never visible — mirrors what triggerAdvance does.
      if (trackRef.current) trackRef.current.style.opacity = '0'
      stopCSSAnimation()
    }
  }, [displayLeague?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── League-change reset (pre-paint, synchronous with React commit) ───────
  useLayoutEffect(() => {
    if (!displayLeague) return
    stopCSSAnimation()
    scrollReadyRef.current = false
    hasStartedRef.current = false
    windowWidthRef.current = boardWidth
    if (trackRef.current) {
      trackRef.current.style.opacity = '0'
      trackRef.current.style.transform = `translateX(${boardWidth}px) translateZ(0)`
    }
    leagueSlotStartTimeRef.current = 0
    scrolledThisSlotRef.current = 0
    currentSlotLeagueIdRef.current = displayLeague.id
    handoffGraceRef.current = Date.now() + 400
    setTimeout(() => onHandoffCheckRef.current(), 500)
  }, [displayLeague?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Measurement: measure DOM, compute widths, start animation ────────────
  useEffect(() => {
    if (!displayLeague || games.length === 0) return
    if (hasStartedRef.current) return

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

      const pxPerSec = 110
      const baseDur = ((sportsBoard?.rotateSeconds) || 30) * 1000

      // Compute end position and duration to match exact advance conditions:
      //   k=1:  advance when scrolled >= oneCopy + 150 (card fully off left)
      //   k>1:  advance when offset + oneCopy <= 0     (track fully off left)
      let scrollEndPx, dur
      if (k <= 1) {
        const scrollDist = oneCopy + 150
        scrollEndPx = winW - scrollDist
        dur = Math.max(8000, Math.round(scrollDist / pxPerSec * 1000))
      } else {
        scrollEndPx = -oneCopy
        const scrollDist = winW + oneCopy
        dur = Math.max(baseDur, Math.round(scrollDist / pxPerSec * 1000) + 2000)
      }

      const leagueId = displayLeague?.id || ''
      currentSlotLeagueIdRef.current = leagueId
      hasStartedRef.current = true

      leagueSlotStartTimeRef.current = performance.now()
      slotDurationRef.current = dur
      scrolledThisSlotRef.current = 0

      // Start GPU compositor animation — no per-frame JS from here
      startCSSAnimation(track, winW, scrollEndPx, dur, oneCopy, leagueId)

      track.style.opacity = '1'
      scrollReadyRef.current = true
    }

    const raf1 = window.requestAnimationFrame(() => window.requestAnimationFrame(runMeasure))
    let tLate = null
    if (!didInitialLateMeasureRef.current) {
      didInitialLateMeasureRef.current = true
      // Fallback: only fires if the double-rAF didn't complete measurement in time.
      // Guard with hasStartedRef so we never cancel a running animation.
      tLate = window.setTimeout(() => {
        if (trackRef.current && !hasStartedRef.current) runMeasure()
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

  // ── Render ────────────────────────────────────────────────────────────────

  const seamlessGames = games.length > 0 ? [...games] : games
  const hasEnabledLeagues = leagues.length > 0

  if (!windowWidthRef.current) {
    windowWidthRef.current = boardWidth
  }

  const brandLogoUrl = resolveLeagueLogo(brandLeague, payloadByLeagueId[brandLeague?.id])

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
              key={`marquee-${displayLeague?.id || 'none'}`}
              className="ticker-runtime-track"
              ref={trackRef}
              role="list"
              aria-label="Ticker games"
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
                const sportToken = cssToken(game?.sport, 'generic')
                const stateToken = cssToken(game?.state, 'unknown')
                const isFirstCardForMeasure = !item._spacer && index === 0

                const CardComponent = pickCardComponent(game)

                return (
                  <article
                    key={`${game.id || `${game?.teams?.away?.id}-${game?.teams?.home?.id}-${game?.startTimeUtc || ''}`}-${index}`}
                    ref={isFirstCardForMeasure ? firstCardRef : null}
                    className={[
                      'ticker-runtime-card',
                      `ticker-runtime-card-sport-${sportToken}`,
                      `ticker-runtime-card-state-${stateToken}`,
                      `ticker-runtime-card-style-${game.cardStyle || 'standard'}`,
                      isSoloSlate ? 'ticker-runtime-card-solo' : '',
                      isDuoSlate ? 'ticker-runtime-card-duo' : '',
                      game?.isRacing ? 'ticker-runtime-card-racing' : '',
                      game?.isRacing && isSoloSlate ? 'ticker-runtime-card-racing-solo' : '',
                      game?.isLiveFeatured ? `ticker-runtime-card-live ticker-runtime-card-live-${game.liveTheme || 'generic'}` : '',
                      game?.useTeamCardColors ? 'ticker-runtime-card-use-team-colors' : '',
                    ].filter(Boolean).join(' ')}
                    style={runtimeCardStyle(game, game?.useTeamCardColors)}
                    role="listitem"
                    data-card-style={game.cardStyle || 'standard'}
                  >
                    {game?.isLiveFeatured ? (
                      <p className="ticker-runtime-live-flag">LIVE</p>
                    ) : null}

                    {game?.isRacing ? (
                      <RacingCard game={game} isSoloSlate={isSoloSlate} renderLeague={renderLeague} />
                    ) : (
                      <CardComponent game={game} />
                    )}

                    <p className="ticker-runtime-meta">{game.cardInfo}</p>
                  </article>
                )
              })}
            </div>
          </div>

          <footer className="ticker-runtime-lower">
            <div className="ticker-runtime-lower-brand">
              {brandLogoUrl ? (
                <img src={brandLogoUrl} alt={brandLeague?.name || 'Ticker'} />
              ) : (
                <span className="ticker-runtime-lower-brand-fallback">{brandLeague?.name || ''}</span>
              )}
            </div>
            <div className="ticker-runtime-lower-clock">
              <LiveClock />
            </div>
          </footer>
        </section>
      )}
    </main>
  )
}

export default memo(TickerRuntime)
