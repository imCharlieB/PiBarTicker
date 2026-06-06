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

export function computeServicesErrors(config) {
  return {
    url: isHttpUrl(config.homeAssistant.url)
      ? ''
      : 'Home Assistant URL must start with http:// or https://.',
    port:
      !config.http.enabled ||
      (Number.isInteger(config.http.port) && config.http.port >= 1 && config.http.port <= 65535)
        ? ''
        : 'HTTP port must be between 1 and 65535 when HTTP is enabled.',
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
    {
      id: 'services',
      label: 'Services',
      errors: Object.values(computeServicesErrors(config)).filter(Boolean),
    },
  ].map((check) => ({
    ...check,
    complete: check.errors.length === 0,
  }))
}
