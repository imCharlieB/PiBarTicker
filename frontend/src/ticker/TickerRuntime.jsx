import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import RacingCard from './RacingCard.jsx'
import BaseballCard from './BaseballCard.jsx'
import FootballCard from './FootballCard.jsx'
import BasketballCard from './BasketballCard.jsx'
import HockeyCard from './HockeyCard.jsx'
import GameCard from './GameCard.jsx'
import { sanitizeHexColor, hexToRgb, rgbaFromHex } from './cardHelpers.js'

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
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )

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
      trackRef.current.style.transform = `translateX(${boardWidth}px) translateZ(0)`
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
      track.style.transform = `translateX(${winW}px) translateZ(0)`
      currentSlotLeagueIdRef.current = displayLeague?.id || ''
      hasStartedRef.current = true
      startMarqueeAnimation()

      leagueSlotStartTimeRef.current = performance.now()
      slotDurationRef.current = dur
      scrolledThisSlotRef.current = 0
    }

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

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(id)
  }, [])

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
      track.style.transform = `translateX(${initial}px) translateZ(0)`
      track.style.willChange = 'transform'
    }

    const tick = (ts) => {
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
          liveTrack.style.transform = `translateX(${cleared}px) translateZ(0)`
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

      if (slotIsK1Ref.current && scrolledThisSlotRef.current >= oneCopy + 150) {
        triggerAdvance()
        return
      }
      if (!slotIsK1Ref.current && offset + W <= 0) {
        triggerAdvance()
        return
      }

      offsetRef.current = offset
      const liveTrack = trackRef.current
      if (liveTrack) {
        liveTrack.style.transform = `translateX(${offset}px) translateZ(0)`
      }

      if (leagueSlotStartTimeRef.current > 0) {
        const elapsed = (ts - leagueSlotStartTimeRef.current) / 1000
        const target = (slotDurationRef.current || 30000) / 1000
        if (elapsed >= target) {
          const cleared = minX - 700
          offsetRef.current = cleared
          const liveTrack2 = trackRef.current
          if (liveTrack2) {
            liveTrack2.style.transform = `translateX(${cleared}px) translateZ(0)`
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

  if (offsetRef.current === 0 || (offsetRef.current < 0 && !scrollReady)) {
    offsetRef.current = boardWidth
  }
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
              key={`marquee-${renderLeague?.id || 'none'}`}
              className={`ticker-runtime-track ${scrollReady ? 'ticker-runtime-track-animated' : ''}`}
              ref={trackRef}
              role="list"
              aria-label="Ticker games"
              style={{
                opacity: scrollReady ? 1 : 0,
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
              {currentTime}
            </div>
          </footer>
        </section>
      )}
    </main>
  )
}
