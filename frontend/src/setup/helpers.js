export function parseList(value) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function listToText(items) {
  return items.join('\n')
}

export function pickerValue(value, fallback) {
  return value && value.trim() ? value : fallback
}

export function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

export function isHttpUrl(value) {
  if (!value || !value.trim()) {
    return true
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function computeDisplayErrors(config) {
  return {
    mode: ['single', 'dual'].includes(config.monitor.mode)
      ? ''
      : 'Monitor mode must be single or dual.',
    width: isPositiveInteger(config.monitor.width)
      ? ''
      : 'Width must be a positive number.',
    height: isPositiveInteger(config.monitor.height)
      ? ''
      : 'Height must be a positive number.',
  }
}

export function computeThemeErrors(config) {
  return {
    mode: ['dark', 'light', 'team'].includes(config.theme.mode)
      ? ''
      : 'Theme mode must be dark, light, or team.',
    teamLeague:
      config.theme.teamTheme.enabled && !config.theme.teamTheme.league.trim()
        ? 'Team league is required when team theme is enabled.'
        : '',
    teamCode:
      config.theme.teamTheme.enabled && !config.theme.teamTheme.team.trim()
        ? 'Team code is required when team theme is enabled.'
        : '',
  }
}

export function computeSectionChecks(config) {
  return [
    {
      id: 'display',
      label: 'Display',
      errors: Object.values(computeDisplayErrors(config)).filter(Boolean),
    },
    {
      id: 'theme',
      label: 'Theme',
      errors: Object.values(computeThemeErrors(config)).filter(Boolean),
    },
  ].map((check) => ({
    ...check,
    complete: check.errors.length === 0,
  }))
}

export function findBoardByType(cfg, type) {
  return cfg?.boards?.find((board) => board.type === type) || null
}

export function resolveTeamPrimaryLogo(team, leagueId) {
  const logos = Array.isArray(team?.logos) ? team.logos : []
  if (!logos.length) return ''

  const leagueToken = String(leagueId || '').trim().toLowerCase()
  const abbreviation = String(team?.abbreviation || '').trim().toLowerCase()

  const ranked = logos
    .filter((logo) => typeof logo?.href === 'string' && logo.href.trim())
    .map((logo) => {
      const href = logo.href.trim()
      const lowerHref = href.toLowerCase()
      let score = 0
      if (leagueToken && lowerHref.includes(`/teamlogos/${leagueToken}/`)) score += 5
      if (abbreviation) {
        try {
          const path = new URL(href).pathname.toLowerCase()
          if (path.includes(`/${abbreviation}.`)) score += 4
        } catch {
          if (lowerHref.includes(`/${abbreviation}.`)) score += 4
        }
      }
      if (lowerHref.includes('/500/')) score += 1
      if (lowerHref.includes('/scoreboard/')) score -= 1
      return { href, score }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.href || ''
}

export function getLeagueEntityType(league) {
  const match = String(league?.url || '').match(/\/sports\/([^/]+)\/([^/]+)\/scoreboard/i)
  const sport = (match ? match[1] : '').toLowerCase()
  const leagueSlug = (match ? match[2] : (league?.id || '')).toLowerCase()

  const isRacing = sport === 'racing' || sport === 'motorsports' ||
    /racing|motorsport|motogp|nascar|indy|indycar|wec|imsa|supercars|rally|f2|f3/.test(leagueSlug)
  const isGolf = sport === 'golf' || /golf|pga|lpga/.test(leagueSlug)
  const isMma = sport === 'mma' || /mma|ufc|bellator|pfl|mixed martial/.test(leagueSlug)
  const isCombat = sport === 'boxing' || /boxing/.test(leagueSlug)
  const isTennis = sport === 'tennis' || /tennis|atp|wta/.test(leagueSlug)

  if (isRacing) {
    if (leagueSlug.includes('f1') || leagueSlug.includes('formula')) {
      return { kind: 'hybrid', label: 'Teams & Drivers', singular: 'Entity' }
    }
    return { kind: 'individual', label: 'Drivers', singular: 'Driver' }
  }
  if (isGolf) return { kind: 'individual', label: 'Players', singular: 'Player' }
  if (isMma) return { kind: 'individual', label: 'Fighters', singular: 'Fighter' }
  if (isCombat) return { kind: 'individual', label: 'Boxers', singular: 'Boxer' }
  if (isTennis) return { kind: 'individual', label: 'Players', singular: 'Player' }
  return { kind: 'team', label: 'Teams', singular: 'Team' }
}

export function getSectionSnapshots(cfg) {
  const homeAssistantBoard = findBoardByType(cfg, 'home-assistant')
  const sportsBoard = findBoardByType(cfg, 'sports')
  return {
    display: { monitor: cfg.monitor, kiosk: cfg.kiosk, layout: cfg.layout },
    theme: { theme: cfg.theme },
    ticker: {
      sportsBoard,
      haBoard: homeAssistantBoard
        ? { enabled: homeAssistantBoard.enabled, slotIndex: homeAssistantBoard.slotIndex, haSensors: homeAssistantBoard.haSensors, haCards: homeAssistantBoard.haCards }
        : null,
    },
  }
}
