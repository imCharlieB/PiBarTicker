import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { parseList, listToText, computeDisplayErrors } from './helpers'

export default function DisplayPage() {
  const { config, updateConfigSection, commitConfig } = useAppContext()

  function resetMonitor() {
    commitConfig(current => ({
      ...current,
      monitor: { ...current.monitor, mode: 'single', swapOutputs: false, width: 0, height: 0 },
    }))
  }
  const displayErrors = computeDisplayErrors(config)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState(null)

  async function detectResolution() {
    setDetecting(true)
    setDetectError(null)
    try {
      const res = await fetch('/api/v1/display/resolution')
      const data = await res.json()
      if (data.detected) {
        const mode = (data.outputs?.length ?? 1) >= 2 ? 'dual' : 'single'
        updateConfigSection('monitor', 'mode', mode)
        updateConfigSection('monitor', 'width', data.width)
        updateConfigSection('monitor', 'height', data.height)
      } else {
        setDetectError('Could not detect display — run this on the Pi, or enter width and height manually.')
      }
    } catch {
      setDetectError('Detection failed — check the Pi backend.')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <article className="page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Display</p>
          <h2>Monitor and kiosk settings</h2>
        </div>
      </div>

      <div className="field-grid field-grid-2">
        <label className="field">
          <span>Monitor mode</span>
          <select value={config.monitor.mode} onChange={(event) => updateConfigSection('monitor', 'mode', event.target.value)}>
            <option value="single">Single</option>
            <option value="dual">Dual</option>
          </select>
          {displayErrors.mode ? <small className="field-error">{displayErrors.mode}</small> : null}
        </label>

        <label className="field">
          <span>Kiosk startup</span>
          <select value={config.kiosk.autoStart} onChange={(event) => updateConfigSection('kiosk', 'autoStart', event.target.value)}>
            <option value="autostart">Autostart</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>

        {config.monitor.mode === 'dual' ? (
          <label className="field">
            <span>Swap outputs</span>
            <select value={config.monitor.swapOutputs ? 'true' : 'false'} onChange={(event) => updateConfigSection('monitor', 'swapOutputs', event.target.value === 'true')}>
              <option value="false">Default order</option>
              <option value="true">Swapped (flip left/right)</option>
            </select>
            <small className="field-help">Toggle if the ticker scrolls backward — swaps which physical monitor is treated as "left".</small>
          </label>
        ) : null}

        <label className="field">
          <span>{config.monitor.mode === 'dual' ? 'Width (per monitor)' : 'Width'}</span>
          <input type="number" value={config.monitor.width} onChange={(event) => updateConfigSection('monitor', 'width', Number(event.target.value))} />
          {displayErrors.width ? <small className="field-error">{displayErrors.width}</small> : null}
          {config.monitor.mode === 'dual' ? <small className="field-help">Total span: {config.monitor.width * 2}px</small> : null}
          <small className="field-help">Set to 0 to auto-detect from the display at boot. Otherwise sets the xrandr display width on Pi.</small>
        </label>

        <label className="field">
          <span>Height</span>
          <input type="number" value={config.monitor.height} onChange={(event) => updateConfigSection('monitor', 'height', Number(event.target.value))} />
          {displayErrors.height ? <small className="field-error">{displayErrors.height}</small> : null}
          <small className="field-help">Set to 0 to auto-detect from the display at boot. Otherwise controls the Chromium window height (bar height).</small>
        </label>

        <div className="field field-full" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="button-secondary" onClick={detectResolution} disabled={detecting}>
            {detecting ? 'Detecting…' : 'Detect resolution'}
          </button>
          <button type="button" className="button-secondary" onClick={resetMonitor}>
            Reset to defaults
          </button>
          {detectError ? <small className="field-error" style={{ width: '100%' }}>{detectError}</small> : null}
          <small className="field-help" style={{ width: '100%' }}>Reads the active display resolution from xrandr on the Pi and populates the fields above. Reset clears mode back to single — width and height are left as-is since they depend on your hardware.</small>
        </div>

        <div className="field field-full" style={{ marginTop: '0.5rem' }}>
          <p className="section-kicker">Layout</p>
        </div>

        <label className="field field-full">
          <span>Layout mode</span>
          <select value={config.layout.mode} onChange={(e) => updateConfigSection('layout', 'mode', e.target.value)}>
            <option value="unified-scroll">Unified Scroll</option>
            <option value="grid">Grid</option>
          </select>
          <small className="field-help">Unified Scroll: ticker fills the full display. Grid: divide the screen into configurable panel slots.</small>
        </label>

        {config.layout.mode === 'grid' && (() => {
          const haPanel = config.layout.panels.find(p => p.type === 'ha')
          const newsPanel = config.layout.panels.find(p => p.type === 'news')

          function setPanelPosition(type, position) {
            let panels = config.layout.panels.filter(p => p.type !== type)
            if (position) panels = [...panels, { id: type, type, position, size: 20, enabled: true }]
            updateConfigSection('layout', 'panels', panels)
          }

          function setPanelSize(type, size) {
            const panels = config.layout.panels.map(p => p.type === type ? { ...p, size } : p)
            updateConfigSection('layout', 'panels', panels)
          }

          return (
            <>
              <div className="field field-full"><p className="section-kicker" style={{ marginBottom: 0 }}>Panels</p></div>

              <label className="field">
                <span>Home Assistant</span>
                <select value={haPanel?.position || ''} onChange={(e) => setPanelPosition('ha', e.target.value)}>
                  <option value="">In ticker (default)</option>
                  <option value="bottom">Own panel — bottom</option>
                  <option value="top">Own panel — top</option>
                  <option value="left">Own panel — left</option>
                  <option value="right">Own panel — right</option>
                </select>
                <small className="field-help">Show HA cards in a dedicated section instead of the ticker scroll.</small>
              </label>

              {haPanel && (
                <label className="field">
                  <span>HA panel size (%)</span>
                  <input type="number" min="5" max="95" value={haPanel.size}
                    onChange={(e) => setPanelSize('ha', Number(e.target.value))} />
                  <small className="field-help">How much of the screen height (top/bottom) or width (left/right) this panel occupies.</small>
                </label>
              )}

              <label className="field">
                <span>News</span>
                <select value={newsPanel?.position || ''} onChange={(e) => setPanelPosition('news', e.target.value)}>
                  <option value="">In ticker (default)</option>
                  <option value="bottom">Own panel — bottom</option>
                  <option value="top">Own panel — top</option>
                  <option value="left">Own panel — left</option>
                  <option value="right">Own panel — right</option>
                </select>
                <small className="field-help">Show news headlines in a dedicated section. When active, news is suppressed from the main ticker. Requires "Show news" to be enabled on at least one league.</small>
              </label>

              {newsPanel && (
                <label className="field">
                  <span>News panel size (%)</span>
                  <input type="number" min="5" max="95" value={newsPanel.size}
                    onChange={(e) => setPanelSize('news', Number(e.target.value))} />
                  <small className="field-help">How much of the screen height (top/bottom) or width (left/right) this panel occupies.</small>
                </label>
              )}
            </>
          )
        })()}

        <label className="field field-full">
          <span>Chromium flags</span>
          <textarea rows="6" value={listToText(config.kiosk.chromiumFlags)} onChange={(event) => updateConfigSection('kiosk', 'chromiumFlags', parseList(event.target.value))} />
          <small className="field-help" style={{ marginTop: '4px', display: 'block' }}>
            Flags passed to Chromium when launching kiosk mode. Recommended Pi flags are included by default for smooth scrolling and no scrollbars.
          </small>
        </label>
      </div>
    </article>
  )
}
