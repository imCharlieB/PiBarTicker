// ── Pure data helpers (exported) ─────────────────────────────────────────────

export function parseLeagueApiParams(scoreboardUrl) {
  const match = String(scoreboardUrl || '').match(/\/sports\/([^/]+)\/([^/]+)\/scoreboard/i)
  if (!match) return { sport: 'football', league: '' }
  return { sport: match[1], league: match[2] }
}

export function isIndividualSport(sport, leagueSlug) {
  const s = (sport || '').toLowerCase()
  const l = (leagueSlug || '').toLowerCase()
  return (
    s === 'racing' || s === 'motorsports' || s === 'golf' || s === 'mma' || s === 'boxing' || s === 'tennis' ||
    /racing|motorsport|motogp|nascar|indy|indycar|wec|imsa|supercars|rally|f1|formula/.test(l)
  )
}

export function resolveLeagueLogo(league) {
  const explicitLogo = String(league?.logo || '').trim()
  if (explicitLogo) return explicitLogo
  const leagueId = String(league?.id || '').trim().toLowerCase()
  if (!leagueId) return ''
  return `https://a.espncdn.com/i/teamlogos/leagues/500/${leagueId}.png`
}

export function splitTeamLogosForDisplay(logos, leagueId) {
  const safeLogos = Array.isArray(logos) ? logos.filter((logo) => logo?.href) : []
  const leagueToken = String(leagueId || '').trim().toLowerCase()
  if (leagueToken !== 'nfl') return { primary: safeLogos, extras: [] }
  const primary = safeLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: primary.length ? primary : safeLogos,
    extras: primary.length
      ? safeLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

export function getRelaxedGameFilter(originalFilter) {
  const f = String(originalFilter || 'all').toLowerCase()
  if (f === 'live' || f === 'today' || f === 'this-week') return 'upcoming'
  return 'all'
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function buildEspnProxyUrl(targetUrl, cacheTtlSeconds = 120) {
  const params = new URLSearchParams({
    url: targetUrl,
    cache_ttl_seconds: String(cacheTtlSeconds),
  })
  return `/api/v1/espn/proxy?${params.toString()}`
}

function toLeagueTeamsEndpoint(scoreboardUrl) {
  if (!scoreboardUrl) return ''
  try {
    const parsed = new URL(scoreboardUrl)
    parsed.pathname = parsed.pathname.replace(/\/scoreboard$/i, '/teams')
    parsed.searchParams.set('limit', '1000')
    return parsed.toString()
  } catch {
    const base = scoreboardUrl.replace(/\/scoreboard(?:\?.*)?$/i, '/teams')
    return `${base}${base.includes('?') ? '&' : '?'}limit=1000`
  }
}

function selectTrustedTeamLogos(team, leagueId) {
  const rawLogos = Array.isArray(team?.logos)
    ? team.logos.filter((logo) => logo?.href)
    : team?.logo
      ? [{ href: team.logo, alt: team.displayName || team.name || team.abbreviation }]
      : []

  if (!rawLogos.length) return { primary: [], extras: [] }

  const leagueToken = String(leagueId || '').trim().toLowerCase()
  if (leagueToken !== 'nfl') return { primary: rawLogos, extras: [] }

  const canonical = rawLogos.filter((logo) => String(logo.href).toLowerCase().includes('/i/teamlogos/'))
  return {
    primary: canonical.length ? canonical : rawLogos,
    extras: canonical.length
      ? rawLogos.filter((logo) => !String(logo.href).toLowerCase().includes('/i/teamlogos/'))
      : [],
  }
}

function normalizeTeamDataFromTeamsEndpoint(payload) {
  const teams = []
  const league = payload?.sports?.[0]?.leagues?.[0]
  const leagueTeams = league?.teams || []
  const leagueId = league?.abbreviation || league?.id || ''

  for (const entry of leagueTeams) {
    const team = entry?.team
    if (!team?.id) continue
    const trustedLogos = selectTrustedTeamLogos(team, leagueId)
    teams.push({
      id: team.id,
      name: team.displayName || team.shortDisplayName || team.name || team.abbreviation,
      shortName: team.shortDisplayName || team.abbreviation || team.name,
      abbreviation: team.abbreviation || '',
      location: team.location || '',
      color: team.color || '',
      alternateColor: team.alternateColor || '',
      logos: trustedLogos.primary,
      extraLogos: trustedLogos.extras,
    })
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeTeamDataFromScoreboard(payload) {
  const teams = new Map()
  const events = Array.isArray(payload?.events) ? payload.events : []

  for (const event of events) {
    const competitions = Array.isArray(event?.competitions) ? event.competitions : []
    for (const competition of competitions) {
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : []
      for (const competitor of competitors) {
        const team = competitor?.team || {}
        const athlete = competitor?.athlete || {}
        const entity = team.id ? team : athlete.id ? athlete : null
        if (!entity || !entity.id) continue

        const isAthlete = !team.id && !!athlete.id
        let incomingLogos = Array.isArray(entity.logos)
          ? entity.logos
          : entity.logo
            ? [{ href: entity.logo, alt: entity.displayName || entity.name || entity.abbreviation }]
            : []

        if (incomingLogos.length === 0 && entity.flag?.href) {
          incomingLogos = [{ href: entity.flag.href, alt: entity.flag.alt || entity.displayName || 'Flag' }]
        }

        const existing = teams.get(entity.id)
        if (existing) {
          const knownHrefs = new Set(existing.logos.map((logo) => logo.href))
          const mergedLogos = [
            ...existing.logos,
            ...incomingLogos.filter((logo) => logo?.href && !knownHrefs.has(logo.href)),
          ]
          teams.set(entity.id, { ...existing, logos: mergedLogos })
          continue
        }

        teams.set(entity.id, {
          id: entity.id,
          name: entity.displayName || entity.shortDisplayName || entity.name || entity.abbreviation,
          shortName: entity.shortDisplayName || entity.abbreviation || entity.name,
          abbreviation: entity.abbreviation || '',
          location: entity.location || '',
          color: entity.color || '',
          alternateColor: entity.alternateColor || '',
          logos: incomingLogos.filter((logo) => logo?.href),
          _isAthlete: isAthlete,
        })
      }
    }
  }
  return Array.from(teams.values()).sort((a, b) => a.name.localeCompare(b.name))
}

const API_NATIVE_SPORT_FILTERS = new Set([
  'football', 'basketball', 'baseball', 'hockey', 'soccer',
  'golf', 'tennis', 'cricket', 'rugby', 'lacrosse',
])

function buildTickerScoreboardQuery(league, {
  cacheTtlSeconds = 60,
  gameFilterOverride = null,
  useWeekFilterOverride = null,
} = {}) {
  const params = parseLeagueApiParams(league?.url || '')
  const resolvedLeague = String(params.league || league?.id || '').trim()
  const resolvedSport = String(params.sport || '').trim()
  const query = new URLSearchParams({
    league: resolvedLeague,
    cache_ttl_seconds: String(cacheTtlSeconds),
  })

  if (resolvedSport) query.set('sport', resolvedSport)
  if (params.sport) query.set('sport', params.sport)

  const effectiveGameFilter = gameFilterOverride ?? league?.gameFilter ?? 'all'
  if (effectiveGameFilter && effectiveGameFilter !== 'all') {
    query.set('game_filter', effectiveGameFilter)
  }

  const effectiveUseWeek = useWeekFilterOverride ?? league?.useWeekFilter ?? false
  if (effectiveUseWeek) query.set('use_week_filter', 'true')

  if (gameFilterOverride !== 'all') {
    const includedTeams = Array.isArray(league?.includedTeams) ? league.includedTeams : []
    if (includedTeams.length) query.set('included_teams', includedTeams.join(','))

    const includedGroups = Array.isArray(league?.includedGroups) ? league.includedGroups : []
    if (includedGroups.length) query.set('included_groups', includedGroups.join(','))
  }

  return query.toString()
}

// ── Exported fetch functions ─────────────────────────────────────────────────

export async function harvestRacingEntities(league) {
  const entities = new Map()

  try {
    const teamsUrl = toLeagueTeamsEndpoint(league.url)
    const resp = await fetch(buildEspnProxyUrl(teamsUrl, 300))
    if (resp.ok) {
      const data = await resp.json()
      const fromTeams = normalizeTeamDataFromTeamsEndpoint(data)
      for (const t of fromTeams) {
        entities.set(String(t.id), { ...t, _source: 'teams' })
      }
    }
  } catch (e) {
    console.warn('harvestRacingEntities: teams endpoint failed', e)
  }

  const params = parseLeagueApiParams(league.url || '')
  const leagueSlugForHarvest = (params.league || String(league.id || '')).toLowerCase()
  const isF1ForHarvest = /f1|formula/.test(leagueSlugForHarvest)

  if (!isF1ForHarvest) {
    try {
      const sbResp = await fetch(buildEspnProxyUrl(league.url, 60))
      if (sbResp.ok) {
        const sbData = await sbResp.json()
        const fromScoreboard = normalizeTeamDataFromScoreboard(sbData)
        for (const e of fromScoreboard) {
          if (!entities.has(String(e.id))) {
            entities.set(String(e.id), { ...e, _source: 'scoreboard-athlete' })
          }
        }
      }
    } catch (e) {
      console.warn('harvestRacingEntities: scoreboard harvest failed', e)
    }
  }

  try {
    const p = parseLeagueApiParams(league.url || '')
    const sport = p.sport || 'racing'
    const leagueSlug = p.league || String(league.id || '').toLowerCase()

    if (!/f1|formula/.test(leagueSlug) && (sport === 'racing' || /racing|motorsport|nascar|indycar/.test(leagueSlug))) {
      const standingsUrl = league.url
        .replace('/scoreboard', '/standings')
        .replace('site.api.espn.com/apis/site/v2/sports', 'site.api.espn.com/apis/v2/sports')

      const stResp = await fetch(buildEspnProxyUrl(standingsUrl, 300))
      if (stResp.ok) {
        const stData = await stResp.json()
        const children = stData?.children || stData?.standings?.children || []
        for (const child of children) {
          const entries = child?.standings?.entries || child?.entries || []
          for (const entry of entries) {
            const athlete = entry?.athlete || entry?.team || {}
            if (athlete.id) {
              const existing = entities.get(String(athlete.id))
              if (!existing) {
                entities.set(String(athlete.id), {
                  id: athlete.id,
                  name: athlete.displayName || athlete.fullName || athlete.name,
                  shortName: athlete.shortName || athlete.abbreviation,
                  abbreviation: athlete.abbreviation || '',
                  logos: athlete.logos || [],
                  _source: 'standings',
                })
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('harvestRacingEntities: standings harvest failed (non-fatal)', e)
  }

  return Array.from(entities.values())
}

export async function fetchLogoMeta(leagueId) {
  const res = await fetch(`/api/v1/logos/meta/${encodeURIComponent(leagueId)}`)
  if (!res.ok) throw new Error(`Logo meta fetch failed with ${res.status}`)
  return res.json()
}

export async function fetchLeagueScoreboard(league, {
  cacheTtlSeconds = 60,
  gameFilterOverride = null,
  useWeekFilterOverride = null,
} = {}) {
  const query = buildTickerScoreboardQuery(league, { cacheTtlSeconds, gameFilterOverride, useWeekFilterOverride })
  const response = await fetch(`/api/v1/espn/scoreboard?${query}`)
  if (!response.ok) throw new Error(`Ticker fetch failed with ${response.status}`)
  return response.json()
}

export async function fetchLeagueTeams(league) {
  const params = parseLeagueApiParams(league.url)
  const isRacingOrIndividual = isIndividualSport(params.sport, params.league)
  const teamsUrl = toLeagueTeamsEndpoint(league.url)
  const response = await fetch(buildEspnProxyUrl(teamsUrl, 300))
  if (!response.ok) throw new Error(`Teams fetch failed with ${response.status}`)

  const payload = await response.json()
  let teams = normalizeTeamDataFromTeamsEndpoint(payload)

  if (isRacingOrIndividual) {
    try {
      const racingEntities = await harvestRacingEntities(league)
      if (racingEntities.length > 0) {
        const byId = new Map(teams.map((t) => [String(t.id), t]))
        for (const ent of racingEntities) {
          const key = String(ent.id)
          if (!byId.has(key)) {
            byId.set(key, ent)
          } else {
            const existing = byId.get(key)
            if ((ent.logos || []).length > (existing.logos || []).length) {
              byId.set(key, { ...existing, ...ent })
            }
          }
        }
        teams = Array.from(byId.values())
      }
    } catch (e) {
      console.warn('harvestRacingEntities failed (non-fatal)', e)
    }
  } else if (!teams.length) {
    try {
      const scoreboardResponse = await fetch(buildEspnProxyUrl(league.url, 60))
      if (scoreboardResponse.ok) {
        const scoreboardPayload = await scoreboardResponse.json()
        teams = normalizeTeamDataFromScoreboard(scoreboardPayload)
      }
    } catch (e) {
      console.warn('Athlete harvest from scoreboard failed (non-fatal)', e)
    }
  }

  if (!teams.length) {
    const scoreboardResponse = await fetch(buildEspnProxyUrl(league.url, 60))
    if (!scoreboardResponse.ok) throw new Error(`Fallback scoreboard fetch failed with ${scoreboardResponse.status}`)
    const scoreboardPayload = await scoreboardResponse.json()
    teams = normalizeTeamDataFromScoreboard(scoreboardPayload)
  }

  return teams
}

export async function fetchLeagueGroups(league) {
  const params = parseLeagueApiParams(league.url)
  if (!params.league) throw new Error('No league slug in URL')
  const query = new URLSearchParams({ sport: params.sport, league: params.league, cache_ttl_seconds: '300' })
  const response = await fetch(`/api/v1/espn/league-groups?${query.toString()}`)
  if (!response.ok) throw new Error(`League groups fetch failed with ${response.status}`)
  const payload = await response.json()
  return Array.isArray(payload?.groups) ? payload.groups : []
}

export async function fetchTeamLogos(league, team) {
  const params = parseLeagueApiParams(league.url)
  if (!params.league) throw new Error('No league slug in URL')
  const query = new URLSearchParams({
    sport: params.sport,
    league: params.league,
    team: String(team.id),
    cache_ttl_seconds: '300',
  })
  const response = await fetch(`/api/v1/espn/team-logos?${query.toString()}`)
  if (!response.ok) throw new Error(`Team logos fetch failed with ${response.status}`)
  const payload = await response.json()
  return {
    logos: splitTeamLogosForDisplay(payload?.logos || [], league.id),
    teamProfile: payload?.teamProfile || null,
  }
}

export async function fetchLeagueCatalog(sport) {
  const requestedSportRaw = (sport || '').trim().toLowerCase()
  const requestedSport = API_NATIVE_SPORT_FILTERS.has(requestedSportRaw) ? requestedSportRaw : ''
  const params = new URLSearchParams({ cache_ttl_seconds: '600' })
  if (requestedSport) params.set('sport', requestedSport)
  const response = await fetch(`/api/v1/espn/discover-leagues?${params.toString()}`)
  if (!response.ok) throw new Error(`League discovery failed with ${response.status}`)
  const payload = await response.json()
  return Array.isArray(payload?.leagues) ? payload.leagues : []
}

export async function enrichTeamsWithRichLogos(league, basicTeams, onProgress) {
  if (!league || !Array.isArray(basicTeams) || basicTeams.length === 0) return basicTeams
  const params = parseLeagueApiParams(league.url || '')
  const sport = params.sport || ''
  const leagueSlug = params.league || String(league.id || '').toLowerCase()
  if (sport !== 'football' && !isIndividualSport(sport, leagueSlug)) return basicTeams

  const total = basicTeams.length
  console.log(`[logo-enrich] Starting rich logo fetch for ${leagueSlug} (${total} teams)`)
  const enriched = [...basicTeams]

  for (let i = 0; i < enriched.length; i++) {
    const team = enriched[i]
    if (onProgress) onProgress(league.id, leagueSlug, i + 1, total)
    try {
      const url = `/api/v1/espn/team-logos?team=${encodeURIComponent(team.id)}&league=${encodeURIComponent(leagueSlug)}&sport=${sport}&cache_ttl_seconds=600`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const richLogos = Array.isArray(data?.logos) ? data.logos.filter((l) => l?.href) : []
        if (richLogos.length > 0) {
          enriched[i] = {
            ...team,
            logos: richLogos,
            color: data?.teamProfile?.color || team.color || '',
            alternateColor: data?.teamProfile?.alternateColor || team.alternateColor || '',
          }
        }
      }
    } catch (err) {
      console.warn(`[logo-enrich] Failed to get rich logos for ${team.abbreviation || team.id}`, err)
    }
    await new Promise((r) => setTimeout(r, 140))
  }

  return enriched
}

export async function fetchExtrasForTeam(league, team, alreadyLoaded) {
  const params = parseLeagueApiParams(league.url || '')
  const teamId = String(team.id)
  let richLogos = []

  if (alreadyLoaded) {
    const fromLoaded = (alreadyLoaded.primary || []).concat(alreadyLoaded.extras || [])
    if (Array.isArray(fromLoaded)) richLogos.push(...fromLoaded)
  }

  if (params.league) {
    try {
      const query = new URLSearchParams({
        sport: params.sport || '',
        league: params.league,
        team: teamId,
        cache_ttl_seconds: '60',
      })
      const detailRes = await fetch(`/api/v1/espn/team-logos?${query.toString()}`)
      if (detailRes.ok) {
        const detail = await detailRes.json()
        const fromDetail = detail?.logos || (detail?.teamProfile && detail.teamProfile.logos) || []
        if (Array.isArray(fromDetail)) richLogos.push(...fromDetail)
      }
    } catch (e) { /* ignore 404s */ }

    try {
      const teamsUrl = `/api/v1/espn/teams?sport=${encodeURIComponent(params.sport || '')}&league=${encodeURIComponent(params.league)}&cache_ttl_seconds=300`
      const teamsRes = await fetch(teamsUrl)
      if (teamsRes.ok) {
        const teamsPayload = await teamsRes.json()
        const allTeams = teamsPayload?.sports?.[0]?.leagues?.[0]?.teams || []
        const match = allTeams.find((t) => {
          const teamObj = t?.team || t
          return String(teamObj?.id) === teamId ||
            String(teamObj?.abbreviation || '').toUpperCase() === String(team.abbreviation || '').toUpperCase()
        })
        if (match) {
          const teamObj = match?.team || match
          const fromList = teamObj?.logos || []
          if (Array.isArray(fromList)) richLogos.push(...fromList)
        }
      }
    } catch (e) { /* ignore */ }
  }

  const seenHrefs = new Set()
  const combined = []
  for (const l of richLogos) {
    if (l?.href && !seenHrefs.has(l.href)) {
      seenHrefs.add(l.href)
      combined.push(l)
    }
  }

  return combined.length > 0 ? combined : (Array.isArray(team.logos) ? team.logos.filter((l) => l?.href) : [])
}

export async function postLogoCache(leagueId, teams) {
  await fetch(`/api/v1/logos/cache/${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(teams),
  })
}

export async function postTeamLogoCache(leagueId, teamId, payload) {
  const res = await fetch(
    `/api/v1/logos/cache/${encodeURIComponent(leagueId)}/team/${encodeURIComponent(teamId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  )
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`server error ${res.status}${txt ? ': ' + txt.slice(0, 200) : ''}`)
  }
}
