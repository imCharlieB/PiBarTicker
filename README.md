# PiBarTicker

A sports ticker and utility dashboard for stretched bar displays, built for Raspberry Pi kiosk deployments.

Rotates live and upcoming scores one league at a time in a full-width scrolling marquee. Configurable from a web-based setup UI on your local network. Boots directly into fullscreen Chromium kiosk mode.

---

## What It Does

- Scrolling sports ticker — one league at a time, rotating through your enabled leagues
- Live game state details — baseball diamond, football down/clock, hockey period, etc.
- Team-aware card styling — cards tint to home team colors, larger logos, configurable stat display
- Racing support — F1 constructors, NASCAR, IndyCar with race context and TV info
- Persistent lower-third — Home Assistant sensor display
- Web setup UI — configure leagues, display, theme, and services from any browser on your network
- Team logo cache — logos downloaded and served locally, no external calls at runtime
- Dark, light, and team-color themes — including a watermark branding option
- Custom boot splash — your PiBarTicker logo replaces the default Raspberry Pi boot screen

---

## Requirements

- Raspberry Pi 4 or 5
- Raspberry Pi OS Desktop — Bookworm preferred (Lite is not supported — kiosk needs a desktop session)
- Network access for ESPN data and initial install

---

## Install on Raspberry Pi

One command on a fresh Raspberry Pi OS Desktop:

```bash
curl -fsSL https://raw.githubusercontent.com/imCharlieB/PiBarTicker/main/scripts/pi/bootstrap.sh | sudo bash
```

This downloads the code, installs all dependencies, sets up the backend service, configures kiosk autostart, and installs the custom boot splash. Run the same command again at any time to update.

```bash
sudo reboot
```

After reboot the PiBarTicker logo appears as the boot splash, and the ticker opens automatically in fullscreen Chromium.

**Advanced options** (fork, specific branch):
```bash
curl -fsSL .../bootstrap.sh | sudo bash -s -- --repo https://github.com/you/fork.git --branch mybranch
```

**If the repo is already on the Pi:**
```bash
sudo bash scripts/pi/install_pi.sh
```

---

## Local Development

Run the backend and frontend separately:

```powershell
# Terminal 1 — backend
cd backend
uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open the Vite URL in your browser. The frontend proxies `/api` requests to the backend on port `8000`.

---

## Setup UI

Open `http://<pi-address>:8000/setup` (or `http://localhost:8000/setup` locally) to reach the setup page.

Sections:
- **Overview** — first-run checklist and section status
- **Display** — monitor resolution, kiosk autostart, Chromium flags
- **Theme** — dark / light / team-color mode, watermark branding
- **Services** — Home Assistant connection and sensors
- **Ticker** — enable/disable leagues, set order, configure per-league options, sync team logos

---

## Home Assistant Integration

PiBarTicker ships a custom Home Assistant integration that adds native HA entities — no REST command YAML required.

**What it gives you:**

- `switch.pibarticker_display` — turn the monitor on or off from a dashboard, automation, or voice command
- `pibarticker.notify` service — send an alert message to the display from any automation (with optional severity level and auto-dismiss duration)
- Sensor mirroring — pick any HA entities in the integration options and their values are pushed to the display automatically on state change. Configure where each sensor appears (ticker rotation or a corner widget) from the PiBarTicker setup UI under **Services**.

### Install via HACS

1. In Home Assistant, open **HACS → Integrations → ⋮ → Custom repositories**
2. Add your PiBarTicker repo URL and set category to **Integration**
3. Search for **PiBarTicker** in HACS and install it
4. Restart Home Assistant
5. Go to **Settings → Devices & Services → Add integration** and search for **PiBarTicker**
6. Enter your Pi's URL (e.g. `http://192.168.1.x:8000`) — the integration will verify it can reach the backend
7. Open the integration options to select which HA entities to mirror to the display

### Manual install (no HACS)

Copy the `ha-integration/custom_components/pibarticker/` folder into your Home Assistant `config/custom_components/` directory, then restart HA and follow steps 5–7 above.

### Using the notify service

From an automation action or Developer Tools → Services:

```yaml
service: pibarticker.notify
data:
  message: "Leak detected in basement"
  level: warning      # info | warning | critical
  ttl: 60             # seconds on screen; 0 = stays until next restart
```

The alert appears as a floating banner on the display and auto-dismisses when the TTL expires.

---

## File Layout

```
backend/          Python/FastAPI backend — ESPN data, logo cache, config API
frontend/         React/Vite app — kiosk display and setup UI
scripts/pi/       Raspberry Pi install, service, and kiosk launch scripts

config.json       Your saved settings (created automatically on first run)
logos/            Locally cached team and league logos (created automatically)
team-meta/        Cached team metadata per league (created automatically)
runtime-cache/    Short-lived scoreboard cache (created automatically)
```

The three data directories (`logos/`, `team-meta/`, `runtime-cache/`) and `config.json` are created automatically on first backend start. You do not need to create them manually.
