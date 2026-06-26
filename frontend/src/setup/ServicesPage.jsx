export default function ServicesPage() {
  return (
    <article className="page-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Services</p>
          <h2>Alerts</h2>
        </div>
      </div>

      <div className="ha-alert-example">
        <div className="ha-alert-example-title">Alert automations</div>
        <div className="ha-alert-example-desc">
          Use <code>pibarticker.notify</code> with a <code>key</code> and <code>ttl: 0</code> to show a persistent alert on the ticker.
          Use <code>pibarticker.clear_alert</code> with the same key to dismiss it.
          A single automation with trigger IDs handles both directions:
        </div>
        <pre className="ha-alert-yaml">{`alias: PiBarTicker — Water Leak
trigger:
  - platform: state
    entity_id: binary_sensor.water_sensor
    to: "on"
    id: wet
  - platform: state
    entity_id: binary_sensor.water_sensor
    to: "off"
    id: dry
action:
  - choose:
      - conditions:
          - condition: trigger
            id: wet
        sequence:
          - service: pibarticker.notify
            data:
              message: "Water detected!"
              level: critical
              key: water_leak
              ttl: 0
      - conditions:
          - condition: trigger
            id: dry
        sequence:
          - service: pibarticker.clear_alert
            data:
              key: water_leak`}</pre>
      </div>
    </article>
  )
}
