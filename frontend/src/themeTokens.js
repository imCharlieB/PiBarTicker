export const DARK_PRESET = {
  background: '#0a0b0e',
  accent: '#7cf29b',
}

export const LIGHT_PRESET = {
  background: '#f2f4f7',
  accent: '#7cf29b',
}

const TEAM_PRESETS = {
  ARI: { accent: '#97233f', background: '#1f1f24' },
  DAL: { accent: '#003594', background: '#1b1f29' },
  NYY: { accent: '#132448', background: '#1b1e25' },
  LAL: { accent: '#552583', background: '#1f1b27' },
}

function sanitizeHexColor(value) {
  if (typeof value !== 'string') {
    return ''
  }

  let trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  // Support both "#BA0C2F" and "BA0C2F" (as stored in team-meta cache)
  if (trimmed[0] === '#') {
    trimmed = trimmed.slice(1)
  }

  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[0]
    const g = trimmed[1]
    const b = trimmed[2]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }

  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return `#${trimmed}`.toLowerCase()
  }

  return ''
}

function hexToRgb(hex) {
  const safeHex = sanitizeHexColor(hex)
  if (!safeHex) {
    return null
  }

  const value = safeHex.slice(1)
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`
}

function blendHex(baseHex, mixHex, weight) {
  const base = hexToRgb(baseHex)
  const mix = hexToRgb(mixHex)
  if (!base || !mix) {
    return sanitizeHexColor(baseHex) || sanitizeHexColor(mixHex) || '#000000'
  }

  const safeWeight = Math.max(0, Math.min(1, Number(weight) || 0))
  return rgbToHex({
    r: base.r * (1 - safeWeight) + mix.r * safeWeight,
    g: base.g * (1 - safeWeight) + mix.g * safeWeight,
    b: base.b * (1 - safeWeight) + mix.b * safeWeight,
  })
}

function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return `rgba(0, 0, 0, ${alpha})`
  }
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`
}

function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return 0
  }

  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foregroundHex, backgroundHex) {
  const l1 = luminance(foregroundHex)
  const l2 = luminance(backgroundHex)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableTextFor(backgroundHex) {
  const white = '#ffffff'
  const dark = '#0f172a'
  return contrastRatio(white, backgroundHex) >= contrastRatio(dark, backgroundHex) ? white : dark
}

function ensureContrast(foregroundHex, backgroundHex, minRatio, fallbackHex) {
  const foreground = sanitizeHexColor(foregroundHex)
  const background = sanitizeHexColor(backgroundHex)
  const fallback = sanitizeHexColor(fallbackHex)
  if (!background) {
    return foreground || fallback || '#000000'
  }

  if (foreground && contrastRatio(foreground, background) >= minRatio) {
    return foreground
  }

  if (fallback && contrastRatio(fallback, background) >= minRatio) {
    return fallback
  }

  return readableTextFor(background)
}

function findTeamColorsFromCache(leagueId, teamToken, logoMetaById) {
  if (!leagueId || !teamToken) return null
  const meta = logoMetaById?.[String(leagueId)]
  if (!meta || !meta.teams) return null

  const upperToken = String(teamToken).trim().toUpperCase()
  for (const t of Object.values(meta.teams)) {
    const abbr = String(t?.abbreviation || '').trim().toUpperCase()
    if (abbr === upperToken) {
      return {
        color: t?.color || '',
        alternateColor: t?.alternate_color || '',
        abbreviation: t?.abbreviation || '',
      }
    }
  }
  return null
}

function findTeamStyle(theme, sportsBoard, logoMetaById = {}) {
  const teamTheme = theme?.teamTheme || {}
  const leagueToken = String(teamTheme.league || '').trim().toLowerCase()
  const teamToken = String(teamTheme.team || '').trim().toUpperCase()
  if (!leagueToken || !teamToken) {
    return null
  }

  const leagues = Array.isArray(sportsBoard?.leagues) ? sportsBoard.leagues : []
  const league = leagues.find((entry) => {
    const id = String(entry?.id || '').trim().toLowerCase()
    const name = String(entry?.name || '').trim().toLowerCase()
    return leagueToken === id || leagueToken === name
  })
  if (!league) {
    return null
  }

  // Prefer the new local logo cache (colors + meta) over anything else.
  const fromCache = findTeamColorsFromCache(league.id, teamToken, logoMetaById)
  if (fromCache) {
    return fromCache
  }

  // No legacy teamStyles fallback — the old per-league blob in config is gone.
  return null
}

function resolveTeamPalette(theme, sportsBoard, logoMetaById = {}) {
  const configured = findTeamStyle(theme, sportsBoard, logoMetaById)
  const code = String(theme?.teamTheme?.team || '').trim().toUpperCase()
  const preset = TEAM_PRESETS[code] || { accent: '#7cf29b', background: '#13161c' }

  const configuredPrimary = sanitizeHexColor(configured?.color)
  const configuredAlternate = sanitizeHexColor(configured?.alternateColor)

  const accent = configuredPrimary || sanitizeHexColor(preset.accent) || DARK_PRESET.accent
  const background = configuredAlternate || configuredPrimary || sanitizeHexColor(preset.background) || '#13161c'

  return {
    accent,
    background,
  }
}

function finalizeTokens(tokens) {
  const pageBg = sanitizeHexColor(tokens.pageBg) || DARK_PRESET.background
  const panelBg = sanitizeHexColor(tokens.panelBg) || pageBg
  const tickerBg = sanitizeHexColor(tokens.tickerBg) || panelBg
  const lowerBg = sanitizeHexColor(tokens.lowerBg) || panelBg
  const accent = sanitizeHexColor(tokens.accent) || DARK_PRESET.accent

  const textMain = ensureContrast(tokens.textMain, panelBg, 4.5, readableTextFor(panelBg))
  const tickerText = ensureContrast(tokens.tickerText, tickerBg, 4.5, readableTextFor(tickerBg))
  const lowerText = ensureContrast(tokens.lowerText, lowerBg, 4.5, readableTextFor(lowerBg))
  const buttonText = ensureContrast(tokens.buttonText, accent, 4.5, readableTextFor(accent))
  const heroEyebrow = ensureContrast(tokens.heroEyebrow || accent, pageBg, 3.0, accent)
  const textMuted = contrastRatio(tokens.textMuted || '', panelBg) >= 3.0
    ? sanitizeHexColor(tokens.textMuted)
    : blendHex(textMain, panelBg, 0.45)

  return {
    ...tokens,
    pageBg,
    panelBg,
    tickerBg,
    lowerBg,
    accent,
    panelBorder: tokens.panelBorder || hexToRgba(textMain, 0.18),
    textMain,
    textMuted,
    tickerText,
    lowerText,
    buttonText,
    heroEyebrow,
  }
}

export function deriveThemeTokens(theme, options = {}) {
  const hasBackgroundOverride = Boolean(theme?.background && String(theme.background).trim())
  const hasAccentOverride = Boolean(theme?.accent && String(theme.accent).trim())

  const backgroundOverride = sanitizeHexColor(theme?.background)
  const accentOverride = sanitizeHexColor(theme?.accent)
  const resolvedAccentOverride = hasAccentOverride ? accentOverride : ''
  const resolvedBackgroundOverride = hasBackgroundOverride ? backgroundOverride : ''

  const teamThemeEnabled = !!(theme?.teamTheme?.enabled && (theme?.teamTheme?.league || theme?.teamTheme?.team))

  if (theme?.mode === 'light' && !teamThemeEnabled) {
    return finalizeTokens({
      pageBg: '#f2f4f7',
      pageGradient: 'linear-gradient(180deg, #ffffff 0%, #f2f4f7 100%)',
      panelBg: '#ffffff',
      panelBorder: 'rgba(36, 36, 36, 0.12)',
      textMain: '#1a1d23',
      textMuted: '#626264',
      tickerBg: '#f0f3f7',
      tickerText: '#1a1d23',
      tickerCardBg: '#13161c',
      tickerCardBorder: '#232833',
      lowerBg: '#f2f4f7',
      lowerText: '#1a1d23',
      accent: resolvedAccentOverride || LIGHT_PRESET.accent,
      heroEyebrow: '#1a7a35',
      buttonText: '#0c120e',
      modeClass: 'mode-light',
    })
  }

  if (theme?.mode === 'team' || teamThemeEnabled) {
    const palette = resolveTeamPalette(theme, options.sportsBoard, options.leagueLogoMetaById)
    const background = resolvedBackgroundOverride || palette.background
    const accent = resolvedAccentOverride || palette.accent
    const panelBg = blendHex(background, '#0c0e12', 0.36)
    const tickerBg = blendHex(background, '#0a0b0e', 0.56)
    const tickerCardBg = blendHex(background, '#0c0e12', 0.52)

    return finalizeTokens({
      pageBg: background,
      pageGradient: `linear-gradient(180deg, ${background} 0%, ${blendHex(background, '#0c0e12', 0.62)} 100%)`,
      panelBg,
      panelBorder: hexToRgba(blendHex(background, '#ffffff', 0.7), 0.22),
      textMain: readableTextFor(panelBg),
      textMuted: blendHex(readableTextFor(panelBg), panelBg, 0.42),
      tickerBg,
      tickerText: readableTextFor(tickerBg),
      tickerCardBg,
      tickerCardBorder: hexToRgba(blendHex(background, '#ffffff', 0.7), 0.28),
      lowerBg: panelBg,
      lowerText: readableTextFor(panelBg),
      accent,
      heroEyebrow: accent,
      buttonText: readableTextFor(accent),
      modeClass: 'mode-dark',
    })
  }

  return finalizeTokens({
    pageBg: '#0a0b0e',
    pageGradient: 'linear-gradient(180deg, #13161c 0%, #0c0e12 100%)',
    panelBg: '#13161c',
    panelBorder: '#232833',
    textMain: '#ffffff',
    textMuted: '#9aa3b1',
    tickerBg: '#0c0e12',
    tickerText: '#e7ebf2',
    tickerCardBg: '#13161c',
    tickerCardBorder: '#232833',
    lowerBg: '#13161c',
    lowerText: '#e7ebf2',
    accent: resolvedAccentOverride || DARK_PRESET.accent,
    heroEyebrow: '#7cf29b',
    buttonText: '#0c120e',
    modeClass: 'mode-dark',
  })
}
