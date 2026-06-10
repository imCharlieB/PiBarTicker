import { useState } from 'react'
import {
  densityFlags,
  formatRuntimeStatus,
  racingCardTitle,
  racingEntrySummary,
  formatRuntimeDate,
} from './cardHelpers.js'

// ── Shared helpers ─────────────────────────────────────────────────────────

function teamAbbr(team) {
  return String(team?.abbreviation || team?.name || '?').slice(0, 4).toUpperCase()
}

// Status text shown in the seam/clock slot
function statusText(game) {
  const state = String(game?.state || '').toLowerCase()
  if (state === 'pre') return game?.runtimeDateText || 'TBD'
  if (state === 'in') return formatRuntimeStatus(game) || 'LIVE'
  return '' // post — chip reads FINAL; score carries the result
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

function hasLiveFeature(game) {
  if (String(game?.state || '').toLowerCase() !== 'in') return false
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball' && game?.baseballLiveData && game?.isLiveFeatured) return true
  return Boolean(game?.situationText)
}

function LiveFeature({ game, compact }) {
  if (String(game?.state || '').toLowerCase() !== 'in') return null
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'baseball' && game?.baseballLiveData && game?.isLiveFeatured) {
    return <BaseballLive game={game} compact={compact} />
  }
  if (game?.situationText) {
    return <span className="sit-txt"><b>{game.situationText}</b></span>
  }
  return null
}

// ── Meta row (TV / venue / odds) ───────────────────────────────────────────

function MetaRow({ game, flags, mono }) {
  const items = []
  if (flags.tv && game?.broadcastText) items.push(['TV', game.broadcastText])
  if (flags.venue && game?.venueText) items.push(['AT', game.venueText])
  if (flags.odds && game?.oddsText) items.push(['ODDS', game.oddsText])
  if (!items.length) return null
  return (
    <div className={`meta ${mono ? 'meta-mono' : ''}`}>
      {items.map(([k, v], i) => (
        <span key={i} className="meta-i">
          {k ? <em>{k}</em> : null}{v}
        </span>
      ))}
    </div>
  )
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
  const showFeat = flags.situation && hasLiveFeature(game)

  const Half = ({ team, side }) => (
    <div className={`slab-half slab-${side}`}>
      <i className="slab-bar" style={{ background: `var(--bar-${side})` }} />
      <LogoBox team={team} side={side} size="lg" />
      <div className="slab-id">
        {team?.logo
          ? <span className="slab-abbr" style={{ color: `var(--txt-${side})` }}>{teamAbbr(team)}</span>
          : null}
        {flags.records && String(team?.record || '').trim()
          ? <span className="slab-rec">{team.record}</span>
          : null}
      </div>
      <ScoreOrDash team={team} game={game} />
    </div>
  )

  const st = statusText(game)
  return (
    <div className={`card d-slab ${showFeat ? 'has-feat' : ''}`}>
      <Half team={a} side="a" />
      <div className="slab-seam">
        <StateChip game={game} />
        {st ? <span className="slab-status">{st}</span> : null}
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

  const Flank = ({ team, side }) => (
    <div className={`spine-flank spine-${side}`}>
      <LogoBox team={team} side={side} size="xl" />
      {team?.logo ? <span className="spine-abbr">{teamAbbr(team)}</span> : null}
      {flags.records && String(team?.record || '').trim()
        ? <span className="spine-rec">{team.record}</span>
        : null}
    </div>
  )

  return (
    <div className="card d-spine">
      <Flank team={a} side="a" />
      <div className="spine-mid">
        <StateChip game={game} />
        <div className="spine-score">
          {isPre
            ? <span className="spine-vs">VS</span>
            : (<><b>{a?.score}</b><s>–</s><b>{h?.score}</b></>)}
        </div>
        <span className="spine-status">{statusText(game)}</span>
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

  return (
    <div className={`card d-marq ${showFeat ? 'has-feat' : ''}`}>
      <div className="marq-half marq-a">
        {a?.logo
          ? <LogoBox team={a} side="a" size="lg" />
          : <span className="marq-abbr">{teamAbbr(a)}</span>}
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
        {h?.logo
          ? <LogoBox team={h} side="h" size="lg" />
          : <span className="marq-abbr">{teamAbbr(h)}</span>}
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

  // Pre-race with no grid entries → simple upcoming card
  if (state === 'pre' && !hasEntries) {
    const timeText = game?.runtimeDateText
      || formatRuntimeDate(game)
      || String(game?.status?.shortDetail || '').trim()
    return (
      <div className="card d-board board-pre">
        <div className="board-head">
          <div className="board-titles">
            <span className="board-title">{title}</span>
            <span className="board-sub">{seriesName}</span>
          </div>
          <StateChip game={game} />
        </div>
        {timeText ? <div className="bpre-when"><span>{timeText}</span></div> : null}
        <div className="board-foot">
          {game?.broadcastText && flags.tv
            ? <span className="board-unit">{game.broadcastText}</span>
            : null}
          <MetaRow game={game} flags={flags} mono />
        </div>
      </div>
    )
  }

  // Board with rows (live / post / pre+grid)
  const statusLabel = state === 'in'
    ? (formatRuntimeStatus(game) || 'LIVE')
    : state === 'pre' ? 'STARTING GRID' : 'RESULTS'
  const unit = state === 'in' ? 'GAP' : state === 'pre' ? 'GRID' : 'RESULTS'

  const rows = displayEntries.map((entry, i) => ({
    pos: entry.position ?? i + 1,
    name: entry.shortName || entry.name || 'Driver',
    detail: racingEntrySummary(entry) || String(entry?.score || ''),
    color: '',
  }))

  const many = rows.length > 6
  const perCol = Math.ceil(rows.length / 2)

  return (
    <div className={`card d-board ${many ? 'board-wide' : ''}`}>
      <div className="board-head">
        <div className="board-titles">
          <span className="board-title">{title}</span>
          <span className="board-sub">{statusLabel}</span>
        </div>
        <StateChip game={game} />
      </div>
      <div
        className={`board-rows ${many ? 'cols2' : ''}`}
        style={many ? { gridTemplateRows: `repeat(${perCol}, 1fr)` } : undefined}
      >
        {rows.map((r, i) => (
          <div key={i} className={`board-row ${i === 0 ? 'leader' : ''}`}>
            <span className="board-pos">{r.pos}</span>
            <span className="board-name">{r.name}</span>
            <span className="board-detail">{r.detail}</span>
          </div>
        ))}
      </div>
      <div className="board-foot">
        <span className="board-unit">{unit}</span>
        <MetaRow game={game} flags={flags} mono />
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
