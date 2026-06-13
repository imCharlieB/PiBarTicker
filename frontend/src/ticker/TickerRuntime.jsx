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

function LowerThird({ clockFormat }) {
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

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: clockFormat !== '24h' })
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
  handoffGraceRef,
  scrolledThisSlotRef,
  leagueSlotStartTimeRef,
  currentSlotLeagueIdRef,
  onAdvance,
  onHandoffCheck,
}) {
  const [watermarkSize, setWatermarkSize] = useState('82%')
  const trackRef = useRef(null)
  const windowRef = useRef(null)
  const firstCardRef = useRef(null)
  const animRef = useRef(null)
  const backupTimerRef = useRef(null)

  const onAdvanceRef = useRef(onAdvance)
  useEffect(() => { onAdvanceRef.current = onAdvance }, [onAdvance])
  const onHandoffCheckRef = useRef(onHandoffCheck)
  useEffect(() => { onHandoffCheckRef.current = onHandoffCheck }, [onHandoffCheck])

  // ── Animation setup (synchronous pre-paint) ───────────────────────────────
  // WAA with literal pixel values — compositor thread, no CSS var() issue.
  // Stable track element (no key prop) + will-change: transform = compositor layer
  // survives across league changes; cancel + restart does NOT teardown the layer.
  //
  // Animation starts running immediately (track opacity:0). The image-preload effect
  // below simply sets opacity:1 once textures are decoded. This avoids pause/play
  // timing edge cases and keeps the code simple.
  useLayoutEffect(() => {
    if (animRef.current) { try { animRef.current.cancel() } catch (_) {} animRef.current = null }
    if (backupTimerRef.current) { clearTimeout(backupTimerRef.current); backupTimerRef.current = null }

    const track = trackRef.current
    if (!track) return
    track.style.opacity = '0'

    if (!displayLeague || !initialPreFetchesComplete || games.length === 0) {
      scrolledThisSlotRef.current = 0
      leagueSlotStartTimeRef.current = 0
      handoffGraceRef.current = Date.now() + 400
      setTimeout(() => onHandoffCheckRef.current(), 500)
      return
    }

    // No doubling — one clean pass through all cards right-to-left, then advance.
    // endX = -scrollWidth ensures every card fully exits the left edge before we advance.
    const totalWidth = track.scrollWidth
    if (totalWidth < 10) return

    const speed = sportsBoard?.scrollSpeed ?? 110
    const startX = boardWidth          // cards enter from right edge
    const endX = -totalWidth           // last card fully off left before advance
    const scrollDist = startX - endX   // boardWidth + totalWidth
    const dur = Math.max(3000, Math.round(scrollDist / speed * 1000))

    const cardGap = sportsBoard?.cardGap ?? 50
    track.style.setProperty('--ticker-card-gap', `${cardGap}px`)

    const leagueId = displayLeague.id
    currentSlotLeagueIdRef.current = leagueId
    leagueSlotStartTimeRef.current = performance.now()
    scrolledThisSlotRef.current = 0
    handoffGraceRef.current = Date.now() + 400

    const doAdvance = () => {
      if (currentSlotLeagueIdRef.current !== leagueId) return
      if (backupTimerRef.current) { clearTimeout(backupTimerRef.current); backupTimerRef.current = null }
      onAdvanceRef.current()
      handoffGraceRef.current = Date.now() + 800
      setTimeout(() => onHandoffCheckRef.current(), 900)
    }

    const anim = track.animate(
      [{ transform: `translateX(${startX}px)` }, { transform: `translateX(${endX}px)` }],
      { duration: dur, fill: 'forwards', easing: 'linear' }
    )
    animRef.current = anim
    anim.finished.then(doAdvance).catch(() => {})
    backupTimerRef.current = setTimeout(doAdvance, dur + 2000)

    setTimeout(() => onHandoffCheckRef.current(), 600)
  }, [displayLeague?.id, games.length, sessionKey, initialPreFetchesComplete, boardWidth, sportsBoard?.scrollSpeed, sportsBoard?.cardGap]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image preload + reveal ────────────────────────────────────────────────
  // Animation is already running; we just need to make the track visible once
  // all image textures are in GPU memory (prevents mid-animation decode flash).
  // 1500ms fallback so a slow/unreachable CDN never permanently hides the ticker.
  useEffect(() => {
    if (!displayLeague || !initialPreFetchesComplete || games.length === 0) return
    const leagueId = displayLeague.id
    let cancelled = false

    const revealTrack = () => {
      if (cancelled || currentSlotLeagueIdRef.current !== leagueId) return
      if (trackRef.current) trackRef.current.style.opacity = '1'
    }

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

    if (uniqueUrls.length === 0) { revealTrack(); return }

    const fallbackTimer = setTimeout(revealTrack, 1500)
    Promise.all(
      uniqueUrls.map(url => {
        const img = new Image()
        img.src = url
        return img.decode ? img.decode().catch(() => {}) : new Promise(r => { img.onload = r; img.onerror = r })
      })
    ).then(() => { clearTimeout(fallbackTimer); revealTrack() })

    return () => { cancelled = true; clearTimeout(fallbackTimer) }
  }, [displayLeague?.id, games.length, initialPreFetchesComplete]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watermark image size measurement ─────────────────────────────────────
  useEffect(() => {
    if (!watermarkUrl) { setWatermarkSize('82%'); return }
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

  const seamlessGames = games
  const hasEnabledLeagues = leagues.length > 0

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
                const CardComponent = (game?.isRacing || WIREFRAME_STYLES.has(game?.cardStyle))
                  ? null
                  : pickCardComponent(game)
                const copyIdx = index < games.length ? 0 : 1
                const cardKey = `${copyIdx}-${game.id || `${game?.teams?.away?.id || ''}-${game?.teams?.home?.id || ''}-${game?.startTimeUtc || ''}`}`

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

          <LowerThird clockFormat={config?.theme?.clockFormat ?? '12h'} />
        </section>
      )}
    </main>
  )
}

export default memo(TickerRuntime)
