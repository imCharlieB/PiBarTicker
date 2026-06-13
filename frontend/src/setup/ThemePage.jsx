import { DARK_PRESET, LIGHT_PRESET, deriveThemeTokens } from '../themeTokens'
import { useAppContext } from '../AppContext'
import { pickerValue, computeThemeErrors } from './helpers'

function buildThemeTeamOptions(league, leagueTeamsById, leagueLogoMetaById) {
  if (!league?.id) {
    return []
  }

  const byValue = new Map()
  const knownTeams = Array.isArray(leagueTeamsById[league.id]) ? leagueTeamsById[league.id] : []
  for (const team of knownTeams) {
    const abbreviation = String(team?.abbreviation || '').trim().toUpperCase()
    const fallbackId = String(team?.id || '').trim().toUpperCase()
    const value = abbreviation || fallbackId
    if (!value) {
      continue
    }

    const name = String(team?.name || team?.displayName || value).trim()
    const label = abbreviation && name.toUpperCase() !== abbreviation
      ? `${name} (${abbreviation})`
      : name

    byValue.set(value, { value, label })
  }

  const cachedTeams = league ? (leagueLogoMetaById[league.id]?.teams || {}) : {}
  for (const [teamId, style] of Object.entries(cachedTeams)) {
    const abbreviation = String(style?.abbreviation || '').trim().toUpperCase()
    const fallbackId = String(teamId || '').trim().toUpperCase()
    const value = abbreviation || fallbackId
    if (!value || byValue.has(value)) {
      continue
    }

    const name = String(style?.display_name || style?.name || '').trim()
    const label = name
      ? `${name}${abbreviation ? ` (${abbreviation})` : ''}`
      : value

    byValue.set(value, { value, label })
  }

  return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export default function ThemePage() {
  const {
    config,
    applyThemeMode, updateConfigSection, setThemeOverride, clearThemeOverride,
    updateThemeTeam, commitConfig, loadLeagueLogoMeta,
    leagueLogoMetaById, leagueTeamsById,
  } = useAppContext()

  const sportsBoard = config.boards.find((b) => b.type === 'sports')
  const themeTokens = deriveThemeTokens(config.theme, { sportsBoard, leagueLogoMetaById })
  const defaultBackground = themeTokens?.pageBg || (config.theme.mode === 'light' ? LIGHT_PRESET.background : DARK_PRESET.background)
  const defaultAccent = themeTokens?.accent || (config.theme.mode === 'light' ? LIGHT_PRESET.accent : DARK_PRESET.accent)
  const themeErrors = computeThemeErrors(config)

  const themeLeagueToken = String(config?.theme?.teamTheme?.league || '').trim().toLowerCase()
  const themeLeagueOptions = Array.isArray(sportsBoard?.leagues)
    ? sportsBoard.leagues.map((league) => ({
      value: String(league?.id || '').trim(),
      label: String(league?.name || league?.id || '').trim(),
      league,
    })).filter((option) => option.value)
    : []
  const selectedThemeLeague = themeLeagueOptions.find((option) => {
    const optionName = String(option?.label || '').trim().toLowerCase()
    return option.value.toLowerCase() === themeLeagueToken || optionName === themeLeagueToken
  })?.league || null

  const themeTeamOptions = buildThemeTeamOptions(selectedThemeLeague, leagueTeamsById, leagueLogoMetaById)
  const selectedThemeTeamValue = String(config?.theme?.teamTheme?.team || '').trim().toUpperCase()

  return (
    <article className="card page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Theme</p>
          <h2>Mode, team colors, and overrides</h2>
          <p className="section-note">Team mode colors are derived from saved team styles in Ticker setup.</p>
        </div>
        <span className="theme-preview" style={{ '--theme-accent': config.theme.accent || defaultAccent, '--theme-background': config.theme.background || defaultBackground }} />
      </div>

      <div className="field-grid field-grid-2">
        <label className="field">
          <span>Mode</span>
          <select value={config.theme.mode} onChange={(event) => applyThemeMode(event.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="team">Team</option>
          </select>
          {themeErrors.mode ? <small className="field-error">{themeErrors.mode}</small> : null}
        </label>

        <label className="field">
          <span>Clock format</span>
          <select
            value={config.theme.clockFormat ?? '12h'}
            onChange={(event) => updateConfigSection('theme', 'clockFormat', event.target.value)}
          >
            <option value="12h">12-hour (1:30 PM)</option>
            <option value="24h">24-hour (13:30)</option>
          </select>
        </label>

        <label className="field field-checkbox">
          <span>Ticker watermark</span>
          <input
            type="checkbox"
            checked={!!config.theme.tickerWatermarkEnabled}
            onChange={(event) => updateConfigSection('theme', 'tickerWatermarkEnabled', event.target.checked)}
          />
        </label>

        {/* Team Theme Section */}
        <div className="field" style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
          <label className="field-checkbox" style={{ marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 600 }}>Use team theme</span>
            <input type="checkbox" checked={config.theme.teamTheme.enabled} onChange={(event) => updateThemeTeam('enabled', event.target.checked)} />
          </label>
          <small className="field-help">Apply the selected team's colors to the entire UI (background, accents, text, etc).</small>
        </div>

        <label className="field">
          <span>Team league</span>
          <select
            value={selectedThemeLeague?.id || ''}
            onChange={(event) => {
              const nextLeagueId = String(event.target.value || '').trim()
              const nextLeague = themeLeagueOptions.find((option) => option.value === nextLeagueId)?.league || null
              const nextTeamOptions = buildThemeTeamOptions(nextLeague, leagueTeamsById, leagueLogoMetaById)
              const currentTeam = String(config?.theme?.teamTheme?.team || '').trim().toUpperCase()
              const nextTeam = nextTeamOptions.some((option) => option.value === currentTeam)
                ? currentTeam
                : (nextTeamOptions[0]?.value || '')

              if (nextLeague?.id && !leagueLogoMetaById[nextLeague.id]) {
                loadLeagueLogoMeta(nextLeague.id)
              }

              commitConfig((current) => ({
                ...current,
                theme: {
                  ...current.theme,
                  teamTheme: {
                    ...current.theme.teamTheme,
                    league: nextLeagueId,
                    team: nextTeam,
                  },
                },
              }))
            }}
            disabled={!config.theme.teamTheme.enabled}
          >
            <option value="">Select league</option>
            {themeLeagueOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Team</span>
          <select
            value={selectedThemeTeamValue}
            onChange={(event) => updateThemeTeam('team', String(event.target.value || '').trim().toUpperCase())}
            disabled={!config.theme.teamTheme.enabled || !selectedThemeLeague}
          >
            <option value="">Select team</option>
            {themeTeamOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {selectedThemeLeague && themeTeamOptions.length === 0 && config.theme.teamTheme.enabled ? (
            <small className="field-help">No saved team styles found. Sync logos for this league first.</small>
          ) : null}
        </label>

        <div className="field field-full">
          <span>Background override (optional)</span>
          <div className="color-control-row">
            <input type="color" value={pickerValue(config.theme.background, defaultBackground)} onChange={(event) => setThemeOverride('background', event.target.value)} />
            <input type="text" value={config.theme.background} placeholder="Blank uses mode default" onChange={(event) => setThemeOverride('background', event.target.value)} />
            <button type="button" className="button-link" onClick={() => clearThemeOverride('background')}>Clear</button>
          </div>
        </div>

        <div className="field field-full">
          <span>Primary override (optional)</span>
          <div className="color-control-row">
            <input type="color" value={pickerValue(config.theme.accent, defaultAccent)} onChange={(event) => setThemeOverride('accent', event.target.value)} />
            <input type="text" value={config.theme.accent} placeholder="Blank uses mode default" onChange={(event) => setThemeOverride('accent', event.target.value)} />
            <button type="button" className="button-link" onClick={() => clearThemeOverride('accent')}>Clear</button>
          </div>
        </div>
      </div>
    </article>
  )
}
