import './LayoutShell.css'

function deriveGrid(panel) {
  const other = 100 - panel.size
  switch (panel.position) {
    case 'bottom': return { rows: `${other}% ${panel.size}%`, cols: '1fr', tickerArea: '1 / 1 / 2 / 2', panelArea: '2 / 1 / 3 / 2' }
    case 'top':    return { rows: `${panel.size}% ${other}%`, cols: '1fr', tickerArea: '2 / 1 / 3 / 2', panelArea: '1 / 1 / 2 / 2' }
    case 'left':   return { rows: '1fr', cols: `${panel.size}% ${other}%`, tickerArea: '1 / 2 / 2 / 3', panelArea: '1 / 1 / 2 / 2' }
    case 'right':  return { rows: '1fr', cols: `${other}% ${panel.size}%`, tickerArea: '1 / 1 / 2 / 2', panelArea: '1 / 2 / 2 / 3' }
    default:       return { rows: '1fr', cols: '1fr', tickerArea: '1 / 1 / 2 / 2', panelArea: null }
  }
}

export default function LayoutShell({ layout, shellStyle, panelContent, children }) {
  if (!layout || layout.mode !== 'grid') return children

  const enabledPanels = (layout.panels ?? []).filter(p => p.enabled !== false)
  const panel = enabledPanels.find(p => panelContent?.[p.type])

  if (!panel) return children

  const { rows, cols, tickerArea, panelArea } = deriveGrid(panel)

  return (
    <div
      className="layout-shell"
      style={{ ...shellStyle, gridTemplateRows: rows, gridTemplateColumns: cols }}
    >
      <div className="layout-panel layout-panel-ticker" style={{ gridArea: tickerArea }}>
        {children}
      </div>
      <div className="layout-panel layout-panel-content" style={{ gridArea: panelArea }}>
        {panelContent[panel.type]}
      </div>
    </div>
  )
}
