import { Fragment, useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
  densityFlags,
  formatRuntimeStatus,
  racingCardTitle,
  racingEntrySummary,
  racingLiveHeader,
  formatRuntimeDate,
  FIELD_INSET_PCT,
  FIELD_SPAN_PCT,
} from './cardHelpers.js'

// Yard markers along the playing field, labeled the way a broadcast field is: counting up
// from each goal line to midfield. Position mirrors the FIELD_INSET_PCT/FIELD_SPAN_PCT
// mapping cardHelpers.js uses for the ball/LOS/first-down markers so everything lines up.
const FIELD_YARD_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yard) => ({
  yard,
  label: String(yard <= 50 ? yard : 100 - yard),
  left: FIELD_INSET_PCT + (yard / 100) * FIELD_SPAN_PCT,
}))

// ── TV network logo map — files live in logos/networks/ (served at /logos/) ─
// Populated by running:  python scripts/download_tv_logos.py
// Keys match broadcast names ESPN returns (case-insensitive lookup below).
// Falls back to text when a name isn't mapped or the image fails to load.
const NETWORK_LOGOS = {
  'ESPN':                '/logos/networks/espn.png',
  'ESPN2':               '/logos/networks/espn2.png',
  'ESPNU':               '/logos/networks/espnu.png',
  'ESPN+':               '/logos/networks/espnplus.png',
  'ABC':                 '/logos/networks/abc.png',
  'FOX':                 '/logos/networks/fox.png',
  'FS1':                 '/logos/networks/fs1.png',
  'FOX SPORTS 1':        '/logos/networks/fs1.png',
  'FS2':                 '/logos/networks/fs2.png',
  'FOX SPORTS 2':        '/logos/networks/fs2.png',
  'NBC':                 '/logos/networks/nbc.png',
  'NBC SPORTS':          '/logos/networks/nbcsports.png',
  'PEACOCK':             '/logos/networks/peacock.png',
  'NFL NETWORK':         '/logos/networks/nflnetwork.png',
  'NFL NET':             '/logos/networks/nflnetwork.png',
  'MLB NETWORK':         '/logos/networks/mlbnetwork.png',
  'NBA TV':              '/logos/networks/nbatv.png',
  'NHL NETWORK':         '/logos/networks/nhlnetwork.png',
  'TNT':                 '/logos/networks/tnt.png',
  'TBS':                 '/logos/networks/tbs.png',
  'CBS':                 '/logos/networks/cbs.png',
  'CBS SPORTS NETWORK':  '/logos/networks/cbssn.png',
  'CBSSN':               '/logos/networks/cbssn.png',
  'SEC NETWORK':         '/logos/networks/secn.png',
  'SECN':                '/logos/networks/secn.png',
  'ACC NETWORK':         '/logos/networks/accn.png',
  'ACCN':                '/logos/networks/accn.png',
  'BIG TEN NETWORK':     '/logos/networks/btn.png',
  'BTN':                 '/logos/networks/btn.png',
  'USA NETWORK':         '/logos/networks/usa.png',
  'USA NET':             '/logos/networks/usa.png',
  'USA':                 '/logos/networks/usa.png',
  'THE CW':              '/logos/networks/cw.png',
  'CW':                  '/logos/networks/cw.png',
  'THE CW NETWORK':      '/logos/networks/cw.png',
  'CW NETWORK':          '/logos/networks/cw.png',
  'ALTITUDE':            '/logos/networks/altitude.png',
  'ALTITUDE SPORTS':     '/logos/networks/altitude.png',
  'BALLY SPORTS':        '/logos/networks/ballysports.png',
  'LONGHORN NETWORK':    '/logos/networks/longhorn.png',
  'LHN':                 '/logos/networks/longhorn.png',
  'PAC-12 NETWORK':      '/logos/networks/pac12.png',
  'PAC-12':              '/logos/networks/pac12.png',
  'P12':                 '/logos/networks/pac12.png',
  'DAZN':                '/logos/networks/dazn.png',
  'HBO MAX':             '/logos/networks/hbomax.png',
  'HBOMAX':              '/logos/networks/hbomax.png',
  'MAX':                 '/logos/networks/max.png',
  'PARAMOUNT+':          '/logos/networks/paramount.png',
  'PARAMOUNT PLUS':      '/logos/networks/paramount.png',
  'TENNIS CHANNEL':      '/logos/networks/tennis.png',
  'OLYMPIC CHANNEL':     '/logos/networks/olympic.png',
  'NETFLIX':             '/logos/networks/netflix.svg',
  'PRIME VIDEO':         '/logos/networks/primevideo.svg',
  'AMAZON PRIME VIDEO':  '/logos/networks/primevideo.svg',
  'APPLE TV':            '/logos/networks/appletv.svg',
  'APPLE TV+':           '/logos/networks/appletv.svg',
  'APPLE TV PLUS':       '/logos/networks/appletv.svg',
  'SPORTSNET':           '/logos/networks/sportsnet.png',
  'SN':                  '/logos/networks/sportsnet.png',
  'MLB.TV':              '/logos/networks/mlbnetwork.png',
  'MLBTV':               '/logos/networks/mlbnetwork.png',
}

// ── NASCAR manufacturer logo map — files live in logos/nascar/manufacturers/ ─
// Populated by scripts/sync_nascar_photos.py. Keys match remote_urls.manufacturer
// from team-meta (case-insensitive lookup below).
const MANUFACTURER_LOGOS = {
  CHEVROLET: '/logos/nascar/manufacturers/chevrolet.png',
  TOYOTA:    '/logos/nascar/manufacturers/toyota.png',
  FORD:      '/logos/nascar/manufacturers/ford.png',
  RAM:       '/logos/nascar/manufacturers/ram.png',
}

// Standings card colors are computed here instead of with CSS color-mix(): the kiosk's Chromium
// may predate color-mix (111+), and unsupported color-mix silently drops the whole declaration,
// which showed up as flat grey panels on the board while a newer desktop browser looked right.
function toRgb(color) {
  const c = String(color || '').trim()
  let m = c.match(/^#?([0-9a-f]{6})$/i)
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  m = c.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i)
  if (m) {
    const h = Number(m[1]) / 360, sat = Number(m[2]) / 100, l = Number(m[3]) / 100
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, pp = 2 * l - q
    const f = (t) => { t = (t + 1) % 1; return Math.round(255 * (t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp)) }
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)]
  }
  return [242, 183, 5]
}
function mixRgb(rgb, pct, base) {
  const w = pct / 100
  return `rgb(${rgb.map((v, i) => Math.round(v * w + base[i] * (1 - w))).join(',')})`
}
function standingsColorVars(color) {
  const rgb = toRgb(color)
  const ink = [11, 13, 18], foot = [20, 24, 33], white = [255, 255, 255], black = [0, 0, 0]
  return {
    '--rc': `rgb(${rgb.join(',')})`,
    '--rc-rgb': rgb.join(','),
    '--rc-m18': mixRgb(rgb, 18, ink), '--rc-m25': mixRgb(rgb, 25, ink), '--rc-m60': mixRgb(rgb, 60, ink),
    '--rc-m65': mixRgb(rgb, 65, ink), '--rc-m34f': mixRgb(rgb, 34, foot),
    '--rc-m75k': mixRgb(rgb, 75, black), '--rc-m80w': mixRgb(rgb, 80, white), '--rc-m85w': mixRgb(rgb, 85, white),
  }
}

// NASCAR has no per-driver team colors cached, so the standings card colors each driver by
// manufacturer instead -- a real, meaningful signal rather than a hash of the name.
const MANUFACTURER_COLORS = {
  CHEVROLET: '#F2B705',
  TOYOTA:    '#EB0A1E',
  FORD:      '#0A4DA6',
  RAM:       '#C8102E',
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function teamAbbr(team) {
  return String(team?.abbreviation || team?.name || '?').slice(0, 4).toUpperCase()
}

// Deterministic hue from a string — same name always produces the same color.
// Used as fallback when no team color is available (ESPN racing entries have no team data).
function nameHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffff
  return h % 360
}
// cf.nascar.com's margin_of_victory is usually a bare decimal string (".565") but can also be
// free text for a lapped-field win (e.g. "1 Lap"). Format the numeric case, pass text through as-is.
function formatRaceMargin(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const n = Number(s)
  return /^-?[.\d]+$/.test(s) && !Number.isNaN(n) ? `${n.toFixed(3)}s` : s
}
function entryColor(entry) {
  if (entry?.teamColor) return `#${String(entry.teamColor).replace(/^#/, '')}`
  const name = String(entry?.shortName || entry?.name || '')
  if (!name) return ''
  return `hsl(${nameHue(name)}, 68%, 52%)`
}

// Status text shown in the seam/clock slot
function statusText(game) {
  const state = String(game?.state || '').toLowerCase()
  if (state === 'pre') return game?.runtimeDateText || 'TBD'
  if (state === 'in') return formatRuntimeStatus(game) || 'LIVE'
  return '' // post — chip reads FINAL; score carries the result
}

// Split "Sun, Sep 13, 1:00 PM" → { date: "Sun, Sep 13", time: "1:00 PM" }
function splitDateTime(text) {
  if (!text) return { date: '', time: '' }
  const m = text.match(/^(.+),\s*(\d+:\d+\s*(?:AM|PM)?)$/i)
  return m ? { date: m[1].trim(), time: m[2].trim() } : { date: text, time: '' }
}

// ── Shared atoms ───────────────────────────────────────────────────────────

function StateChip({ game, className }) {
  const state = String(game?.state || '').toLowerCase()
  const live = state === 'in'
  const label = live ? 'LIVE' : state === 'post' ? 'FINAL' : 'UPCOMING'
  return (
    <span className={`chip ${live ? 'chip-live' : state === 'post' ? 'chip-final' : 'chip-pre'} ${className || ''}`}>
      {live ? <i className="chip-dot" /> : null}
      {label}
    </span>
  )
}

function FlagChip({ state }) {
  const s = String(state || '').toLowerCase()
  if (!s || s === 'checkered' || s === 'white') return null
  const cls = s === 'green' ? 'chip-flag-green' : s === 'red' ? 'chip-flag-red' : 'chip-flag-yellow'
  return <span className={`chip ${cls}`}>{s.toUpperCase()}</span>
}

// Driver headshot → car badge → colored dot, with a real fallback chain (not just "does the URL
// string exist") — an existing-but-dead headshot URL (ESPN doesn't have a photo for every driver,
// confirmed 2026-10-02: some newer/rookie drivers 404 there even though their car badge is fine)
// was showing broken/blank instead of ever trying the badge, same bug LogoBox above already
// solves for team logos via onError + useState; this applies that same pattern here.
function DriverImage({ headshot, carBadge, color, name, hsClass, badgeClass, dotClass }) {
  const [hsErr, setHsErr] = useState(false)
  const [badgeErr, setBadgeErr] = useState(false)
  useEffect(() => { setHsErr(false) }, [headshot])
  useEffect(() => { setBadgeErr(false) }, [carBadge])
  if (headshot && !hsErr) {
    return <img className={hsClass} src={headshot} alt={name} onError={() => setHsErr(true)} />
  }
  if (carBadge && !badgeErr) {
    return <img className={badgeClass} src={carBadge} alt={name} onError={() => setBadgeErr(true)} />
  }
  return <span className={dotClass} style={{ background: color }} />
}

function LogoBox({ team, side, size }) {
  const [err, setErr] = useState(false)
  const logo = String(team?.logo || '').trim()
  const showImg = logo && !err
  return (
    <span className={`lg lg-${size || 'md'} ${showImg ? 'lg-has' : ''}`} style={{ '--dot': `var(--dot-${side})` }}>
      {showImg
        ? <img className="lg-img" src={logo} alt={teamAbbr(team)} onError={() => setErr(true)} />
        : <span className="lg-abbr">{teamAbbr(team)}</span>}
    </span>
  )
}

// ── Live features ──────────────────────────────────────────────────────────

function BaseballLive({ game, compact }) {
  const d = game?.baseballLiveData
  if (!d) return null
  const balls = d.balls ?? 0
  const strikes = d.strikes ?? 0
  const outs = d.outs ?? 0
  return (
    <div className={`live bb ${compact ? 'live-compact' : ''}`}>
      <div className="bb-diamond" aria-label="Bases">
        <span className={`base bb-2 ${d.onSecond ? 'on' : ''}`} />
        <span className={`base bb-1 ${d.onFirst ? 'on' : ''}`} />
        <span className={`base bb-3 ${d.onThird ? 'on' : ''}`} />
        <span className="base bb-home" />
      </div>
      <div className="bb-read">
        <span className="bb-count">{balls}-{strikes}</span>
        <span className="bb-outs">
          {[0, 1, 2].map((i) => <i key={i} className={`bb-out ${i < outs ? 'on' : ''}`} />)}
          <em>{outs} OUT</em>
        </span>
      </div>
    </div>
  )
}

function SoccerLive({ game }) {
  const sl = game?.soccerLiveData
  if (!sl) return null
  const aPct = sl.possessionPct?.a ?? 50
  const hPct = sl.possessionPct?.h ?? 50
  const possSide = aPct >= hPct ? 'a' : 'h'
  const possTeam = possSide === 'a' ? game?.teams?.away : game?.teams?.home
  const pct = Math.round(possSide === 'a' ? aPct : hPct)
  const attackRight = possSide === 'a'
  return (
    <div className="ff sc">
      <div className="sc-dd">
        <span className="sc-arrow">{attackRight ? '▶' : '◀'}</span>
        <span className="sc-poss">{teamAbbr(possTeam)}</span>
        {' '}{pct}% POSS
      </div>
      <div className="sc-field" aria-label="Pitch possession">
        <span className="sc-third" style={{ [attackRight ? 'right' : 'left']: 0, background: `var(--c${possSide})` }} />
        <span className="sc-box sc-box-l" />
        <span className="sc-box sc-box-r" />
        <span className="sc-circle" />
        <span className="sc-line" />
        <span className="sc-goalpost sc-goalpost-l" style={{ background: 'var(--ca)' }} />
        <span className="sc-goalpost sc-goalpost-r" style={{ background: 'var(--ch)' }} />
        <span className="sc-ball" style={{ left: `${Math.max(5, Math.min(95, sl.ballOn != null ? sl.ballOn : (attackRight ? 82 : 18)))}%` }} />
      </div>
      <div className="sc-sub">
        <span>SHOTS {sl.shots?.a ?? 0}–{sl.shots?.h ?? 0}</span>
        {(sl.corners?.a != null) ? <span>CORNERS {sl.corners.a}–{sl.corners.h}</span> : null}
      </div>
    </div>
  )
}

const FOOTBALL_DOWN_ORDINALS = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' }

function FootballLive({ game, compact }) {
  const f = game?.footballLiveData
  if (!f) return null
  // ESPN's own short form (e.g. "1st & 10", or "1st & Goal" near the goal line) has no
  // location baked in -- the field graphic + "BALL ON" line already cover that, and ESPN's
  // wording (esp. "Goal") is more accurate than anything reconstructed from down/distance.
  const downDistanceText = f.shortDownDistanceText
    || (f.downDistanceText || '').replace(/\s+at\s+.+$/i, '')
    || (f.down != null && f.distance != null
      ? `${FOOTBALL_DOWN_ORDINALS[f.down] || `${f.down}TH`} & ${f.distance}`
      : '')
  const possTeam = f.possessionSide === 'home' ? game?.teams?.home : f.possessionSide === 'away' ? game?.teams?.away : null
  const attackRight = f.possessionSide === 'away'
  return (
    <div className={`ff ${compact ? 'live-compact' : ''}`}>
      {downDistanceText ? <div className="ff-dd">{downDistanceText}</div> : null}
      <div className="ff-field" aria-label="Field position">
        <span className="ff-ez ff-ez-l" style={{ backgroundColor: 'var(--ca)' }} />
        <span className="ff-ez ff-ez-r" style={{ backgroundColor: 'var(--ch)' }} />
        {FIELD_YARD_MARKS.map((mark) => (
          <span key={mark.yard} className="ff-yd" style={{ left: `${mark.left}%` }}>{mark.label}</span>
        ))}
        {!f.isRedZone && f.firstDownPct != null ? <span className="ff-fd" style={{ left: `${f.firstDownPct}%` }} /> : null}
        {!f.isRedZone && f.losPct != null ? <span className="ff-los" style={{ left: `${f.losPct}%` }} /> : null}
        {f.losPct != null ? <span className="ff-ball" style={{ left: `${f.losPct}%` }} /> : null}
      </div>
      <div className="ff-sub">
        {possTeam
          ? (
            <span className="ff-poss">
              <span className="sc-arrow">{attackRight ? '▶' : '◀'}</span>
              {' '}{teamAbbr(possTeam)}
            </span>
          )
          : null}
        {f.possessionText ? <span>BALL ON {f.possessionText}</span> : null}
        {f.isRedZone ? <span className="ff-rz">RED ZONE</span> : null}
      </div>
    </div>
  )
}

function hasLiveFeature(game) {
  if (String(game?.state || '').toLowerCase() !== 'in') return false
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball' && game?.baseballLiveData && game?.isLiveFeatured) return true
  if (sport === 'soccer' && game?.soccerLiveData && game?.isLiveFeatured) return true
  if (sport === 'football' && game?.footballLiveData && game?.isLiveFeatured) return true
  return Boolean(game?.situationText)
}

function LiveFeature({ game, compact }) {
  if (String(game?.state || '').toLowerCase() !== 'in') return null
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball' && game?.baseballLiveData && game?.isLiveFeatured) {
    return <BaseballLive game={game} compact={compact} />
  }
  if (sport === 'soccer' && game?.soccerLiveData && game?.isLiveFeatured) {
    return <SoccerLive game={game} />
  }
  if (sport === 'football' && game?.footballLiveData && game?.isLiveFeatured) {
    return <FootballLive game={game} compact={compact} />
  }
  if (game?.situationText) {
    return <span className="sit-txt"><b>{game.situationText}</b></span>
  }
  return null
}

// ── TV network logo with text fallback ────────────────────────────────────

function NetworkLogo({ name }) {
  const [err, setErr] = useState(false)
  const url = NETWORK_LOGOS[name.trim().toUpperCase()] ?? null
  if (url && !err) {
    return <img className="meta-tv-logo" src={url} alt={name} onError={() => setErr(true)} />
  }
  return <span className="meta-tv-name">{name}</span>
}

// ── Meta row (TV / venue — odds handled separately in team panels) ─────────

function MetaRow({ game, flags, mono }) {
  const items = []
  if (flags.tv && game?.broadcastText) items.push(['TV', game.broadcastText])
  if (flags.venue && game?.venueText) items.push(['AT', game.venueText])
  if (!items.length) return null
  return (
    <div className={`meta ${mono ? 'meta-mono' : ''}`}>
      {items.map(([k, v], i) => {
        if (k === 'TV') {
          const nets = v.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
          return (
            <span key={i} className="meta-i meta-tv">
              {nets.map((n, j) => <NetworkLogo key={j} name={n} />)}
            </span>
          )
        }
        return (
          <span key={i} className={`meta-i${v.length > 25 ? ' meta-i-sm' : ''}`}>
            {k ? <em>{k}</em> : null}{v}
          </span>
        )
      })}
    </div>
  )
}

// ── Per-team odds spread ───────────────────────────────────────────────────
// oddsText like "CIN-3.5" or "NYY+7". Returns spread string for the given
// team abbreviation, flipping the sign for the non-favored side.
function teamSpread(oddsText, abbr) {
  if (!oddsText || !abbr) return ''
  if (/^pk$/i.test(oddsText.trim())) return 'PK'
  const m = oddsText.trim().match(/^([A-Z]+)\s*([+\-][\d.]+)$/i)
  if (!m) return ''
  const num = parseFloat(m[2])
  if (isNaN(num)) return ''
  const isFavored = m[1].toUpperCase() === abbr.toUpperCase()
  if (isFavored) return m[2]                                   // e.g. "-3.5"
  return num < 0 ? `+${Math.abs(num)}` : `-${Math.abs(num)}` // flip sign
}

// ── Score or pre-game dash ─────────────────────────────────────────────────

function ScoreOrDash({ team, game }) {
  const state = String(game?.state || '').toLowerCase()
  if (state === 'pre') return <span className="score score-dim">—</span>
  const wide = String(team?.score ?? '').length >= 3
  return <span className={`score ${wide ? 'score-3d' : ''}`}>{team?.score}</span>
}

// ── DIRECTION 1 · SLAB ─────────────────────────────────────────────────────

function SlabCard({ game, flags }) {
  const a = game?.teams?.away
  const h = game?.teams?.home
  const isPre = String(game?.state || '').toLowerCase() === 'pre'
  const isCombat = Boolean(game?.combat)
  const showFeat = flags.situation && hasLiveFeature(game)
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

  const Half = ({ team, side }) => {
    const spread = side === 'a' ? aSpread : hSpread
    const record = String(team?.record || '').trim()
    const fighterName = isCombat ? String(team?.name || team?.abbreviation || '').trim() : ''
    return (
      <div className={`slab-half slab-${side}`}>
        <i className="slab-bar" style={{ background: `var(--bar-${side})` }} />
        <div className="slab-logo-group">
          <LogoBox team={team} side={side} size="lg" />
          {flags.records && !isCombat && record
            ? <span className="slab-rec">{record}</span>
            : null}
          {spread ? <span className="slab-spread">{spread}</span> : null}
        </div>
        {isCombat && fighterName ? (
          <div className="combat-info">
            <span className="combat-name">{fighterName}</span>
            {team?.nickname ? <span className="combat-nickname">"{team.nickname}"</span> : null}
          </div>
        ) : null}
        {isCombat
          ? (record ? <span className="rec-big">{record}</span> : null)
          : (!isPre ? <ScoreOrDash team={team} game={game} /> : null)}
      </div>
    )
  }

  const state = String(game?.state || '').toLowerCase()
  const st = statusText(game)
  const { date, time } = isPre ? splitDateTime(st) : { date: st, time: '' }

  // Combat: live → round info; pre → fight date/time; post → nothing (chip + weight class sufficient)
  const seamStatus = isCombat
    ? (state === 'in'
        ? String(game?.liveState?.detail || game?.status?.shortDetail || '').trim() || 'LIVE'
        : state === 'pre'
          ? String(game?.runtimeDateText || st || '').trim()
          : '')
    : date

  const { date: seamDate, time: seamTime } = isCombat && state === 'pre'
    ? splitDateTime(seamStatus)
    : { date: seamStatus, time: '' }

  return (
    <div className={`card d-slab ${isCombat ? 'd-slab-combat' : ''} ${showFeat ? 'has-feat' : ''} ${isPre ? 'is-pre' : ''}`}>
      <Half team={a} side="a" />
      <div className="slab-seam">
        <StateChip game={game} />
        {isCombat && game?.sessionLabel ? <span className="slab-time">{game.sessionLabel}</span> : null}
        {seamDate ? <span className="slab-status">{seamDate}</span> : null}
        {(isCombat ? seamTime : time) ? <span className="slab-time">{isCombat ? seamTime : time}</span> : null}
        {showFeat ? <LiveFeature game={game} compact /> : null}
        <MetaRow game={game} flags={flags} mono />
      </div>
      <Half team={h} side="h" />
    </div>
  )
}

// ── DIRECTION 2 · SPINE ────────────────────────────────────────────────────

function SpineCard({ game, flags }) {
  const a = game?.teams?.away
  const h = game?.teams?.home
  const isPre = String(game?.state || '').toLowerCase() === 'pre'
  const isCombat = Boolean(game?.combat)
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

  const Flank = ({ team, side }) => {
    const spread = side === 'a' ? aSpread : hSpread
    const fighterName = isCombat ? String(team?.name || team?.abbreviation || '').trim() : ''
    return (
      <div className={`spine-flank spine-${side}`}>
        <div className="spine-logo-group">
          <LogoBox team={team} side={side} size="xl" />
          {flags.records && String(team?.record || '').trim()
            ? <span className="spine-rec">{team.record}</span>
            : null}
          {spread ? <span className="spine-spread">{spread}</span> : null}
        </div>
        {isCombat && fighterName ? (
          <div className="combat-info">
            <span className="combat-name">{fighterName}</span>
            {team?.nickname ? <span className="combat-nickname">"{team.nickname}"</span> : null}
          </div>
        ) : null}
      </div>
    )
  }

  const st = statusText(game)
  const { date, time } = isPre ? splitDateTime(st) : { date: st, time: '' }
  const spineStatus = isCombat && String(game?.state || '').toLowerCase() === 'in'
    ? String(game?.liveState?.detail || game?.status?.shortDetail || st || '').trim()
    : date
  return (
    <div className={`card d-spine ${isPre ? 'is-pre' : ''}`}>
      <Flank team={a} side="a" />
      <div className="spine-mid">
        <StateChip game={game} />
        {isCombat && game?.sessionLabel ? <span className="spine-time">{game.sessionLabel}</span> : null}
        <div className="spine-score">
          {(isPre || isCombat)
            ? <span className="spine-vs">VS</span>
            : (<><b>{a?.score}</b><s>–</s><b>{h?.score}</b></>)}
        </div>
        {spineStatus ? <span className="spine-status">{spineStatus}</span> : null}
        {!isCombat && time ? <span className="spine-time">{time}</span> : null}
        {flags.situation && hasLiveFeature(game) ? <LiveFeature game={game} /> : null}
        <MetaRow game={game} flags={flags} />
      </div>
      <Flank team={h} side="h" />
    </div>
  )
}

// ── DIRECTION 3 · DIGITS ───────────────────────────────────────────────────

function DigitsCard({ game, flags }) {
  const isPre = String(game?.state || '').toLowerCase() === 'pre'
  const isCombat = Boolean(game?.combat)
  const showFeat = flags.situation && hasLiveFeature(game)

  const Row = ({ team, side }) => (
    <div className={`dig-row dig-${side}`}>
      <i className="dig-strip" style={{ background: `var(--bar-${side})` }} />
      <LogoBox team={team} side={side} size="sm" />
      {team?.logo ? <span className="dig-abbr">{teamAbbr(team)}</span> : null}
      {flags.records && String(team?.record || '').trim()
        ? <span className="dig-rec">{team.record}</span>
        : null}
      <span className="dig-box">{(isPre || isCombat) ? '·' : (team?.score ?? '—')}</span>
    </div>
  )

  const digClock = isCombat && String(game?.state || '').toLowerCase() === 'in'
    ? String(game?.liveState?.detail || game?.status?.shortDetail || '').trim() || 'LIVE'
    : statusText(game)

  return (
    <div className="card d-digits">
      <div className="dig-head">
        <span className="dig-league">{game?.leagueName || ''}</span>
        <StateChip game={game} />
        <span className="dig-clock">{isCombat && game?.sessionLabel ? game.sessionLabel : digClock}</span>
      </div>
      <Row team={game?.teams?.away} side="a" />
      <Row team={game?.teams?.home} side="h" />
      {(showFeat || flags.tv) ? (
        <div className="dig-foot">
          {showFeat ? <LiveFeature game={game} /> : <span />}
          <MetaRow game={game} flags={flags} mono />
        </div>
      ) : null}
    </div>
  )
}

// ── DIRECTION 4 · MARQUEE ──────────────────────────────────────────────────

function MarqueeCard({ game, flags }) {
  const a = game?.teams?.away
  const h = game?.teams?.home
  const isPre = String(game?.state || '').toLowerCase() === 'pre'
  const isCombat = Boolean(game?.combat)
  const showFeat = flags.situation && hasLiveFeature(game)
  const sport = String(game?.sport || '').toLowerCase()
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

  const marqClock = isCombat && String(game?.state || '').toLowerCase() === 'in'
    ? String(game?.liveState?.detail || game?.status?.shortDetail || '').trim() || 'LIVE'
    : statusText(game)

  return (
    <div className={`card d-marq ${showFeat ? 'has-feat' : ''}`}>
      <div className="marq-half marq-a">
        <div className="marq-logo-group">
          <LogoBox team={a} side="a" size="lg" />
          {flags.records && String(a?.record || '').trim()
            ? <span className="marq-rec">{a.record}</span>
            : null}
          {aSpread ? <span className="marq-spread">{aSpread}</span> : null}
        </div>
        <span className="marq-score">{(isPre || isCombat) ? '' : (a?.score ?? '')}</span>
      </div>
      <div className={`marq-seam ${showFeat ? `marq-seam-${sport}` : ''}`}>
        <StateChip game={game} />
        {isCombat && game?.sessionLabel ? <span className="marq-clock">{game.sessionLabel}</span> : null}
        <span className="marq-clock">{marqClock}</span>
        {showFeat ? <LiveFeature game={game} compact /> : null}
        <MetaRow game={game} flags={flags} />
      </div>
      <div className="marq-half marq-h">
        <span className="marq-score">{(isPre || isCombat) ? '' : (h?.score ?? '')}</span>
        <div className="marq-logo-group">
          <LogoBox team={h} side="h" size="lg" />
          {flags.records && String(h?.record || '').trim()
            ? <span className="marq-rec">{h.record}</span>
            : null}
          {hSpread ? <span className="marq-spread">{hSpread}</span> : null}
        </div>
      </div>
    </div>
  )
}

// ── Upcoming race card (NASCAR + F1) — session timeline, next session is the hero ──────────────

// cf.nascar.com schedule times carry no offset ("2026-10-03T20:30:00" is UTC) — see formatScheduleTime.
function parseSessionMs(raw) {
  const s = String(raw || '').trim()
  if (!s) return NaN
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).getTime()
}

function sessionStops(game, now) {
  const rd = game?.raceDetails || {}
  const raw = Array.isArray(game?.sessions) && game.sessions.length
    ? game.sessions.map((s) => ({ label: s.label, ms: parseSessionMs(s.startTimeUtc), post: s.state === 'post' }))
    : (Array.isArray(rd.schedule) ? rd.schedule : []).map((s) => ({ label: s.label, ms: parseSessionMs(s.startTimeUtc), post: false }))
  const stops = raw.filter((s) => Number.isFinite(s.ms)).sort((a, b) => a.ms - b.ms)
    .map((s) => ({ ...s, done: s.post || s.ms <= now }))
  let next = stops.findIndex((s) => !s.done)
  if (next < 0) next = stops.length - 1
  return stops.map((s, i) => ({ ...s, next: i === next }))
}

function sessionParts(ms) {
  const d = new Date(ms)
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(d)
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).formatToParts(d)
  const pick = (parts, t) => parts.find((p) => p.type === t)?.value || ''
  return {
    day: `${pick(date, 'weekday')} ${pick(date, 'month')} ${pick(date, 'day')}`.toUpperCase(),
    clock: `${pick(time, 'hour')}:${pick(time, 'minute')}`,
    period: pick(time, 'dayPeriod').toUpperCase(),
    tz: pick(time, 'timeZoneName'),
  }
}

const TRACK_SUFFIX = /\s+(Motor Speedway|International Speedway|International Raceway|Superspeedway|Speedway|Raceway|Motorsports Park)$/i

function UpcomingRaceCard({ game, title, seriesName, flags }) {
  const rd = game.raceDetails
  const isF1 = String(game?.leagueId || '').toLowerCase() === 'f1'
  const circuitImg = String(game?.circuitImage || '').trim()
  // Re-evaluated each minute so the "next" session advances while the card is on screen
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  const stops = sessionStops(game, now)
  const dw = rd.defendingWinner
  // Shrink the race name to fit its line (sponsor-laden ESPN titles can be long); CSS ellipsis is the last resort.
  const titleRef = useRef(null)
  const raceTitle = rd.raceName || title
  const hasDw = Boolean(dw?.name)
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return undefined
    const fit = () => {
      el.style.setProperty('--ts-scale', '1')
      const over = el.scrollWidth - el.clientWidth
      if (over > 0) el.style.setProperty('--ts-scale', String(Math.max(0.5, (el.clientWidth / el.scrollWidth) * 0.98)))
    }
    fit()
    let cancelled = false
    document.fonts?.ready?.then(() => { if (!cancelled) fit() })
    return () => { cancelled = true }
  }, [raceTitle, hasDw])
  const track = String(rd.trackName || '').replace(TRACK_SUFFIX, '').trim()
  const stats = [
    rd.scheduledLaps ? <span key="l"><b>{rd.scheduledLaps}</b> LAPS</span> : null,
    rd.scheduledDistance ? <span key="d"><b>{rd.scheduledDistance}</b> MI{rd.trackMiles ? ' RACE' : ''}</span> : null,
    rd.trackMiles ? <span key="t"><b>{rd.trackMiles}</b> MI TRACK</span> : null,
    rd.numberOfCarsInField ? <span key="c"><b>{rd.numberOfCarsInField}</b> CARS</span> : null,
  ].filter(Boolean)
  return (
    <div className={`card up-card ${isF1 ? 'up-f1' : 'up-nas'} ${isF1 && !circuitImg ? 'up-nomap' : ''}`}>
      <div className="up-main">
        {dw?.name ? (
          <div className="up-dw">
            {dw.headshot ? <img src={dw.headshot} alt="" onError={(e) => { e.currentTarget.remove() }} /> : null}
            <div><div className="k">DEFENDING WINNER</div><div className="nm">{dw.name}<small>{dw.year}</small></div></div>
          </div>
        ) : null}
        <div className={`up-head ${dw?.name ? 'has-dw' : ''}`}>
          <div className="up-ser">{[seriesName, track].filter(Boolean).join(' · ')}</div>
          <h3 className="up-title" ref={titleRef}>{raceTitle}</h3>
          {stats.length ? (
            <div className="up-stats">
              {stats.map((el, i) => <Fragment key={i}>{i ? <i>·</i> : null}{el}</Fragment>)}
            </div>
          ) : null}
        </div>
        <div className="up-body">
          <div className="up-tl">
            {stops.map((s, i) => {
              const p = sessionParts(s.ms)
              return (
                <div key={i} className={`up-st ${s.next ? 'next' : s.done ? 'done' : 'med'}`}>
                  <div className="d">{s.next ? 'NEXT · ' : ''}{p.day}</div>
                  <div className="t">{p.clock}<small> {p.period}{s.next ? ` ${p.tz}` : ''}</small></div>
                  <div className="n">{s.label}</div>
                </div>
              )
            })}
          </div>
          {game?.broadcastText && flags.tv ? (
            <span className="up-tv">
              {game.broadcastText.split(/\s*\/\s*/).filter(Boolean).map((n, i) => <NetworkLogo key={i} name={n} />)}
            </span>
          ) : null}
        </div>
      </div>
      {circuitImg ? (
        <div className="up-map">
          <img src={circuitImg} alt="Circuit map" onError={(e) => { e.currentTarget.closest('.up-map')?.remove() }} />
        </div>
      ) : null}
    </div>
  )
}

// ── Starting grid (qualifying order) — 2-wide staggered formation, every car ───────────────────
// Odd positions run in the top lane, even in the bottom lane shifted back half a step, like a real
// grid. Sizes are in cqh (board height) so it scales with the display like every other card.
function StartingGridCard({ game, title, seriesName, displayEntries }) {
  const isF1 = String(game?.leagueId || '').toLowerCase() === 'f1'
  const toUrl = (p) => (p ? (p.startsWith('http') ? p : `/logos/${p}`) : null)
  // One name size for everyone; the STRIP grows with the surname instead. Each column is as wide as
  // its wider strip, so the two lanes stay staggered and nothing overlaps the next driver.
  const STAG = 40, PAD = 3, GAP = 4, POS_W = 17, PHOTO_W = 30, CHAR_W = 5.3
  const surnameOf = (e) => {
    const parts = String(e.shortName || e.name || 'Driver').split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  }
  const stripW = displayEntries.map((e) => Math.max(82, POS_W + 4 + surnameOf(e).length * CHAR_W + PHOTO_W))
  // Each lane packs on its own with the same fixed gap, so spacing between neighbours never varies;
  // the bottom lane starts half a step back to keep the staggered grid formation.
  const stripX = []
  const laneEnd = [PAD, PAD + STAG]
  displayEntries.forEach((_, i) => {
    const lane = i % 2
    stripX[i] = laneEnd[lane]
    laneEnd[lane] += stripW[i] + GAP
  })
  const width = Math.max(laneEnd[0], laneEnd[1]) + 1
  return (
    <div className="card gb-card" style={{ width: `${width}cqh` }}>
      <div className="gb-hdr">
        <h3>Starting Grid</h3>
        <span>{[seriesName, game?.raceDetails?.raceName].filter(Boolean).join(' · ') || title}</span>
      </div>
      {displayEntries.map((entry, i) => {
        const lane = i % 2
        const mfr = String(entry.manufacturer || '').toUpperCase()
        const color = MANUFACTURER_COLORS[mfr] || entryColor(entry)
        const name = entry.shortName || entry.name || 'Driver'
        const parts = name.split(' ')
        const surname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
        const car = entry.carNumber ? `#${entry.carNumber}` : ''
        // F1: full-body transparent render (cutout, like the NASCAR photos); fall back to the round headshot
        const hs = toUrl(isF1 ? (entry.render || entry.headshot) : entry.headshot)
        const round = isF1 && !entry.render
        return (
          <div
            key={i}
            className={`gb-strip ${round ? 'gb-round' : ''}`}
            style={{ ...standingsColorVars(color), '--gb-w': `${stripW[i]}cqh`, zIndex: displayEntries.length - i, left: `${stripX[i]}cqh`, top: lane ? '56cqh' : '17cqh' }}
          >
            <div className="gb-pos"><em>{entry.position ?? i + 1}</em></div>
            <div className="gb-body">
              <div className="gb-txt">
                <b>{surname}</b>
                {car ? <small>{car}</small> : null}
              </div>
              {hs ? (
                round
                  ? <img className="gb-img" src={hs} alt="" onError={(e) => { e.currentTarget.remove() }} />
                  : isF1
                    ? <span className="gb-clip"><img src={hs} alt="" onError={(e) => { e.currentTarget.remove() }} /></span>
                    : <img className="gb-img" src={hs} alt="" onError={(e) => { e.currentTarget.remove() }} />
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Podium (finished race, NASCAR + F1): top 3 in the standings-card style, winner biggest ─────
function PodiumCard({ game, title, entries }) {
  const isF1 = String(game?.leagueId || '').toLowerCase() === 'f1'
  const toUrl = (p) => (p ? (p.startsWith('http') ? p : `/logos/${p}`) : null)
  const margin = formatRaceMargin(game?.raceSummary?.marginOfVictory)
  const summary = [
    game?.raceSummary?.totalRaceTime,
    Number.isInteger(game?.raceSummary?.numberOfCautions)
      ? `${game.raceSummary.numberOfCautions} CAUTION${game.raceSummary.numberOfCautions === 1 ? '' : 'S'}` : '',
    Number.isInteger(game?.raceSummary?.numberOfLeadChanges) ? `${game.raceSummary.numberOfLeadChanges} LEAD CHANGES` : '',
  ].filter(Boolean)
  const top = entries.slice(0, 3).map((e, i) => {
    const mfr = String(e.manufacturer || '').toUpperCase()
    const name = e.name || e.shortName || 'Driver'
    const parts = name.split(' ')
    return {
      pos: i + 1,
      surname: parts.length > 1 ? parts.slice(1).join(' ') : parts[0],
      first: parts.length > 1 ? parts[0] : '',
      team: e.team || '',
      color: MANUFACTURER_COLORS[mfr] || entryColor(e),
      img: toUrl(isF1 ? (e.render || e.headshot) : e.headshot),
      car: e.carNumber ? String(e.carNumber) : '',
      led: Number.isInteger(e.lapsLed) ? e.lapsLed : null,
      started: Number.isInteger(e.startPosition) ? e.startPosition : null,
      brand: toUrl(e.teamLogo) || MANUFACTURER_LOGOS[mfr] || null,
      carImg: toUrl(e.carImage),
      inChase: Boolean(e.inChase),
    }
  })
  // On screen: 2nd, 1st (tallest, middle), 3rd
  const order = [top[1], top[0], top[2]].filter(Boolean)
  return (
    <div className="card pd-card">
      <div className="pd-hdr">
        <div className="pd-title">{title}</div>
        <div className="pd-sub">RACE RESULT{summary.length ? ` · ${summary.join(' · ')}` : ''}</div>
      </div>
      <div className="pd-row">
        {order.map((d) => (
          <div key={d.pos} className={`pd-col pd-p${d.pos} ${isF1 ? 'pd-f1' : 'pd-nas'}`} style={standingsColorVars(d.color)}>
            <div className="pd-top">
              <div className="pd-wash" />
              {d.car ? <span className="pd-car">{d.car}</span> : null}
              {d.brand ? <img className="pd-brand" src={d.brand} alt="" onError={(e) => { e.currentTarget.remove() }} /> : null}
              {d.img ? (
                isF1
                  ? <span className="pd-clip"><img src={d.img} alt="" onError={(e) => { e.currentTarget.remove() }} /></span>
                  : <img className="pd-cut" src={d.img} alt="" onError={(e) => { e.currentTarget.remove() }} />
              ) : null}
              {!isF1 ? <span className="pd-pos pd-pos-over">{d.pos}</span> : null}
              {d.pos === 1 ? <span className="pd-win">WINNER</span> : null}
            </div>
            <div className="pd-bar">
              <span className="pd-first">{d.first}</span>
              <span className="pd-name">{d.surname}{d.inChase ? <i className="mdi mdi-trophy board-chase pd-chase" /> : null}</span>
              {d.team ? <span className="pd-team">{d.team}</span> : null}
            </div>
            {isF1 ? (
              <>
                <div className="pd-mid">
                  <span className="pd-pos">{d.pos}</span>
                  {d.carImg ? <img className="pd-carimg" src={d.carImg} alt="" onError={(e) => { e.currentTarget.remove() }} /> : null}
                </div>
                <div className="pd-stats">
                  {d.pos === 1 && margin ? <span><em>MARGIN</em><b>{margin}</b></span> : null}
                  {d.started ? <span><em>STARTED</em><b>P{d.started}</b></span> : null}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Race flag graphic (waving flag on a pole) ──────────────────────────────────────────────────
const FLAG_COLORS = { green: '#22c55e', yellow: '#facc15', red: '#ef2b2b', white: '#f4f6fa', checkered: '#ffffff' }
const FLAG_LABELS = { green: 'GREEN FLAG', yellow: 'CAUTION', red: 'RED FLAG', white: 'WHITE FLAG', checkered: 'CHECKERED' }
const FLAG_PATH = 'M9 5 C18 0 24 10 33 5 S46 1 49 6 L49 27 C42 32 36 22 29 27 S17 32 9 27 Z'

function FlagGraphic({ kind, className }) {
  const id = `fg-${kind}`
  const cells = []
  if (kind === 'checkered') {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 0) cells.push(<rect key={`${r}-${c}`} x={9 + c * 8} y={r * 8} width="8" height="8" fill="#0b0d12" />)
  }
  return (
    <svg className={`fg ${className || ''}`} viewBox="0 0 52 40" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-clip`}><path d={FLAG_PATH} /></clipPath>
        <linearGradient id={`${id}-sh`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" />
        </linearGradient>
      </defs>
      <rect x="5" y="1" width="3.4" height="38" rx="1.4" fill="#c9ced6" />
      <path d={FLAG_PATH} fill={FLAG_COLORS[kind] || FLAG_COLORS.green} />
      {cells.length ? <g clipPath={`url(#${id}-clip)`}>{cells}</g> : null}
      <path d={FLAG_PATH} fill={`url(#${id}-sh)`} />
    </svg>
  )
}

// ── Live race (NASCAR + F1): lap column + slanted strips for the whole running order ───────────
function LiveRaceCard({ game, title, seriesName, entries }) {
  const isF1 = String(game?.leagueId || '').toLowerCase() === 'f1'
  const toUrl = (p) => (p ? (p.startsWith('http') ? p : `/logos/${p}`) : null)
  const rawFlag = String(game?.flagState || '').toLowerCase()
  const flag = rawFlag === 'caution' ? 'yellow' : (FLAG_COLORS[rawFlag] ? rawFlag : 'green')
  const lapNow = Number(game?.lapNumber) > 0 ? Number(game.lapNumber) : (Number(game?.status?.period) > 0 ? Number(game.status.period) : null)
  const lapTotal = Number(game?.totalLaps) > 0 ? Number(game.totalLaps) : (lapNow && Number(game?.lapsToGo) >= 0 ? lapNow + Number(game.lapsToGo) : null)
  const pct = lapNow && lapTotal ? Math.min(100, Math.round((lapNow / lapTotal) * 100)) : 0
  const accent = isF1 ? '255,42,32' : '242,183,5'
  const PER_COL = 5
  const rows = entries.map((e, i) => {
    const mfr = String(e.manufacturer || '').toUpperCase()
    const full = e.shortName || e.name || 'Driver'
    const parts = String(e.name || full).split(' ')
    const surname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
    const gap = i === 0 ? 'LEAD' : (racingEntrySummary(e) || String(e.score || ''))
    return {
      pos: e.position ?? i + 1,
      name: surname,
      gap,
      color: MANUFACTURER_COLORS[mfr] || entryColor(e),
      img: toUrl(isF1 ? (e.render || e.headshot) : e.headshot),
      car: e.carNumber ? String(e.carNumber) : surname.slice(0, 3).toUpperCase(),
    }
  })
  const cols = []
  for (let i = 0; i < rows.length; i += PER_COL) cols.push(rows.slice(i, i + PER_COL))
  // Column width + front column are in cqh, so the card grows with the field like the other cards
  const width = 76 + cols.length * 68.4 + 8
  return (
    <div className={`card lv-card ${isF1 ? 'lv-f1' : 'lv-nas'}`} style={{ width: `${width}cqh`, '--acc': accent }}>
      <div className="lv-front">
        <div className="lv-ttl">
          <span className="lv-k">{seriesName}</span>
          <h3>{title}</h3>
        </div>
        <div className="lv-big">{lapNow ?? '—'}{lapTotal ? <small>/ {lapTotal}</small> : null}</div>
        <div className="lv-prog"><div style={{ width: `${pct}%` }} /></div>
        <div className="lv-fl"><FlagGraphic kind={flag} />{FLAG_LABELS[flag]}</div>
      </div>
      <div className="lv-body">
        <div className="lv-top">
          <span className={`lv-chip lv-chip-${flag}`}><FlagGraphic kind={flag} /><b>{flag === 'yellow' ? 'CAUTION' : flag.toUpperCase()}</b></span>
          {lapNow ? <span className="lv-lap">LAP {lapNow}{lapTotal ? <i> / {lapTotal}</i> : null}</span> : null}
        </div>
        <div className="lv-cols">
          {cols.map((col, ci) => (
            <div key={ci} className="lv-col">
              {col.map((r) => (
                <div key={r.pos} className={`lv-row ${r.pos === 1 ? 'lead' : ''}`} style={standingsColorVars(r.color)}>
                  <div className="lv-pos"><em>{r.pos}</em></div>
                  <div className="lv-bd">
                    {r.img
                      ? <span className="lv-ph"><img src={r.img} alt="" onError={(e) => { e.currentTarget.remove() }} /></span>
                      : <span className="lv-ph lv-nop"><i>{r.car}</i></span>}
                    <b>{r.name}</b>
                    <i className="lv-gap">{r.gap}</i>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── BOARD (racing / golf) — replaces RacingCard ────────────────────────────

export function BoardCard({ game, isSoloSlate, renderLeague }) {
  const state = String(game?.state || '').toLowerCase()
  const sport = String(game?.sport || '').toLowerCase()
  const isGolf = sport === 'golf'
  const flags = densityFlags({ density: game?.density })

  const allEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
  const entryLimit = Number.isInteger(renderLeague?.entryLimit) ? renderLeague.entryLimit : null
  const cappedEntries = entryLimit ? allEntries.slice(0, entryLimit) : allEntries
  // The qualifying-order card (backend isStartingOrder) always shows the whole lineup, in columns
  const displayEntries = game?.isStartingOrder ? allEntries : isSoloSlate ? cappedEntries : cappedEntries.slice(0, entryLimit ?? 6)

  const hasEntries = displayEntries.length > 0
  const title = racingCardTitle(game, renderLeague)
  const seriesName = String(renderLeague?.name || renderLeague?.id || (isGolf ? 'Tournament' : 'Race')).trim()
  const cs = game?.cardStyle
  const dirClass = cs && cs !== 'standard' && cs !== 'large-logo'
    ? `d-${cs === 'marquee' ? 'marq' : cs}`
    : 'd-slab'

  // Standings — a synthetic entry the backend appends right after the real race event for this
  // league (state: 'standings', never produced by ESPN/cf.nascar.com) so it plays immediately
  // next to it in the rotation. Foil trading-card layout: leader spotlight on the left, P2–P5 as
  // panels on the right. Driver photos are transparent cutouts, so each driver stands in front
  // of a team-color panel with head and shoulders breaking out over its top edge.
  if (state === 'standings' && hasEntries) {
    const toUrl = (p) => (p ? (p.startsWith('http') ? p : `/logos/${p}`) : null)
    const isF1 = String(game?.leagueId || '').toLowerCase() === 'f1'
    const isTeams = game?.standingsKind === 'teams'
    const shape = (entry, i) => {
      const mfr = String(entry.manufacturer || '').toUpperCase()
      const parts = String(entry.name || entry.shortName || '').split(' ')
      return {
        pos: entry.position ?? i + 1,
        name: isF1 && !isTeams && parts.length > 1 ? parts[parts.length - 1] : (entry.shortName || entry.name || 'Driver'),
        team: isTeams ? '' : (entry.team || ''),
        color: MANUFACTURER_COLORS[mfr] || entryColor(entry),
        mfgLogo: isF1 ? (isTeams ? null : toUrl(entry.teamLogo)) : (MANUFACTURER_LOGOS[mfr] || null),
        headshot: isF1 ? (isTeams ? null : toUrl(entry.render || entry.headshot)) : toUrl(entry.headshot),
        carImg: toUrl(entry.carImage),
        teamLogo: toUrl(entry.teamLogo),
        carBadge: toUrl(entry.carBadge),
        points: Number.isInteger(entry.points) ? entry.points : null,
        pointsGap: Number.isInteger(entry.pointsGap) ? entry.pointsGap : null,
        round: isF1 && !isTeams && !entry.render,
      }
    }
    // F1 renders are full-body cutouts -> crop waist-up; team rows show the car instead of a driver
    const art = (r, lead) => {
      if (isF1 && isTeams) {
        return (
          <>
            {r.teamLogo ? <img className={`st-tlogo ${lead ? 'st-tlogo-lead' : ''}`} src={r.teamLogo} alt="" /> : null}
            {r.carImg ? <img className={`st-car ${lead ? 'st-car-lead' : ''}`} src={r.carImg} alt="" /> : null}
          </>
        )
      }
      if (isF1 && r.headshot) return <span className={`st-rclip ${lead ? 'st-rclip-lead' : ''}`}><img src={r.headshot} alt="" /></span>
      return (
        <DriverImage
          headshot={r.headshot} carBadge={null} color={r.color} name={r.name}
          hsClass={lead ? 'st-cut st-lead-cut' : 'st-cut'} badgeClass={lead ? 'st-cut st-lead-cut' : 'st-cut'} dotClass="st-nodot"
        />
      )
    }
    const leader = shape(displayEntries[0], 0)
    const fieldRows = displayEntries.slice(1, 5).map((e, i) => shape(e, i + 1))
    const eyebrow = isTeams ? 'CHAMPIONSHIP LEADER' : 'POINTS LEADER'
    const subLabel = isTeams ? "CONSTRUCTORS' STANDINGS" : isF1 ? "DRIVERS' STANDINGS" : 'STANDINGS'

    return (
      <div className={`card d-board d-standings ${isF1 ? (isTeams ? 'st-f1 st-teams' : 'st-f1') : ''}`}>
        <div className="st-inner">
          <div className="st-lead" style={standingsColorVars(leader.color)}>
            <div className="st-lead-panel st-streaks"><div className="st-halo" /></div>
            <div className="st-lead-floor" />
            {art(leader, true)}
            <span className="st-lrk">{leader.pos}</span>
            {leader.carBadge ? <img className="st-lead-badge" src={leader.carBadge} alt="" /> : null}
            <div className="st-lead-info">
              <span className="st-eyebrow">{eyebrow}</span>
              <span className="st-lead-name">{leader.name}</span>
              <span className="st-lead-row">
                {leader.team}
                {leader.mfgLogo ? <img src={leader.mfgLogo} alt="" /> : null}
                {leader.points != null ? <span className="st-lead-pts">{leader.points}</span> : null}
              </span>
            </div>
          </div>
          <div className="st-field">
            <div className="st-head">
              <div>
                <div className="st-title">{title}</div>
                <div className="st-sub">{subLabel}</div>
              </div>
              {game?.isPlayoffs ? <span className="chip chip-standings">PLAYOFFS</span> : null}
            </div>
            <div className="st-cards">
              {fieldRows.map((r, i) => (
                <div key={i} className="st-fc" style={standingsColorVars(r.color)}>
                  <div className="st-panel st-streaks"><div className="st-halo" /></div>
                  <div className="st-floor" />
                  {art(r, false)}
                  <span className="st-rk">
                    <b>{r.pos}</b>
                    {r.mfgLogo ? <img src={r.mfgLogo} alt="" /> : null}
                  </span>
                  {r.pointsGap != null ? <span className="st-gap"><b>{r.pointsGap}</b> PTS</span> : null}
                  <div className="st-foot">
                    {r.carBadge ? <img src={r.carBadge} alt="" /> : null}
                    <span className="st-name">{r.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (game?.isStartingOrder && hasEntries) {
    return <StartingGridCard game={game} title={title} seriesName={seriesName} displayEntries={displayEntries} />
  }

  // Live race (NASCAR / F1): lap column + the whole running order in strips
  if (state === 'in' && !isGolf && /nascar|^f1$/.test(String(game?.leagueId || '').toLowerCase()) && allEntries.length) {
    return <LiveRaceCard game={game} title={title} seriesName={seriesName} entries={allEntries} />
  }

  // Upcoming race (NASCAR / F1): session timeline with the next session as the hero. Shown for the
  // whole pre-race window — including after qualifying, when ESPN already lists a starting order.
  if (state === 'pre' && !isGolf && game?.raceDetails) {
    return <UpcomingRaceCard game={game} title={title} seriesName={seriesName} flags={flags} />
  }

  // Pre-race with no grid entries → simple upcoming card (golf and any league without race details)
  if (state === 'pre' && !hasEntries) {
    const timeText = game?.runtimeDateText
      || formatRuntimeDate(game)
      || String(game?.status?.shortDetail || '').trim()
    return (
      <div className={`card d-board ${dirClass} board-pre`}>
        <div className="board-head">
          <div className="board-titles">
            <span className="board-title">{title}</span>
            <span className="board-sub">{seriesName}</span>
          </div>
          <StateChip game={game} />
        </div>
        <div className="bpre-main">
          <div className="bpre-when">
            <span className="bpre-label">{isGolf ? 'TEE TIME' : 'STARTS'}</span>
            <span className="bpre-time">{timeText || '—'}</span>
            {game?.broadcastText && flags.tv
              ? <span className="bpre-tv">
                  {game.broadcastText.split(/\s*\/\s*/).filter(Boolean).map((n, i) => <NetworkLogo key={i} name={n} />)}
                </span>
              : null}
          </div>
        </div>
        <div className="board-foot">
          <MetaRow game={game} flags={{ ...flags, tv: false }} mono />
        </div>
      </div>
    )
  }

  // Finished NASCAR / F1 race with a full result -> podium card (winner biggest). NASCAR's margin / laps led
  // come from raceSummary when the weekend-feed lookup resolved; F1 just omits them.
  const podiumLeague = /nascar|^f1$/.test(String(game?.leagueId || '').toLowerCase())
  if (state === 'post' && !isGolf && podiumLeague && allEntries.length >= 3) {
    return <PodiumCard game={game} title={title} entries={allEntries} />
  }

  // Finished NASCAR race with weekend-feed enrichment (margin, laps led, starting position) →
  // winner gets a dedicated full-height spotlight zone instead of just another row. Falls
  // through to the generic rows layout below for golf, live/pre states, or whenever the
  // weekend-feed lookup didn't resolve (game.raceSummary absent) — same card either way.
  if (state === 'post' && !isGolf && game?.raceSummary && hasEntries) {
    const winnerEntry = displayEntries[0]
    const winner = {
      name: winnerEntry.shortName || winnerEntry.name || 'Driver',
      team: [winnerEntry.team, winnerEntry.carNumber ? `#${winnerEntry.carNumber}` : ''].filter(Boolean).join(' · '),
      color: entryColor(winnerEntry),
      headshot: winnerEntry.headshot ? (winnerEntry.headshot.startsWith('http') ? winnerEntry.headshot : `/logos/${winnerEntry.headshot}`) : null,
      carBadge: winnerEntry.carBadge ? (winnerEntry.carBadge.startsWith('http') ? winnerEntry.carBadge : `/logos/${winnerEntry.carBadge}`) : null,
      lapsLed: Number.isInteger(winnerEntry.lapsLed) ? winnerEntry.lapsLed : null,
      inChase: Boolean(winnerEntry.inChase),
    }
    const margin = formatRaceMargin(game.raceSummary.marginOfVictory)
    // Non-solo mode's generic entryLimit cap (6 total = winner + 5) always lands one over the
    // 4-row single-column capacity, which used to force unwanted compact "board-multi" styling
    // for what's still really just 1 column of 5. Hard-cap to 4 there instead; only a genuinely
    // solo slate with a big field needs the real multi-column grid below.
    const fieldRowsAll = (isSoloSlate ? displayEntries.slice(1) : displayEntries.slice(1, 5)).map((entry, i) => {
      const pos = entry.position ?? i + 2
      const startPos = Number.isInteger(entry.startPosition) ? entry.startPosition : null
      const delta = startPos != null ? startPos - pos : null
      return {
        pos,
        name: entry.shortName || entry.name || 'Driver',
        color: entryColor(entry),
        headshot: entry.headshot ? (entry.headshot.startsWith('http') ? entry.headshot : `/logos/${entry.headshot}`) : null,
        carBadge: entry.carBadge ? (entry.carBadge.startsWith('http') ? entry.carBadge : `/logos/${entry.carBadge}`) : null,
        delta,
        fallbackDetail: racingEntrySummary(entry) || String(entry?.score || ''),
        inChase: Boolean(entry.inChase),
      }
    })
    // Single column only fits 4 (confirmed empirically — 5 clipped the card's fixed 380px
    // height once the winner moved into its own zone). Once a solo slate shows the full field
    // (displayEntries is uncapped when isSoloSlate — see entryLimit above) reuse the exact
    // same multi-column grid the generic board below already uses, so a 36-car Cup field still
    // gets its full lineup instead of being silently truncated to 4.
    const FIELD_MAX_PER_COL_SOLO = 4
    const FIELD_MAX_PER_COL_GRID = 5
    const FIELD_MAX_COLS = 8
    const useFieldGrid = fieldRowsAll.length > FIELD_MAX_PER_COL_SOLO
    const fieldCols = useFieldGrid ? Math.min(FIELD_MAX_COLS, Math.ceil(fieldRowsAll.length / FIELD_MAX_PER_COL_GRID)) : 1
    const fieldPerCol = useFieldGrid
      ? Math.min(Math.ceil(fieldRowsAll.length / fieldCols), FIELD_MAX_PER_COL_GRID)
      : Math.min(fieldRowsAll.length, FIELD_MAX_PER_COL_SOLO)
    const fieldRows = fieldRowsAll.slice(0, fieldPerCol * fieldCols)
    const summaryParts = [
      game.raceSummary.totalRaceTime,
      Number.isInteger(game.raceSummary.numberOfCautions)
        ? `${game.raceSummary.numberOfCautions} CAUTION${game.raceSummary.numberOfCautions === 1 ? '' : 'S'}`
        : '',
      Number.isInteger(game.raceSummary.numberOfLeadChanges) ? `${game.raceSummary.numberOfLeadChanges} LEAD CHANGES` : '',
    ].filter(Boolean)

    return (
      <div className={`card d-board d-board-final ${dirClass} ${useFieldGrid ? 'board-multi' : ''}`}>
        <div className="winner-zone" style={{ '--rc': winner.color }}>
          <span className="winner-eyebrow">WINNER</span>
          <DriverImage
            headshot={winner.headshot} carBadge={winner.carBadge} color={winner.color} name={winner.name}
            hsClass="winner-hs" badgeClass="winner-badge" dotClass="winner-dot"
          />
          <span className="winner-name">{winner.name}{winner.inChase ? <i className="mdi mdi-trophy board-chase winner-chase" title="Playoff driver" /> : null}</span>
          {winner.team ? <span className="winner-team">{winner.team}</span> : null}
          {(margin || winner.lapsLed) ? (
            <div className="winner-stats">
              {margin ? <div className="winner-stat"><span className="l">Margin</span><span className="v">{margin}</span></div> : null}
              {winner.lapsLed ? <div className="winner-stat"><span className="l">Led</span><span className="v">{winner.lapsLed} laps</span></div> : null}
            </div>
          ) : null}
        </div>
        <div className="field-zone">
          <div className="board-head">
            <div className="board-titles">
              <span className="board-title">{title}</span>
              <span className="board-sub">RESULTS</span>
            </div>
            <StateChip game={game} />
          </div>
          <div
            className={`board-rows ${useFieldGrid ? 'cols-auto' : ''}`}
            style={useFieldGrid ? { gridTemplateRows: `repeat(${fieldPerCol}, 1fr)` } : undefined}
          >
            {fieldRows.map((r, i) => (
              <div key={i} className="board-row" style={{ '--rc': r.color }}>
                <span className="board-pos">{r.pos}</span>
                <DriverImage
                  headshot={r.headshot} carBadge={r.carBadge} color={r.color} name={r.name}
                  hsClass="board-hs" badgeClass="board-badge" dotClass="board-dot"
                />
                <span className="board-name">{r.name}</span>
                {r.inChase ? <i className="mdi mdi-trophy board-chase" title="Playoff driver" /> : null}
                {r.delta != null
                  ? <span className={`delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'even'}`}>
                      {r.delta > 0 ? `↑${r.delta}` : r.delta < 0 ? `↓${Math.abs(r.delta)}` : '—'}
                    </span>
                  : <span className="board-detail">{r.fallbackDetail}</span>}
              </div>
            ))}
          </div>
          {summaryParts.length ? (
            <div className="board-foot summary">
              {summaryParts.map((part, i) => (
                <span key={i} className="board-unit-group">
                  {i > 0 ? <span className="sep">·</span> : null}
                  <span className="board-unit">{part}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="board-foot"><MetaRow game={game} flags={flags} mono /></div>
          )}
        </div>
      </div>
    )
  }

  // Board with rows (live / post / pre+grid)
  const statusLabel = state === 'in'
    ? racingLiveHeader(game)
    : state === 'pre'
      ? (isGolf ? 'FIELD' : 'STARTING GRID')
      : 'RESULTS'

  const rows = displayEntries.map((entry, i) => ({
    pos: entry.position ?? i + 1,
    name: entry.shortName || entry.name || (isGolf ? 'Player' : 'Driver'),
    detail: isGolf
      ? (String(entry?.score || '').trim() || racingEntrySummary(entry))
      : (racingEntrySummary(entry) || String(entry?.score || '')),
    color: entryColor(entry),
    headshot: entry.headshot ? (entry.headshot.startsWith('http') ? entry.headshot : `/logos/${entry.headshot}`) : null,
    carBadge: entry.carBadge ? (entry.carBadge.startsWith('http') ? entry.carBadge : `/logos/${entry.carBadge}`) : null,
    // Playoff/chase driver — only ever set by the NASCAR backend enrichment, so this is a
    // no-op (never true) outside of a NASCAR playoff race.
    inChase: Boolean(entry.inChase),
  }))

  const MAX_PER_COL = 5
  const MAX_COLS = 8
  const cols = rows.length > MAX_PER_COL
    ? Math.min(MAX_COLS, Math.ceil(rows.length / MAX_PER_COL))
    : 1
  const perCol = Math.min(Math.ceil(rows.length / cols), MAX_PER_COL)
  const visibleRows = rows.slice(0, perCol * cols)
  const useGrid = cols > 1

  return (
    <div className={`card d-board ${dirClass} ${useGrid ? 'board-multi' : ''}`}>
      <div className="board-head">
        <div className="board-titles">
          <div className="board-title-row">
            <span className="board-title">{title}</span>
            {state === 'in' ? <FlagChip state={game?.flagState} /> : null}
          </div>
          <span className="board-sub">{statusLabel}</span>
        </div>
        <StateChip game={game} />
      </div>
      <div
        className={`board-rows ${useGrid ? 'cols-auto' : ''}`}
        style={useGrid ? { gridTemplateRows: `repeat(${perCol}, 1fr)` } : undefined}
      >
        {visibleRows.map((r, i) => (
          <div key={i} className={`board-row ${i === 0 ? 'leader' : ''} ${r.headshot ? 'has-hs' : r.carBadge ? 'has-badge' : ''}`} style={{ '--rc': r.color }}>
            <span className="board-pos">{r.pos}</span>
            <DriverImage
              headshot={r.headshot} carBadge={r.carBadge} color={r.color} name={r.name}
              hsClass="board-hs" badgeClass="board-badge" dotClass="board-dot"
            />
            <span className="board-name">{r.name}</span>
            {r.inChase ? <i className="mdi mdi-trophy board-chase" title="Playoff driver" /> : null}
            <span className="board-detail">{r.detail}</span>
          </div>
        ))}
      </div>
      {game?.isStartingOrder ? null : (
        <div className="board-foot">
          <MetaRow game={game} flags={flags} mono />
        </div>
      )}
    </div>
  )
}

// ── Top-level dispatcher ───────────────────────────────────────────────────

export default function WireframeCard({ game }) {
  const flags = densityFlags({ density: game?.density })
  const style = game?.cardStyle || 'slab'
  if (style === 'spine') return <SpineCard game={game} flags={flags} />
  if (style === 'digits') return <DigitsCard game={game} flags={flags} />
  if (style === 'marquee') return <MarqueeCard game={game} flags={flags} />
  return <SlabCard game={game} flags={flags} />
}
