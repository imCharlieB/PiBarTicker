import { useAppContext } from '../AppContext'
import { parseList, listToText, computeDisplayErrors } from './helpers'

export default function DisplayPage() {
  const { config, updateConfigSection } = useAppContext()
  const displayErrors = computeDisplayErrors(config)

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
        </label>

        <label className="field">
          <span>Height</span>
          <input type="number" value={config.monitor.height} onChange={(event) => updateConfigSection('monitor', 'height', Number(event.target.value))} />
          {displayErrors.height ? <small className="field-error">{displayErrors.height}</small> : null}
        </label>

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
