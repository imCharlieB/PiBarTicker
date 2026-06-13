import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './TickerRuntime.css'
import './TickerCards.css'
import WireframeCard, { BoardCard } from './WireframeCards.jsx'
import BaseballCard from './BaseballCard.jsx'
import GameCard from './GameCard.jsx'
import { sanitizeHexColor, rgbaFromHex, hexToRgb } from './cardHelpers.js'

// ── TickerRuntime-only helpers ───────────────────────────────────────────────

function cssToken(value, fallback = 'unknown') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return token || fallback
}

const WIREFRAME_STYLES = new Set(['slab', 'spine', 'digits', 'marquee'])
const DARK_BASE = '#0e1014'

function tintFor(hex, mode) {
  if (mode === 'neutral') {
    return { wash: 'linear-gradient(160deg,#1b1e25,#101218)', bar: '#39404c', dot: hex || '#5b6473', text: '#e9ebef' }
  }
  if (mode === 'accent') {
    return { wash: 'linear-gradient(160deg,#171a21,#0f1115)', bar: hex || '#5b6473', dot: hex || '#5b6473', text: '#f3f4f7' }
  }
  // full — team color drives wash
  const A = hexToRgb(hex), D = hexToRgb(DARK_BASE)
  const mix = (av, dv, k) => Math.round(av * k + dv * (1 - k))
  const m84 = A && D ? `rgb(${mix(A.r, D.r, 0.84)},${mix(A.g, D.g, 0.84)},${mix(A.b, D.b, 0.84)})` : DARK_BASE
  const m46 = A && D ? `rgb(${mix(A.r, D.r, 0.46)},${mix(A.g, D.g, 0.46)},${mix(A.b, D.b, 0.46)})` : DARK_BASE
  return { wash: `linear-gradient(160deg,${m84},${m46})`, bar: hex, dot: hex, text: '#ffffff' }
}

function cardColorVars(game) {
  const mode = game?.colorMode || 'full'
  const aHex = sanitizeHexColor(game?.teams?.away?.palette?.primary) || ''
  const hHex = sanitizeHexColor(game?.teams?.home?.palette?.primary) || ''
  const ta = tintFor(aHex, mode)
  const th = tintFor(hHex, mode)
  return {
    '--wash-a': ta.wash, '--wash-h': th.wash,
    '--bar-a': ta.bar,  '--bar-h': th.bar,
    '--dot-a': ta.dot,  '--dot-h': th.dot,
    '--txt-a': ta.text, '--txt-h': th.text,
    '--ca': aHex || '#5b6473', '--ch': hHex || '#5b6473',
  }
}

function runtimeCardStyle(game, useTeamCardColors = false) {
  const isWireframe = WIREFRAME_STYLES.has(game?.cardStyle) || game?.isRacing

  // Standard/large-logo team accent vars (used by TickerRuntime.css rules)
  let teamVars = null
  if (useTeamCardColors && !game?.isRacing) {
    const homePrimary = sanitizeHexColor(game?.teams?.home?.palette?.primary || game?.teams?.home?.color)
    if (homePrimary) {
      const rgb = hexToRgb(homePrimary)
      // Pre-compute color-mix so the GPU rasterizer never has to evaluate it per tile.
      const gradStart = rgb
        ? `rgb(${Math.round(0x0f * 0.72 + rgb.r * 0.28)},${Math.round(0x13 * 0.72 + rgb.g * 0.28)},${Math.round(0x20 * 0.72 + rgb.b * 0.28)})`
        : null
      teamVars = {
        '--card-accent': homePrimary,
        '--card-accent-soft': rgbaFromHex(homePrimary, 0.24),
        '--card-accent-glow': rgbaFromHex(homePrimary, 0.34),
        ...(gradStart ? { '--card-gradient-start': gradStart } : {}),
      }
    }
  }

  if (!isWireframe) return teamVars || undefined
  return { ...teamVars, ...cardColorVars(game) }
}

function resolveLeagueLogo(league, payload) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) return explicitLogo
  // NASCAR: use the real series logo captured during driver sync (injected per-game by backend)
  const seriesLogo = String(payload?.normalizedGames?.[0]?.seriesLogo || '').trim()
  if (seriesLogo) return seriesLogo.startsWith('http') ? seriesLogo : `/logos/${seriesLogo}`
  const payloadLogo = String(payload?.scoreboard?.leagues?.[0]?.logos?.[0]?.href || '').trim()
  if (payloadLogo) return payloadLogo
  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) return ''
  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
}

// Only used for standard / large-logo cardStyles — wireframe styles dispatch in MemoizedCard.
function pickCardComponent(game) {
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball') return BaseballCard
  return GameCard
}

function LeagueMark({ league, logo }) {
  const [err, setErr] = useState(false)
  useEffect(() => { setErr(false) }, [logo])
  if (logo && !err) return <img className="l3-logo" src={logo} alt={league} onError={() => setErr(true)} />
  if (league) return <span className="l3-badge">{league}</span>
  return null
}

function LowerThird() {
  const [now, setNow] = useState(() => new Date())
  const [cur, setCur] = useState({ league: '', logo: '' })
  const curRef = useRef(cur)
  curRef.current = cur

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let raf
    const tick = () => {
      const win = document.querySelector('.ticker-runtime-marquee-window')
      if (win) {
        const wr = win.getBoundingClientRect()
        const cx = wr.left + wr.width / 2
        let best = null, bestD = Infinity
        win.querySelectorAll('.ticker-runtime-card[data-league]').forEach(card => {
          const r = card.getBoundingClientRect()
          if (r.right < wr.left || r.left > wr.right) return
          const d = Math.abs((r.left + r.width / 2) - cx)
          if (d < bestD) { bestD = d; best = card }
        })
        if (best) {
          const league = best.getAttribute('data-league') || ''
          const logo = best.getAttribute('data-logo') || ''
          if (curRef.current.league !== league) setCur({ league, logo })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="ticker-runtime-lower l3-insert" aria-label="Lower third">
      <LeagueMark league={cur.league} logo={cur.logo} />
      <span className="l3-time">{time}</span>
    </div>
  )
}

// ── MemoizedCard — stable article wrapper ────────────────────────────────────
// Defined at module scope (not inside TickerRuntime) so React sees the same
// component type across renders. memo() prevents re-render when game data,
// isSoloSlate, and renderLeague haven't changed — keeping <img> DOM nodes alive
// so the browser never has to re-decode textures that are already in GPU memory.
const MemoizedCard = memo(function MemoizedCard({
  game, isSoloSlate, isDuoSlate, isFirstCardForMeasure,
  CardComponent, firstCardRef, renderLeague, leagueLogoUrl,
}) {
  const sportToken = cssToken(game?.sport, 'generic')
  const stateToken = cssToken(game?.state, 'unknown')
  const cardStyle = game?.cardStyle || 'standard'
  const isWireframe = WIREFRAME_STYLES.has(cardStyle)
  const colorMode = game?.colorMode || 'full'
  return (
    <article
      ref={isFirstCardForMeasure ? firstCardRef : null}
      className={[
        'ticker-runtime-card',
        `ticker-runtime-card-sport-${sportToken}`,
        `ticker-runtime-card-state-${stateToken}`,
        `ticker-runtime-card-style-${cardStyle}`,
        isSoloSlate ? 'ticker-runtime-card-solo' : '',
        isDuoSlate ? 'ticker-runtime-card-duo' : '',
        game?.isRacing ? 'ticker-runtime-card-racing' : '',
        game?.isRacing && isSoloSlate ? 'ticker-runtime-card-racing-solo' : '',
        game?.isLiveFeatured && !isWireframe ? `ticker-runtime-card-live ticker-runtime-card-live-${game.liveTheme || 'generic'}` : '',
        game?.useTeamCardColors && !isWireframe ? 'ticker-runtime-card-use-team-colors' : '',
        (isWireframe || game?.isRacing) ? `cm-${colorMode}` : '',
      ].filter(Boolean).join(' ')}
      style={runtimeCardStyle(game, game?.useTeamCardColors)}
      role="listitem"
      data-card-style={cardStyle}
      data-league={game?.leagueName || ''}
      data-logo={leagueLogoUrl || ''}
    >
      {game?.isLiveFeatured && !isWireframe ? (
        <p className="ticker-runtime-live-flag">LIVE</p>
      ) : null}
      {game?.isRacing ? (
        <BoardCard game={game} isSoloSlate={isSoloSlate} renderLeague={renderLeague} />
      ) : isWireframe ? (
        <WireframeCard game={game} />
      ) : (
        <CardComponent game={game} />
      )}
      {!isWireframe && !game?.isRacing ? (
        <p className="ticker-runtime-meta">{game.cardInfo}</p>
      ) : null}
    </article>
  )
})

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

      // Collect all image URLs from this game slate.
      // Images that finish decoding after the compositor layer's first rasterize
      // trigger a full GPU re-rasterize of every tile (the white flash).
      // Preloading with img.decode() ensures all textures are resident before reveal.
      const imageUrls = []
      for (const game of games) {
        if (game?._spacer) continue
        if (game?.isRacing) {
          for (const entry of (game.racingEntries ?? [])) {
            if (entry?.flag?.href) imageUrls.push(entry.flag.href)
          }
        } else {
          if (game?.teams?.home?.logo) imageUrls.push(game.teams.home.logo)
          if (game?.teams?.away?.logo) imageUrls.push(game.teams.away.logo)
        }
      }
      const uniqueUrls = [...new Set(imageUrls.filter(Boolean))]

      let shown = false
      const showTrack = () => {
        if (shown || !trackRef.current || currentSlotLeagueIdRef.current !== leagueId) return
        shown = true
        trackRef.current.style.opacity = '1'
        scrollReadyRef.current = true
      }

      if (uniqueUrls.length === 0) {
        showTrack()
        return
      }

      // Reveal once all images are decoded — fallback after 1500ms so the ticker
      // never hangs if a CDN image is slow or unreachable.
      const fallbackTimer = setTimeout(showTrack, 1500)
      Promise.all(
        uniqueUrls.map(url => {
          const img = new Image()
          img.src = url
          return img.decode ? img.decode().catch(() => {}) : new Promise(res => { img.onload = res; img.onerror = res })
        })
      ).then(() => { clearTimeout(fallbackTimer); showTrack() })
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
                const isFirstCardForMeasure = index === 0
                // Only needed for standard/large-logo paths; wireframe and racing dispatch internally.
                const CardComponent = (game?.isRacing || WIREFRAME_STYLES.has(game?.cardStyle))
                  ? null
                  : pickCardComponent(game)
                // Stable key without -${index}: prevents DOM destruction when array order changes.
                const cardKey = game.id || `${game?.teams?.away?.id || ''}-${game?.teams?.home?.id || ''}-${game?.startTimeUtc || ''}`

                return (
                  <MemoizedCard
                    key={cardKey}
                    game={game}
                    isSoloSlate={isSoloSlate}
                    isDuoSlate={isDuoSlate}
                    isFirstCardForMeasure={isFirstCardForMeasure}
                    CardComponent={CardComponent}
                    firstCardRef={firstCardRef}
                    renderLeague={renderLeague}
                    leagueLogoUrl={brandLogoUrl}
                  />
                )
              })}
            </div>
          </div>

          <LowerThird />
        </section>
      )}
    </main>
  )
}

export default memo(TickerRuntime)
