import { useState } from 'react'
import {
  densityFlags,
  formatRuntimeStatus,
  racingCardTitle,
  racingEntrySummary,
  racingLiveHeader,
  formatRuntimeDate,
} from './cardHelpers.js'

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
  'USA':                 '/logos/networks/usa.png',
  'ALTITUDE':            '/logos/networks/altitude.png',
  'ALTITUDE SPORTS':     '/logos/networks/altitude.png',
  'BALLY SPORTS':        '/logos/networks/ballysports.png',
  'LONGHORN NETWORK':    '/logos/networks/longhorn.png',
  'LHN':                 '/logos/networks/longhorn.png',
  'PAC-12 NETWORK':      '/logos/networks/pac12.png',
  'PAC-12':              '/logos/networks/pac12.png',
  'P12':                 '/logos/networks/pac12.png',
  'DAZN':                '/logos/networks/dazn.png',
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
      </div>
      <div className="sc-sub">
        <span>SHOTS {sl.shots?.a ?? 0}–{sl.shots?.h ?? 0}</span>
        {(sl.corners?.a != null) ? <span>CORNERS {sl.corners.a}–{sl.corners.h}</span> : null}
      </div>
    </div>
  )
}

function hasLiveFeature(game) {
  if (String(game?.state || '').toLowerCase() !== 'in') return false
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball' && game?.baseballLiveData && game?.isLiveFeatured) return true
  if (sport === 'soccer' && game?.soccerLiveData && game?.isLiveFeatured) return true
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
          <span key={i} className="meta-i">
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
  const showFeat = flags.situation && hasLiveFeature(game)
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

  const Half = ({ team, side }) => {
    const spread = side === 'a' ? aSpread : hSpread
    return (
      <div className={`slab-half slab-${side}`}>
        <i className="slab-bar" style={{ background: `var(--bar-${side})` }} />
        <div className="slab-logo-group">
          <LogoBox team={team} side={side} size="lg" />
          {flags.records && String(team?.record || '').trim()
            ? <span className="slab-rec">{team.record}</span>
            : null}
          {spread ? <span className="slab-spread">{spread}</span> : null}
        </div>
        {!isPre ? <ScoreOrDash team={team} game={game} /> : null}
      </div>
    )
  }

  const st = statusText(game)
  const { date, time } = isPre ? splitDateTime(st) : { date: st, time: '' }
  return (
    <div className={`card d-slab ${showFeat ? 'has-feat' : ''} ${isPre ? 'is-pre' : ''}`}>
      <Half team={a} side="a" />
      <div className="slab-seam">
        <StateChip game={game} />
        {date ? <span className="slab-status">{date}</span> : null}
        {time ? <span className="slab-time">{time}</span> : null}
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
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

  const Flank = ({ team, side }) => {
    const spread = side === 'a' ? aSpread : hSpread
    return (
      <div className={`spine-flank spine-${side}`}>
        <div className="spine-logo-group">
          <LogoBox team={team} side={side} size="xl" />
          {flags.records && String(team?.record || '').trim()
            ? <span className="spine-rec">{team.record}</span>
            : null}
          {spread ? <span className="spine-spread">{spread}</span> : null}
        </div>
      </div>
    )
  }

  const st = statusText(game)
  const { date, time } = isPre ? splitDateTime(st) : { date: st, time: '' }
  return (
    <div className={`card d-spine ${isPre ? 'is-pre' : ''}`}>
      <Flank team={a} side="a" />
      <div className="spine-mid">
        <StateChip game={game} />
        <div className="spine-score">
          {isPre
            ? <span className="spine-vs">VS</span>
            : (<><b>{a?.score}</b><s>–</s><b>{h?.score}</b></>)}
        </div>
        {date ? <span className="spine-status">{date}</span> : null}
        {time ? <span className="spine-time">{time}</span> : null}
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
  const showFeat = flags.situation && hasLiveFeature(game)

  const Row = ({ team, side }) => (
    <div className={`dig-row dig-${side}`}>
      <i className="dig-strip" style={{ background: `var(--bar-${side})` }} />
      <LogoBox team={team} side={side} size="sm" />
      {team?.logo ? <span className="dig-abbr">{teamAbbr(team)}</span> : null}
      {flags.records && String(team?.record || '').trim()
        ? <span className="dig-rec">{team.record}</span>
        : null}
      <span className="dig-box">{isPre ? '·' : (team?.score ?? '—')}</span>
    </div>
  )

  return (
    <div className="card d-digits">
      <div className="dig-head">
        <span className="dig-league">{game?.leagueName || ''}</span>
        <StateChip game={game} />
        <span className="dig-clock">{statusText(game)}</span>
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
  const showFeat = flags.situation && hasLiveFeature(game)
  const sport = String(game?.sport || '').toLowerCase()
  const aSpread = teamSpread(game?.oddsText, teamAbbr(a))
  const hSpread = teamSpread(game?.oddsText, teamAbbr(h))

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
        <span className="marq-score">{isPre ? '' : (a?.score ?? '')}</span>
      </div>
      <div className={`marq-seam ${showFeat ? `marq-seam-${sport}` : ''}`}>
        <StateChip game={game} />
        <span className="marq-clock">{statusText(game)}</span>
        {showFeat ? <LiveFeature game={game} compact /> : null}
        <MetaRow game={game} flags={flags} />
      </div>
      <div className="marq-half marq-h">
        <span className="marq-score">{isPre ? '' : (h?.score ?? '')}</span>
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

// ── BOARD (racing / golf) — replaces RacingCard ────────────────────────────

export function BoardCard({ game, isSoloSlate, renderLeague }) {
  const state = String(game?.state || '').toLowerCase()
  const flags = densityFlags({ density: game?.density })

  const allEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
  const entryLimit = Number.isInteger(renderLeague?.entryLimit) ? renderLeague.entryLimit : null
  const cappedEntries = entryLimit ? allEntries.slice(0, entryLimit) : allEntries
  const displayEntries = isSoloSlate ? cappedEntries : cappedEntries.slice(0, entryLimit ?? 6)

  const hasEntries = displayEntries.length > 0
  const title = racingCardTitle(game, renderLeague)
  const seriesName = String(renderLeague?.name || renderLeague?.id || 'Race').trim()
  const cs = game?.cardStyle
  const dirClass = cs && cs !== 'standard' && cs !== 'large-logo'
    ? `d-${cs === 'marquee' ? 'marq' : cs}`
    : 'd-slab'

  // Pre-race with no grid entries → simple upcoming card
  if (state === 'pre' && !hasEntries) {
    const timeText = game?.runtimeDateText
      || formatRuntimeDate(game)
      || String(game?.status?.shortDetail || '').trim()
    const circuitImg = String(game?.circuitImage || '').trim()
    const circuitName = String(game?.circuitName || '').trim()
    return (
      <div className={`card d-board ${dirClass} board-pre ${circuitImg ? 'board-pre-circuit' : ''}`}>
        <div className="board-head">
          <div className="board-titles">
            <span className="board-title">{title}</span>
            <span className="board-sub">{circuitName || seriesName}</span>
          </div>
          <StateChip game={game} />
        </div>
        <div className="bpre-main">
          <div className="bpre-when">
            <span className="bpre-label">STARTS</span>
            <span className="bpre-time">{timeText || '—'}</span>
            {game?.broadcastText && flags.tv
              ? <span className="bpre-tv"><em>TV</em>{game.broadcastText}</span>
              : null}
          </div>
          {circuitImg ? (
            <div className="bpre-circuit" id={`bpre-c-${game?.gameId}`}>
              <img
                src={circuitImg}
                alt="Circuit map"
                className="bpre-circuit-img"
                onError={(e) => { e.currentTarget.closest('.bpre-circuit')?.remove() }}
              />
            </div>
          ) : null}
        </div>
        <div className="board-foot">
          <MetaRow game={game} flags={{ ...flags, tv: false }} mono />
        </div>
      </div>
    )
  }

  // Board with rows (live / post / pre+grid)
  const statusLabel = state === 'in'
    ? racingLiveHeader(game)
    : state === 'pre' ? 'STARTING GRID' : 'RESULTS'
  const unit = state === 'in' ? 'GAP' : state === 'pre' ? 'GRID' : 'RESULTS'

  const rows = displayEntries.map((entry, i) => ({
    pos: entry.position ?? i + 1,
    name: entry.shortName || entry.name || 'Driver',
    detail: racingEntrySummary(entry) || String(entry?.score || ''),
    color: entryColor(entry),
    headshot: entry.headshot ? (entry.headshot.startsWith('http') ? entry.headshot : `/logos/${entry.headshot}`) : null,
    carBadge: entry.carBadge ? (entry.carBadge.startsWith('http') ? entry.carBadge : `/logos/${entry.carBadge}`) : null,
  }))

  const MAX_PER_COL = 7
  const MAX_COLS = 6
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
          <span className="board-title">{title}</span>
          <span className="board-sub">{statusLabel}</span>
        </div>
        <StateChip game={game} />
        {state === 'in' ? <FlagChip state={game?.flagState} /> : null}
      </div>
      <div
        className={`board-rows ${useGrid ? 'cols-auto' : ''}`}
        style={useGrid ? { gridTemplateRows: `repeat(${perCol}, 1fr)` } : undefined}
      >
        {visibleRows.map((r, i) => (
          <div key={i} className={`board-row ${i === 0 ? 'leader' : ''} ${r.headshot ? 'has-hs' : r.carBadge ? 'has-badge' : ''}`} style={{ '--rc': r.color }}>
            <span className="board-pos">{r.pos}</span>
            {r.headshot
              ? <img className="board-hs" src={r.headshot} alt={r.name} />
              : r.carBadge
                ? <img className="board-badge" src={r.carBadge} alt={r.name} />
                : <span className="board-dot" style={{ background: r.color }} />}
            <span className="board-name">{r.name}</span>
            <span className="board-detail">{r.detail}</span>
          </div>
        ))}
      </div>
      <div className="board-foot">
        <span className="board-unit">{unit}</span>
        <MetaRow game={game} flags={{ ...flags, tv: false }} mono />
      </div>
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
