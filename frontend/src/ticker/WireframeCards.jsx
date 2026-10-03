import { useState, useEffect } from 'react'
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

// cf.nascar.com's race_list_basic schedule[] gives start_time_utc without a trailing "Z" or
// offset despite the name ("2026-10-03T20:30:00") — append one so Date doesn't read it as local.
function formatScheduleTime(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const hasTz = /Z$|[+-]\d\d:\d\d$/.test(s)
  const date = new Date(hasTz ? s : `${s}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date)
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

// ── BOARD (racing / golf) — replaces RacingCard ────────────────────────────

export function BoardCard({ game, isSoloSlate, renderLeague }) {
  const state = String(game?.state || '').toLowerCase()
  const sport = String(game?.sport || '').toLowerCase()
  const isGolf = sport === 'golf'
  const flags = densityFlags({ density: game?.density })

  const allEntries = Array.isArray(game?.racingEntries) ? game.racingEntries : []
  const entryLimit = Number.isInteger(renderLeague?.entryLimit) ? renderLeague.entryLimit : null
  const cappedEntries = entryLimit ? allEntries.slice(0, entryLimit) : allEntries
  const displayEntries = isSoloSlate ? cappedEntries : cappedEntries.slice(0, entryLimit ?? 6)

  const hasEntries = displayEntries.length > 0
  const title = racingCardTitle(game, renderLeague)
  const seriesName = String(renderLeague?.name || renderLeague?.id || (isGolf ? 'Tournament' : 'Race')).trim()
  const cs = game?.cardStyle
  const dirClass = cs && cs !== 'standard' && cs !== 'large-logo'
    ? `d-${cs === 'marquee' ? 'marq' : cs}`
    : 'd-slab'

  // Standings — a synthetic entry the backend appends right after the real race event for this
  // league (state: 'standings', never produced by ESPN/cf.nascar.com) so it plays immediately
  // next to it in the rotation. Reuses the exact same d-board-final layout as the finished-race
  // card: points leader gets the spotlight zone, the rest in the row-list/full-lineup grid.
  if (state === 'standings' && hasEntries) {
    const leaderEntry = displayEntries[0]
    const leader = {
      name: leaderEntry.shortName || leaderEntry.name || 'Driver',
      team: [leaderEntry.team, leaderEntry.carNumber ? `#${leaderEntry.carNumber}` : ''].filter(Boolean).join(' · '),
      color: entryColor(leaderEntry),
      headshot: leaderEntry.headshot ? (leaderEntry.headshot.startsWith('http') ? leaderEntry.headshot : `/logos/${leaderEntry.headshot}`) : null,
      carBadge: leaderEntry.carBadge ? (leaderEntry.carBadge.startsWith('http') ? leaderEntry.carBadge : `/logos/${leaderEntry.carBadge}`) : null,
      points: Number.isInteger(leaderEntry.points) ? leaderEntry.points : null,
    }
    // Same single-column-vs-grid split as the final card (4 fits one column on the real
    // 380px-tall card; more than that reuses the generic board's proven grid system). In
    // non-solo mode the generic entryLimit cap (6 total = leader + 5) always lands one over
    // SOLO_MAX, which used to force unwanted compact "board-multi" styling for just 5 rows in
    // what's still really 1 column. Hard-cap to SOLO_MAX there instead of letting the grid
    // math kick in at all — only a genuinely solo slate with a big field needs real columns.
    const SOLO_MAX = 4
    const GRID_MAX_PER_COL = 5
    const GRID_MAX_COLS = 8
    const fieldSource = isSoloSlate ? displayEntries.slice(1) : displayEntries.slice(1, 1 + SOLO_MAX)
    const fieldRowsAll = fieldSource.map((entry, i) => ({
      pos: entry.position ?? i + 2,
      name: entry.shortName || entry.name || 'Driver',
      color: entryColor(entry),
      headshot: entry.headshot ? (entry.headshot.startsWith('http') ? entry.headshot : `/logos/${entry.headshot}`) : null,
      carBadge: entry.carBadge ? (entry.carBadge.startsWith('http') ? entry.carBadge : `/logos/${entry.carBadge}`) : null,
      pointsGap: Number.isInteger(entry.pointsGap) ? entry.pointsGap : null,
    }))
    const useGrid = fieldRowsAll.length > SOLO_MAX
    const cols = useGrid ? Math.min(GRID_MAX_COLS, Math.ceil(fieldRowsAll.length / GRID_MAX_PER_COL)) : 1
    const perCol = useGrid
      ? Math.min(Math.ceil(fieldRowsAll.length / cols), GRID_MAX_PER_COL)
      : Math.min(fieldRowsAll.length, SOLO_MAX)
    const fieldRows = fieldRowsAll.slice(0, perCol * cols)

    return (
      <div className={`card d-board d-board-final ${dirClass} ${useGrid ? 'board-multi' : ''}`}>
        <div className="winner-zone" style={{ '--rc': leader.color }}>
          <span className="winner-eyebrow">POINTS LEADER</span>
          <DriverImage
            headshot={leader.headshot} carBadge={leader.carBadge} color={leader.color} name={leader.name}
            hsClass="winner-hs" badgeClass="winner-badge" dotClass="winner-dot"
          />
          <span className="winner-name">{leader.name}</span>
          {leader.team ? <span className="winner-team">{leader.team}</span> : null}
          {leader.points != null ? (
            <div className="winner-stats">
              <div className="winner-stat"><span className="l">Points</span><span className="v">{leader.points}</span></div>
            </div>
          ) : null}
        </div>
        <div className="field-zone">
          <div className="board-head">
            <div className="board-titles">
              <span className="board-title">{title}</span>
              <span className="board-sub">STANDINGS</span>
            </div>
            {game?.isPlayoffs ? <span className="chip chip-standings">PLAYOFFS</span> : null}
          </div>
          <div
            className={`board-rows ${useGrid ? 'cols-auto' : ''}`}
            style={useGrid ? { gridTemplateRows: `repeat(${perCol}, 1fr)` } : undefined}
          >
            {fieldRows.map((r, i) => (
              <div key={i} className="board-row" style={{ '--rc': r.color }}>
                <span className="board-pos">{r.pos}</span>
                <DriverImage
                  headshot={r.headshot} carBadge={r.carBadge} color={r.color} name={r.name}
                  hsClass="board-hs" badgeClass="board-badge" dotClass="board-dot"
                />
                <span className="board-name">{r.name}</span>
                {r.pointsGap != null ? <span className="delta pts">{r.pointsGap}</span> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Pre-race with no grid entries → simple upcoming card
  if (state === 'pre' && !hasEntries) {
    const timeText = game?.runtimeDateText
      || formatRuntimeDate(game)
      || String(game?.status?.shortDetail || '').trim()
    const circuitImg = String(game?.circuitImage || '').trim()
    const circuitName = String(game?.circuitName || '').trim()
    // NASCAR-only in practice (raceDetails is only ever set by the NASCAR backend enrichment),
    // and only when there's no circuit image — F1 always has one, so it never reaches this
    // branch and its board-pre-circuit layout/width is completely unaffected.
    const raceDetails = !circuitImg ? game?.raceDetails : null
    return (
      <div className={`card d-board ${dirClass} board-pre ${circuitImg ? 'board-pre-circuit' : ''} ${raceDetails ? 'board-pre-nascar' : ''}`}>
        <div className="board-head">
          <div className="board-titles">
            <span className="board-title">{title}</span>
            <span className="board-sub">{circuitName || seriesName}</span>
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
          {circuitImg ? (
            <div className="bpre-circuit" id={`bpre-c-${game?.gameId}`}>
              <img
                src={circuitImg}
                alt="Circuit map"
                className="bpre-circuit-img"
                onError={(e) => { e.currentTarget.closest('.bpre-circuit')?.remove() }}
              />
            </div>
          ) : raceDetails ? (
            <div className="bpre-nascar">
              <div className="bn-top">
                <div className="bn-facts">
                  {raceDetails.trackName ? <b>{raceDetails.trackName}</b> : null}
                  {raceDetails.scheduledDistance ? <><span className="dot">·</span><span>{raceDetails.scheduledDistance} mi</span></> : null}
                  {raceDetails.scheduledLaps ? <><span className="dot">·</span><span>{raceDetails.scheduledLaps} laps</span></> : null}
                  {raceDetails.numberOfCarsInField ? <><span className="dot">·</span><span>{raceDetails.numberOfCarsInField} cars</span></> : null}
                </div>
              </div>
              {(raceDetails.stage1Laps || raceDetails.stage2Laps || raceDetails.stage3Laps) ? (
                <div className="bn-stages">
                  {raceDetails.stage1Laps ? <div className="bn-stage" style={{ flexGrow: raceDetails.stage1Laps }}>STAGE 1 · {raceDetails.stage1Laps}</div> : null}
                  {raceDetails.stage2Laps ? <div className="bn-stage" style={{ flexGrow: raceDetails.stage2Laps }}>STAGE 2 · {raceDetails.stage2Laps}</div> : null}
                  {raceDetails.stage3Laps ? <div className="bn-stage" style={{ flexGrow: raceDetails.stage3Laps }}>STAGE 3 · {raceDetails.stage3Laps}</div> : null}
                </div>
              ) : null}
              {Array.isArray(raceDetails.schedule) && raceDetails.schedule.length ? (
                <div className="bn-sched">
                  {raceDetails.schedule.map((s, i) => (
                    <div key={i} className="bn-sched-row">
                      <span className="bn-sched-label">{s.label}</span>
                      <span className="bn-sched-time">{formatScheduleTime(s.startTimeUtc)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {raceDetails.lastRaceWinner ? (
                <div className="bn-last">Last race: <b>{raceDetails.lastRaceWinner}</b> won at {raceDetails.lastRaceTrack}</div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="board-foot">
          <MetaRow game={game} flags={{ ...flags, tv: false }} mono />
        </div>
      </div>
    )
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
      <div className="board-foot">
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
