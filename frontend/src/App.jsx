import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { deriveThemeTokens } from './themeTokens'
import TickerRuntime from './ticker/TickerRuntime'
import { useAppContext } from './AppContext'
import { computeSectionChecks, getSectionSnapshots } from './setup/helpers'
import {
  prepareDisplayGames,
} from './ticker/cardHelpers'
import LayoutShell from './LayoutShell'
import HAPanel from './HAPanel'
import OverviewPage from './setup/OverviewPage'
import DisplayPage from './setup/DisplayPage'
import ServicesPage from './setup/ServicesPage'
import ThemePage from './setup/ThemePage'
import TickerPage from './setup/TickerPage'

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const explicitView = String(searchParams.get('view') || '').trim().toLowerCase()
  const isKioskParam = searchParams.get('kiosk') === '1'
  const isSetupRoute = pathname.startsWith('/setup') || explicitView === 'setup'
  const isTickerRoute =
    pathname === '/'
    || pathname.startsWith('/ticker')
    || pathname.startsWith('/runtime')
    || explicitView === 'ticker'
    || isKioskParam
  const isTickerRuntime = isTickerRoute && !isSetupRoute

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    if (isTickerRuntime) {
      root.style.overflow = 'hidden'
      if (body) body.style.overflow = 'hidden'
    } else {
      root.style.overflow = ''
      if (body) body.style.overflow = ''
    }
    if (isKioskParam) {
      root.classList.add('kiosk-mode')
    } else {
      root.classList.remove('kiosk-mode')
    }
    return () => {
      root.classList.remove('kiosk-mode')
      root.style.overflow = ''
      if (body) body.style.overflow = ''
    }
  }, [isTickerRuntime, isKioskParam])

  const {
    config, savedConfig, isLoading, error, notice,
    isPending, activePage, setActivePage,
    saveConfig, resetConfig,
    leagueLogoMetaById, tickerWatermarkUrl,
    runtimeLeagueIndex, runtimeVisibleLeagueId,
    runtimePayloadByLeagueId,
    initialPreFetchesComplete, setHandoffCheckKey,
    stableGoodGamesByLeagueId,
    handleRuntimeAdvance,
    handoffGraceRef, scrolledThisSlotRef, leagueSlotStartTimeRef, currentSlotLeagueIdRef,
  } = useAppContext()

  const onHandoffCheck = useCallback(() => setHandoffCheckKey(k => k + 1), [setHandoffCheckKey])

  const sportsBoard = config?.boards.find((board) => board.type === 'sports')
  const homeAssistantBoard = config?.boards.find((board) => board.type === 'home-assistant')
  const themeTokens = useMemo(
    () => config ? deriveThemeTokens(config.theme, { sportsBoard, leagueLogoMetaById }) : null,
    [config?.theme, sportsBoard, leagueLogoMetaById], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const runtimeLeagues = useMemo(
    () => sportsBoard?.leagues.filter((league) => league.enabled) ?? [],
    [sportsBoard?.leagues], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const runtimeLeagueIdsKey = runtimeLeagues.map((league) => league.id).join('|')
  const runtimeBoardWidth = Math.max(320,
    config?.monitor?.mode === 'dual'
      ? (Number(config?.monitor?.width) || 1920) * 2
      : (Number(config?.monitor?.width) || 1920)
  )

  const activeRuntimeLeague = runtimeLeagues.length
    ? runtimeLeagues[runtimeLeagueIndex % runtimeLeagues.length]
    : null
  const runtimeVisibleLeague = runtimeLeagues.find((league) => league.id === runtimeVisibleLeagueId) || null
  const logicalDisplayLeague = runtimeVisibleLeague || activeRuntimeLeague
  const runtimeDisplayLeague = initialPreFetchesComplete
    ? logicalDisplayLeague
    : (runtimeLeagues[0] || logicalDisplayLeague)
  const activeRuntimePayload = runtimeDisplayLeague
    ? runtimePayloadByLeagueId[runtimeDisplayLeague.id] || null
    : null
  // Memoized so TickerRuntime only re-renders when actual game data changes,
  // not on every unrelated AppContext state update.
  const runtimeMarqueeGames = useMemo(() => {
    const activeGames = Array.isArray(activeRuntimePayload?.normalizedGames)
      ? activeRuntimePayload.normalizedGames : []
    const stableGames = runtimeDisplayLeague
      ? (stableGoodGamesByLeagueId[runtimeDisplayLeague.id] || []) : []
    const rawEvents = Array.isArray(activeRuntimePayload?.scoreboard?.events)
      ? activeRuntimePayload.scoreboard.events : []
    const eventsById = new Map(
      rawEvents.map((e) => [String(e?.id || '').trim(), e]).filter(([id]) => id),
    )
    const displayGames = prepareDisplayGames(
      activeGames, eventsById, runtimeDisplayLeague,
      runtimeDisplayLeague ? leagueLogoMetaById[runtimeDisplayLeague.id] : null,
      activeRuntimePayload,
      config?.theme?.mode,
    )
    return displayGames.length ? displayGames : stableGames
  }, [activeRuntimePayload, runtimeDisplayLeague, stableGoodGamesByLeagueId, leagueLogoMetaById, config?.theme?.mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const runtimeRenderLeague = runtimeVisibleLeague || (runtimeMarqueeGames.length ? runtimeDisplayLeague : null)
  const brandLeague = runtimeRenderLeague || runtimeDisplayLeague || runtimeLeagues[0] || null

  const shellStyle = useMemo(() => ({
    '--page-bg': themeTokens?.pageBg,
    '--page-gradient': themeTokens?.pageGradient,
    '--panel-bg': themeTokens?.panelBg,
    '--panel-border': themeTokens?.panelBorder,
    '--text-main': themeTokens?.textMain,
    '--text-muted': themeTokens?.textMuted,
    '--accent': themeTokens?.accent,
    '--ticker-bg': themeTokens?.tickerBg,
    '--ticker-text': themeTokens?.tickerText,
    '--ticker-card-bg': themeTokens?.tickerCardBg,
    '--ticker-card-border': themeTokens?.tickerCardBorder,
    '--lower-bg': themeTokens?.lowerBg,
    '--lower-text': themeTokens?.lowerText,
    '--hero-eyebrow': themeTokens?.heroEyebrow,
    '--button-text': themeTokens?.buttonText,
    ...(tickerWatermarkUrl ? { '--ticker-watermark-url': `url(${tickerWatermarkUrl})` } : {}),
  }), [themeTokens, tickerWatermarkUrl])

  if (isLoading) {
    return (
      <main className="app-shell loading-shell">
        <p className="status-chip">Loading setup configuration...</p>
      </main>
    )
  }

  if (error && !config) {
    return (
      <main className="app-shell loading-shell">
        <p className="status-chip status-chip-error">{error}</p>
      </main>
    )
  }

  if (isTickerRuntime) {
    const tickerEl = (
      <TickerRuntime
        leagues={runtimeLeagues}
        displayLeague={runtimeDisplayLeague}
        renderLeague={runtimeRenderLeague}
        brandLeague={brandLeague}
        payloadByLeagueId={runtimePayloadByLeagueId}
        games={runtimeMarqueeGames}
        themeTokens={themeTokens}
        shellStyle={shellStyle}
        boardWidth={runtimeBoardWidth}
        config={config}
        watermarkUrl={tickerWatermarkUrl}
        homeAssistantBoard={homeAssistantBoard}
        initialPreFetchesComplete={initialPreFetchesComplete}
        sportsBoard={sportsBoard}
        sessionKey={runtimeLeagueIdsKey}
        handoffGraceRef={handoffGraceRef}
        scrolledThisSlotRef={scrolledThisSlotRef}
        leagueSlotStartTimeRef={leagueSlotStartTimeRef}
        currentSlotLeagueIdRef={currentSlotLeagueIdRef}
        onAdvance={handleRuntimeAdvance}
        onHandoffCheck={onHandoffCheck}
      />
    )
    const panelContent = {}
    const haLayoutPanel = config.layout?.panels?.find(p => p.type === 'ha' && p.enabled !== false)
    if (haLayoutPanel) {
      panelContent.ha = <HAPanel homeAssistantBoard={homeAssistantBoard} />
    }

    return (
      <LayoutShell layout={config.layout} shellStyle={shellStyle} panelContent={panelContent}>
        {tickerEl}
      </LayoutShell>
    )
  }

  const enabledLeagues = sportsBoard?.leagues.filter((league) => league.enabled) ?? []
  const pages = [
    { id: 'overview', label: 'Overview' },
    { id: 'display', label: 'Display' },
    { id: 'theme', label: 'Theme' },
    { id: 'services', label: 'Services' },
    { id: 'ticker', label: 'Ticker' },
  ]

  const sectionChecks = computeSectionChecks(config)
  const completedSetupSections = sectionChecks.filter((check) => check.complete).length
  const setupReady = completedSetupSections === sectionChecks.length
  const firstSetupError = sectionChecks.find((check) => !check.complete)?.errors[0] || ''
  const sectionSnapshots = getSectionSnapshots(config)
  const savedSectionSnapshots = savedConfig ? getSectionSnapshots(savedConfig) : null
  const dirtySections = {
    display: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.display) !== JSON.stringify(savedSectionSnapshots.display)
      : false,
    theme: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.theme) !== JSON.stringify(savedSectionSnapshots.theme)
      : false,
    services: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.services) !== JSON.stringify(savedSectionSnapshots.services)
      : false,
    ticker: savedSectionSnapshots
      ? JSON.stringify(sectionSnapshots.ticker) !== JSON.stringify(savedSectionSnapshots.ticker)
      : false,
  }
  const dirtyPageIds = Object.entries(dirtySections)
    .filter(([, isDirty]) => isDirty)
    .map(([sectionId]) => sectionId)
  const hasUnsavedChanges = dirtyPageIds.length > 0

  function renderPage() {
    if (activePage === 'overview') return <OverviewPage />
    if (activePage === 'display') return <DisplayPage />
    if (activePage === 'theme') return <ThemePage />
    if (activePage === 'services') return <ServicesPage />
    return <TickerPage />
  }

  return (
    <main className={`app-shell ${themeTokens.modeClass}`} style={shellStyle}>
      <div className="page-shell">
        <header className="topbar">
          <div className="topbar-brand">
            <img
              src="/pibarticker-logo-transparent.png"
              alt="PiBarTicker"
              className="topbar-logo"
            />
          </div>
          <div className="topbar-actions">
            <a className="button-secondary" href="/">
              Open ticker
            </a>
            <button
              type="button"
              className="button-primary"
              onClick={() => saveConfig({ continueToNextPage: false, setupReady, firstSetupError, hasUnsavedChanges })}
              disabled={isPending || !hasUnsavedChanges}
              title={!setupReady ? firstSetupError : ''}
            >
              {isPending ? 'Saving...' : 'Save changes'}
            </button>
            <button type="button" className="button-secondary" onClick={resetConfig}>
              Reset
            </button>
          </div>
        </header>

        <div className="status-bar" aria-live="polite">
          <span className={`status-item ${setupReady ? 'is-good' : 'is-incomplete'}`}>
            Setup {completedSetupSections}/{sectionChecks.length} complete
          </span>
          <span className="status-sep">•</span>
          <span className={`status-item ${hasUnsavedChanges ? 'is-dirty' : 'is-clean'}`}>
            {hasUnsavedChanges ? `${dirtyPageIds.length} unsaved` : 'All saved'}
          </span>

          {notice && (
            <>
              <span className="status-sep">•</span>
              <span className="status-item is-notice">{notice}</span>
            </>
          )}
          {error && (
            <>
              <span className="status-sep">•</span>
              <span className="status-item is-error">{error}</span>
            </>
          )}
        </div>

        <div className="workspace">
          <aside className="card setup-nav">
            <p className="section-kicker">Setup pages</p>
            <h2>Configuration</h2>
            <nav className="nav-list" aria-label="Setup sections">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`nav-link ${activePage === page.id ? 'active' : ''}`}
                  onClick={() => setActivePage(page.id)}
                >
                  <span>{page.label}</span>
                  {dirtySections[page.id] ? <span className="dirty-dot" aria-hidden="true" /> : null}
                </button>
              ))}
            </nav>
            <p className="sidebar-note">Edit one section at a time, then save.</p>

            <div className="system-info">
              <div>{config.monitor.width}×{config.monitor.height} • {enabledLeagues.length} leagues • {config.theme.mode}</div>
              <div className="api-status">API connected</div>
            </div>
          </aside>

          <section className="content-pane" aria-label="Setup controls">
            {renderPage()}
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
