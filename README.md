# PiBarTicker

PiBarTicker is a Pi-first sports ticker and utility dashboard designed for stretched bar displays and kiosk deployments.

The target product combines:
- a full-width sports ticker that rotates one league at a time
- a persistent lower-third for Home Assistant data and future modules
- a web-based setup UI for local configuration
- Raspberry Pi Chromium kiosk deployment as the primary runtime

## Current Status

Phase 0 and core Phase 1 backend foundations are in place:
- `frontend/` contains the React + Vite setup-page MVP bound to the config API
- `backend/` contains the FastAPI application shell, config API, runtime path bootstrap, and shared HTTP client utility
- `docs/REBUILD_SPEC.md` is the build source of truth
- `docs/BUILD_TODO.md` tracks phased implementation work
- `config.json` is created automatically as the runtime configuration file
- `runtime-cache/`, `team-meta/`, and `logos/` are bootstrapped as runtime data directories

Setup UI currently uses a page-based navigation flow to reduce clutter:
- Overview
- Display
- Theme
- Services
- Ticker

Setup UI now includes first-run readiness behavior:
- Overview checklist for required setup sections (Display, Theme, Services)
- section status and progress indicator
- inline validation messages for required setup fields
- save button disabled until required setup data is valid
- per-page unsaved-changes indicators in setup navigation
- status chip showing unsaved section count
- Save and Continue action for faster page-by-page setup flow

Ticker setup now uses a drill-down workflow:
- top-level ticker page shows league cards with basic info
- clicking a league opens full settings for that league
- league detail page includes ESPN-backed team logo explorer
- clicking a team logo opens a team detail view with logo variants and team metadata fields from ESPN scoreboard payloads
- league detail toggles are grouped together in a dedicated controls block
- team refresh action is located in the Teams explorer header
- primary team logos are now selected with league-aware matching to reduce mixed-team logo rendering
- NFL team logo variants now prefer ESPN canonical `/i/teamlogos/` assets when available to avoid cross-team GUID variant mismatches, while other leagues keep full ESPN variant sets
- NFL team detail now shows canonical variants first and exposes additional ESPN GUID variants in a separate unverified section
- team detail now requests per-team logo variants from `/api/v1/espn/team-logos` to improve team-specific accuracy
- team detail now shows additional metadata when available (group, record summary, venue, nickname, slug)
- team detail now includes standings-derived fields (overall, division/conference records, home/away, streak, point differential when available)
- team side panel is organized into readable sections (snapshot, standings, venue)
- team detail now includes league-scoped team style controls so primary/alternate colors are saved per team in setup
- runtime ticker now prefers saved league team styles over transient feed colors for consistent branding
- league detail supports conference/division/group filtering through ESPN groups metadata (`includedGroups`)
- ticker setup can discover leagues from ESPN core catalog and add them directly into app configuration
- league team explorer now requests larger team pages (`limit=1000`) so large college leagues are not truncated
- ticker page now keeps league picker and board settings in collapsible panels to reduce clutter
- league picker now supports quick close/clear and uses a bounded scrollable results list
- runtime game cards now tint to the home team color, use larger team logos, and show a larger game date line
- league settings now include card stat toggles (records, clock, situation, venue, odds) for the area under game scores
- racing cards now surface next race/final context and TV details in a top-right header panel
- league settings now include a per-league `useTeamCardColors` toggle so cards can use team gradients or stay on theme-driven styling
- league settings now include a per-league `showLiveState` toggle so live-only details stay hidden unless enabled for that league
- live baseball cards now include an outs/count panel and runner diamond (1st/2nd/3rd occupancy)
- baseball live cards now place the runner diamond inline with team scores and map batting side from half-inning/status text (`Top`, `Bottom`, `T#`, `B#`)
- baseball live cards now suppress duplicate situation text in lower metadata when the live outs/count panel is active
- setup/runtime league filtering is simplified to ESPN slate by default with optional live-only card mode to reduce cross-league filter confusion

## Project Layout

```text
backend/   FastAPI backend and future API modules
frontend/  React/Vite kiosk display and setup UI
docs/      Rebuild spec and supporting API notes
src/       Legacy hello-world starter from initial workspace bootstrap
```

## Backend Run

```powershell
cd backend
uvicorn app.main:app --app-dir . --reload
```

## Frontend Run

```powershell
cd frontend
npm install
npm run dev
```

To view the setup page locally, run the backend first on port `8000`, then run the frontend and open the Vite URL in your browser. The frontend proxies `/api` requests to the backend during development.

## Raspberry Pi Install

Pi deployment scripts now live under `scripts/pi/`.

Required OS flavor: Raspberry Pi OS Desktop (`Lite` is not supported for this kiosk workflow).

One-command install/update from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/imCharlieB/PiBarTicker/main/scripts/pi/bootstrap.sh | sudo bash -s -- \
	--repo https://github.com/imCharlieB/PiBarTicker.git \
	--branch main
```

Use the same command later to pull updates and redeploy.

From the repository root on your Raspberry Pi:

```bash
sudo bash scripts/pi/install_pi.sh
```

After install, reboot the Pi to start Chromium kiosk automatically.

Setup-page kiosk fields are applied at startup from `config.json`:
- `monitor.width`
- `monitor.height`
- `kiosk.autoStart`
- `kiosk.chromiumFlags`

See `docs/RASPBERRY_PI_SETUP.md` for full install, service management, and troubleshooting.

## VS Code Tasks

- `Run PiBarTicker Backend` starts the FastAPI API with reload
- `Build PiBarTicker Frontend` runs a production frontend build
- `Run PiBarTicker Frontend` starts the Vite dev server on `0.0.0.0`
- `Run PiBarTicker Legacy` keeps the original bootstrap script available during transition

## Initial Backend Endpoints

- `/health`
- `/api/v1/app-shell`
- `/api/v1/config`
- `/api/v1/config/reset`
- `/api/v1/espn/proxy`
- `/api/v1/espn/team-logos`
- `/api/v1/espn/league-groups`
- `/api/v1/espn/discover-leagues`

Example team-logo call (Arizona Cardinals):

```text
GET /api/v1/espn/team-logos?sport=football&league=nfl&team=ari
```

## Phase 1 Config API

The backend now owns the initial persistent configuration model described in the rebuild spec, including:
- monitor settings
- Home Assistant settings
- HTTP settings
- kiosk settings
- boards configuration
- theme configuration

`GET /api/v1/config` loads the current config and creates a default `config.json` when missing.

`PUT /api/v1/config` replaces the full config with validated data.

`POST /api/v1/config/reset` restores the default config.

## Phase 1 Core Utilities

- `backend/app/core/paths.py` centralizes project/runtime paths and bootstraps runtime directories.
- `backend/app/core/http_client.py` provides a reusable HTTP client with timeout, retry/backoff, and cache hooks for upcoming ESPN integration.

## Next Build Areas

- ESPN league registry and scoreboard ingestion
- normalized live-state models per sport
- ticker UI MVP backed by app endpoints instead of direct ESPN calls
- richer setup workflows such as ordering, group filters, and module editing
