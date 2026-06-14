import { DARK_PRESET, LIGHT_PRESET, deriveThemeTokens } from '../themeTokens'
import { useAppContext } from '../AppContext'
import { pickerValue, computeThemeErrors } from './helpers'

function buildThemeTeamOptions(league, leagueTeamsById, leagueLogoMetaById) {
  if (!league?.id) return []

  const byValue = new Map()
  const knownTeams = Array.isArray(leagueTeamsById[league.id]) ? leagueTeamsById[league.id] : []
  for (const team of knownTeams) {
    const abbreviation = String(team?.abbreviation || '').trim().toUpperCase()
    const fallbackId = String(team?.id || '').trim().toUpperCase()
    const value = abbreviation || fallbackId
    if (!value) continue
    const name = String(team?.name || team?.displayName || value).trim()
    const label = abbreviation && name.toUpperCase() !== abbreviation ? `${name} (${abbreviation})` : name
    byValue.set(value, { value, label })
  }

  const cachedTeams = league ? (leagueLogoMetaById[league.id]?.teams || {}) : {}
  for (const [teamId, style] of Object.entries(cachedTeams)) {
    const abbreviation = String(style?.abbreviation || '').trim().toUpperCase()
    const fallbackId = String(teamId || '').trim().toUpperCase()
    const value = abbreviation || fallbackId
    if (!value || byValue.has(value)) continue
    const name = String(style?.display_name || style?.name || '').trim()
    const label = name ? `${name}${abbreviation ? ` (${abbreviation})` : ''}` : value
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
    <article className="page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Theme</p>
          <h2>Mode, team colors, and overrides</h2>
          <p className="section-note">Team mode colors are derived from saved team styles in Ticker setup.</p>
        </div>
        <span className="theme-preview" style={{ '--theme-accent': config.theme.accent || defaultAccent, '--theme-background': config.theme.background || defaultBackground }} />
      </div>

      <div className="field-grid field-grid-2">

        {/* Row 1: Mode (left) + Clock format (right) */}
        <div className="field">
          <span>Mode</span>
          <div className="theme-mode-seg">
            {[['dark','Dark'],['light','Light'],['team','Team']].map(([val, label]) => (
              <button key={val} type="button"
                className={`theme-mode-btn${config.theme.mode === val ? ' is-active' : ''}`}
                onClick={() => applyThemeMode(val)}
              >{label}</button>
            ))}
          </div>
          {themeErrors.mode ? <small className="field-error">{themeErrors.mode}</small> : null}
        </div>

        <label className="field">
          <span>Clock format</span>
          <select
            value={config.theme.clockFormat ?? '12h'}
            onChange={(e) => updateConfigSection('theme', 'clockFormat', e.target.value)}
          >
            <option value="12h">12-hour (1:30 PM)</option>
            <option value="24h">24-hour (13:30)</option>
          </select>
        </label>

        {/* Row 2: Display options toggles — full width, no kicker */}
        <div className="page-toggle-group" style={{ gridColumn: '1 / -1' }}>
          <div className="page-toggle-row">
            <div>
              <div className="page-toggle-label">Ticker watermark</div>
              <div className="page-toggle-desc">Show the PiBarTicker watermark faintly behind the ticker</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox"
                checked={!!config.theme.tickerWatermarkEnabled}
                onChange={(e) => updateConfigSection('theme', 'tickerWatermarkEnabled', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="page-toggle-row">
            <div>
              <div className="page-toggle-label">Use team theme</div>
              <div className="page-toggle-desc">Apply the selected team's colors to the entire UI (background, accents, text)</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox"
                checked={config.theme.teamTheme.enabled}
                onChange={(e) => updateThemeTeam('enabled', e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        {/* Row 3: Team league (left) + Team (right) */}
        <label className="field">
          <span>Team league</span>
          <select
            value={selectedThemeLeague?.id || ''}
            disabled={!config.theme.teamTheme.enabled}
            onChange={(e) => {
              const nextLeagueId = String(e.target.value || '').trim()
              const nextLeague = themeLeagueOptions.find((o) => o.value === nextLeagueId)?.league || null
              const nextTeamOptions = buildThemeTeamOptions(nextLeague, leagueTeamsById, leagueLogoMetaById)
              const currentTeam = String(config?.theme?.teamTheme?.team || '').trim().toUpperCase()
              const nextTeam = nextTeamOptions.some((o) => o.value === currentTeam)
                ? currentTeam : (nextTeamOptions[0]?.value || '')
              if (nextLeague?.id && !leagueLogoMetaById[nextLeague.id]) loadLeagueLogoMeta(nextLeague.id)
              commitConfig((current) => ({
                ...current,
                theme: {
                  ...current.theme,
                  teamTheme: { ...current.theme.teamTheme, league: nextLeagueId, team: nextTeam },
                },
              }))
            }}
          >
            <option value="">Select league</option>
            {themeLeagueOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Team</span>
          <select
            value={selectedThemeTeamValue}
            disabled={!config.theme.teamTheme.enabled || !selectedThemeLeague}
            onChange={(e) => updateThemeTeam('team', String(e.target.value || '').trim().toUpperCase())}
          >
            <option value="">Select team</option>
            {themeTeamOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {selectedThemeLeague && themeTeamOptions.length === 0 && config.theme.teamTheme.enabled
            ? <small className="field-help">No saved team styles. Sync logos for this league first.</small>
            : null}
        </label>

        {/* Color overrides */}
        <div className="field field-full">
          <span>Background override (optional)</span>
          <div className="color-control-row">
            <input type="color"
              value={pickerValue(config.theme.background, defaultBackground)}
              onChange={(e) => setThemeOverride('background', e.target.value)} />
            <input type="text"
              value={config.theme.background}
              placeholder="Blank uses mode default"
              onChange={(e) => setThemeOverride('background', e.target.value)} />
            <button type="button" className="button-link" onClick={() => clearThemeOverride('background')}>Clear</button>
          </div>
        </div>

        <div className="field field-full">
          <span>Primary override (optional)</span>
          <div className="color-control-row">
            <input type="color"
              value={pickerValue(config.theme.accent, defaultAccent)}
              onChange={(e) => setThemeOverride('accent', e.target.value)} />
            <input type="text"
              value={config.theme.accent}
              placeholder="Blank uses mode default"
              onChange={(e) => setThemeOverride('accent', e.target.value)} />
            <button type="button" className="button-link" onClick={() => clearThemeOverride('accent')}>Clear</button>
          </div>
        </div>

      </div>
    </article>
  )
}
