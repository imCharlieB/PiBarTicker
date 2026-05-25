# PiBarTicker Rebuild Specification (Pi-First Scope)

This document is the single source of truth for rebuilding the current PiBarTicker concept as a new application.

It consolidates the intent from:
- `README.md`
- `DEV_NOTES.md`
- `LEAGUE_FILTERING_STRATEGY.md`
- `ESPN_API_REFERENCE.md`
- `help/MODULARIZATION_PLAN.md`

Use this document as the build brief for a replacement app. Where older notes conflict, this document wins.

Scope note:
- This phase is Raspberry Pi-first.
- The immediate goal is a stable Pi kiosk deployment, including startup behavior and fullscreen kiosk mode.
- Cross-platform packaging can be revisited after the Pi build is stable.

---

## 1. Product Summary

The rebuilt app is a kiosk-style sports scoreboard and utility dashboard designed for stretched bar monitors and similar always-on display setups, with Raspberry Pi as the primary deployment target.

Primary use case:
- Display one sports league at a time in a full-width scrolling ticker.
- Show a persistent lower-third for Home Assistant data and future modules like news, weather, and stocks.
- Be configurable from a web-based setup UI.
- Boot directly into fullscreen Chromium kiosk mode.

Primary deployment target:
- Raspberry Pi 4 or 5
- Single bar display around `1920x380` or dual-bar layout around `3840x380`

Future deployment targets (later phase):
- Windows, macOS, or Linux desktop hardware
- small form-factor PCs or other kiosk-capable devices

---

## 2. Core Product Goals

The rebuilt application must:

1. Show live and upcoming sports data from ESPN.
2. Support multiple leagues with per-league configuration.
3. Rotate one league at a time in the main marquee area.
4. Show a persistent lower-third module area.
5. Allow all configuration through a web setup page.
6. Cache league and team metadata locally.
7. Cache logos locally and serve them from the app.
8. Continue functioning when ESPN is temporarily unavailable by using cached data.
9. Be modular so new content types can be added without rewriting the core ticker.

Non-goals for the first rebuild:
- No need for a native app.
- No user accounts or authentication system beyond local network access.
- No cloud sync.
- No admin CMS.

---

## 3. Recommended Technology Stack

Preferred backend:
- Python + FastAPI

Acceptable alternative:
- Python + Flask

Why:
- Python fits the existing ESPN/HA integration work.
- FastAPI gives cleaner async behavior, validation, and API docs.
- The app is local-first and does not require a heavy backend framework.

Frontend:
- React is the recommended frontend approach
- Vite is the recommended frontend build tool
- Keep the React app lean and kiosk-focused
- Avoid unnecessary complexity for the kiosk runtime

Runtime environment:
- Raspberry Pi OS
- Chromium kiosk mode
- Local web server on `localhost`

### Frontend implementation guidance

Recommended frontend stack:
- React
- Vite
- React Router only if needed for setup/detail page flow
- CSS variables for theming

Guidelines:
- prefer simple component structure over heavy abstractions
- keep state management lightweight unless app complexity clearly requires more
- optimize for a stable kiosk display and fast initial load
- separate setup UI concerns from live ticker rendering concerns

---

## 4. Product Architecture

The rebuilt app should be split into clear modules.

### Backend modules

- `core`
  - config loading/saving
  - caching helpers
  - HTTP fetch utilities
  - file/path utilities

- `leagues`
  - one module per sport family or league family
  - examples: `football`, `basketball`, `baseball`, `hockey`
  - responsible for ESPN fetch/parsing, normalization, team meta generation

- `logos`
  - league logo caching
  - team logo caching
  - local logo serving

- `news`
  - ESPN or RSS headline fetching

- `boards/modules`
  - lower-third content providers
  - Home Assistant, weather, stocks, clock, news

- `scheduler`
  - periodic refresh jobs for scoreboard and cache updates

### Frontend surfaces

- `index` or main kiosk page
  - live display only

- `setup`
  - configuration UI
  - league enable/disable
  - order and filters
  - team inclusion/exclusion

- optional per-league detail views
  - only if needed for cleaner UI organization

### Setup-first flow requirements

Before heavy ticker editing workflows, the setup experience should support a clean first-run path:

- setup should be organized into focused pages (for example: Overview, Display, Theme, Services, Ticker)
- Overview should provide a clear completion checklist for required setup sections
- each checklist or overview section should deep-link to its related settings page
- required setup fields should be validated inline (not only in global status banners)
- save should be blocked while required setup data is invalid
- setup should expose unsaved-changes state so users know when edits are pending
- include a Save and Continue flow to reduce setup friction on first launch
- advanced controls should be visually separated from essential first-run controls

### Storage model

- `config.json`
  - persistent user configuration

- `team-meta/{league}.json`
  - normalized per-league metadata cache

- `logos/{league}/`
  - locally cached league and team logos

- optional runtime cache directory for scoreboard payloads

---

## 5. Display and UX Requirements

### Main ticker area

- Designed for a stretched bar monitor.
- Occupies roughly `300-320px` of height in a `380px` tall layout.
- Displays one active league at a time.
- Uses a single-pass marquee or equivalent scrolling presentation.
- League changes happen after the current league completes its display cycle.

Each game card should be able to show:
- away team
- home team
- team logos
- score
- game status
- live game state details when available from ESPN
- broadcast info when enabled
- odds when enabled and available
- venue or supplemental info if space permits

### Rich live-state requirements

The live display should not be limited to score-only output.

When the underlying sport supports it, the normalized scoreboard model and UI should surface in-progress details such as:
- baseball or softball:
  - inning
  - top or bottom of inning
  - number of outs
  - runners on base
  - balls, strikes, outs when available
- football:
  - quarter
  - clock
  - possession or red-zone context if available
- basketball:
  - quarter
  - clock
  - bonus state if available
- hockey:
  - period
  - clock
  - power play state if available

This data should be normalized into a sport-aware live state object so the frontend can render richer in-game context without depending on raw ESPN structures.

Implementation note for this phase:
- Treat this as a league-specific live-view model.
- Each league can define its own live-state details and rendering rules.
- A single strict global schema is not required in the first Pi-focused implementation and can be standardized later.

### Lower third area

- Always visible.
- Occupies roughly `60-80px` in height.
- Independent from the main sports ticker.
- Used for Home Assistant sensors first.
- Must be designed so other modules can be added later.

### Theming requirements

The app should support multiple visual themes without changing code.

Required theme modes:
- dark
- light
- team-based theme

Team-based theming should:
- use a selected team's primary and alternate colors as the base palette
- optionally use the selected team's cached logo as a branding element in setup and live views
- maintain readable contrast for text, scores, and status indicators
- work consistently across the setup UI and the live ticker

Theme behavior rules:
- theme selection should be configurable from the setup UI
- dark and light themes must be available globally even if no team theme is selected
- a team theme should be selectable from available cached team metadata
- the frontend should derive CSS variables or equivalent theme tokens from the selected theme
- the app should fall back safely if a team color is missing or has poor contrast

### Readability and accessibility guardrails

- maintain minimum readable contrast for text and icons in all modes, including team-based themes
- provide automatic fallback colors when team colors create low contrast
- keep text sizing appropriate for bar displays at distance
- when both icon and text are present, preserve text readability first
- ensure text-only fallback rendering works when icons fail or are unavailable
- ensure setup controls remain touch-friendly for tablet/mobile configuration

### League rotation behavior

- Only one league is visible in the main area at a time.
- On animation completion or timer completion:
  - advance to the next enabled league
  - fetch or read cached data for that league
  - replace the visible cards
  - restart the scroll cleanly

### Refresh behavior

- Backend refreshes enabled league data every `30-60` seconds.
- Frontend should not spam ESPN directly.
- Frontend reads app endpoints, not ESPN endpoints.

### Resilience behavior

- If ESPN is unreachable, show last known cached data.
- If a league has no games, show a clean empty-state card or skip per config.
- If config changes, ticker resets to the new league order and filters.

---

## 6. Configuration Requirements

The app must use a `boards`-based configuration model.

### Required top-level config sections

- `monitor`
- `homeAssistant`
- `http`
- `kiosk`
- `boards`
- `theme`

### Example conceptual structure

```json
{
  "monitor": {
    "mode": "dual",
    "width": 3840,
    "height": 380
  },
  "homeAssistant": {
    "url": "http://homeassistant.local:8123",
    "token": "LONG_LIVED_TOKEN"
  },
  "http": {
    "enabled": false,
    "port": 8080
  },
  "kiosk": {
    "autoStart": "autostart",
    "chromiumFlags": [
      "--kiosk",
      "--noerrdialogs",
      "--disable-infobars"
    ]
  },
  "boards": [
    {
      "id": "live-sports",
      "type": "sports",
      "name": "Live Scores",
      "enabled": true,
      "rotateSeconds": 45,
      "scroll": true,
      "refreshSeconds": 45,
      "leagues": []
    },
    {
      "id": "ha-bar",
      "type": "home-assistant",
      "enabled": true,
      "haSensors": []
    }
  ],
  "theme": {
    "mode": "dark",
    "background": "#0a0a0a",
    "accent": "#00ff00",
    "teamTheme": {
      "enabled": false,
      "league": "nfl",
      "team": "ARI"
    }
  }
}
```

### Theme config requirements

The theme configuration should support:
- `mode`: `dark`, `light`, or `team`
- base color tokens for manual override when needed
- an optional selected team theme source:
  - league id
  - team abbreviation or team id

When `mode` is `team`:
- derive theme colors from the selected team's metadata
- use `color` as the primary theme input
- use `alternateColor` as the secondary theme input when suitable
- optionally expose the team's primary logo for branded UI areas

### League config requirements

Each sports league entry should support:
- `id`
- `name`
- `url`
- `enabled`
- `showTV`
- `showOdds`
- `showNews`
- `showInTicker`
- `gameFilter`
- `useWeekFilter`
- optional team/group inclusion settings

Supported league IDs at minimum:
- `nfl`
- `college-football`
- `cfl`
- `xfl`
- `ufl`
- `nba`
- `mlb`
- `nhl`

---

## 7. ESPN Integration Requirements

### Base endpoints

Use ESPN Site API and Core API where appropriate.

- Site API v2:
  - `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/{resource}`
- Core API v2:
  - `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/{resource}`

### Primary resources

- `/scoreboard`
  - main scoreboard feed

- `/teams`
  - team list, abbreviations, colors, logos

- `/calendar`
  - week/date metadata for supported sports

- `/news`
  - league news if needed

- standings and summary endpoints are optional for phase 2+

### ESPN data rules

- The app backend talks to ESPN.
- The frontend talks only to the app backend.
- Normalize all ESPN data before returning it to the frontend.
- Avoid tightly coupling frontend rendering to raw ESPN response shape.

### Rate limit posture

- Keep request volume conservative.
- Cache responses.
- Refresh on schedule, not per browser repaint.
- Use small delays between bulk logo downloads if needed.

---

## 8. League Filtering Strategy

This is a critical requirement and should be implemented intentionally, not as ad hoc query logic.

### Football leagues

The following leagues should use API-level week filtering where available:
- `nfl`
- `college-football`
- `cfl`
- `xfl`
- `ufl`

Use `?week=` for football scoreboard requests.

NFL also supports `seasontype`:
- `1` preseason
- `2` regular season
- `3` postseason

### Non-football leagues

The following should use client-side filtering after the backend fetches the normal scoreboard:
- `mlb`
- `nba`
- `nhl`
- soccer if added later

Reason:
- ESPN already naturally constrains these scoreboards to current or nearby games.
- `week` is not the right control for those sports.

### Filtering behavior by league type

- Football:
  - determine current week from calendar or configured selection
  - request only that week when practical

- MLB/NBA/NHL:
  - fetch scoreboard
  - filter by today, live, upcoming, or all according to config

### Recommended league filter modes

- `all`
- `today`
- `upcoming`
- `live`
- `this-week`

---

## 9. Backend API Contract

The rebuild should expose stable app endpoints.

### Required endpoints

- `GET /api/config`
  - return current config JSON

- `POST /api/config`
  - validate and save config
  - must always return JSON

- `GET /api/teams?league=<id>`
  - return normalized teams and league metadata

- `GET /api/groups?league=<id>`
  - return divisions, conferences, or group structures when supported

- `POST /api/cache-logos`
  - cache team logos for specified leagues or all enabled leagues

- `POST /api/cache-league-logos`
  - cache league identity logos

- `GET /logos/<league>/<filename>`
  - serve cached logo files from local storage

- `GET /api/scoreboard?league=<id>`
  - return normalized scoreboard data for the requested league

- `GET /api/news?league=<id>`
  - optional phase 1 if lower-third news is included immediately

### API design rules

- Every API response must be JSON except image responses.
- Errors must be JSON.
- Avoid HTML error pages for API routes.
- Normalize casing for league IDs internally.
- Validate league IDs before file or cache operations.

---

## 10. Team Metadata Contract

Every enabled league should have one metadata file at:

- `team-meta/{league}.json`

There must be no root-level duplicate metadata files.

### Required file structure

```json
{
  "ts": "2026-05-24T00:00:00Z",
  "league": "nfl",
  "teams": [
    {
      "id": "22",
      "abbreviation": "ARI",
      "displayName": "Arizona Cardinals",
      "location": "Arizona",
      "color": "a40227",
      "alternateColor": "ffffff",
      "logo": "/logos/nfl/ARI.png",
      "logos": {
        "full_default": "/logos/nfl/ARI_full_default.png"
      },
      "originalLogoUrl": "https://...",
      "isActive": true,
      "links": []
    }
  ]
}
```

### Metadata rules

- `color` and `alternateColor` should come from ESPN when present.
- Use gray only as a fallback if ESPN provides no team color.
- Include only fields that help rendering or configuration.
- Keep the structure stable across all leagues.

---

## 11. Logo System Requirements

The logo system must be rebuilt carefully because it is a high-risk area.

### Directory layout

- `logos/{league}/league.png`
- `logos/{league}/league-dark.png` when available
- `logos/{league}/{ABBR}.png`
- `logos/{league}/{ABBR}_{rel tokens}.png` for saved team variants

League folder names must be canonical lowercase IDs.

Examples:
- `logos/nfl/league.png`
- `logos/nfl/ARI.png`
- `logos/nfl/ARI_full_default.png`

Do not use parallel folders like `logos/NFL` and `logos/nfl`.

### League logo rules

- Cache league logos when setup loads or when explicitly requested.
- Save a default league logo as `league.png`.
- Save a dark variant as `league-dark.png` if ESPN provides one.

### Team logo rules

- Team logo files must come only from that exact team's ESPN `logos` list.
- Never reuse another team's asset.
- Only save PNG variants.
- Main team logo should be saved as `{ABBR}.png`.
- Additional saved files should use exact `rel` tokens in order:
  - `{ABBR}_full_default.png`
  - `{ABBR}_full_dark.png`
  - `{ABBR}_full_scoreboard.png`
  - etc.

### Logo selection rules

- Prefer a scoreboard-style PNG for `{ABBR}.png` if one exists.
- Otherwise prefer the closest primary/default PNG.
- Frontend should use `logo` for simple display and `logos` for context-sensitive display.

### Safety rules

- Canonicalize league folder names to lowercase.
- Before recaching a league, clear old team logo files for that league while preserving `league*.png`.
- Do not append hashes or random suffixes to filenames.
- Do not create duplicate files under different case variants of the same league folder.

### Validation requirements

Before logo work is considered correct:

1. Spot check at least 3 teams per league visually.
2. Confirm no mixed-team logos exist.
3. Confirm all files serve from the same canonical lowercase folder.
4. Confirm setup page and ticker read the same file paths.

---

## 12. Setup UI Requirements

The setup experience should have three levels.

### Main setup page

- Display all available leagues.
- Show each league's identity logo.
- Allow enable/disable.
- Allow league ordering.
- Each league should be displayed as a draggable card or box.
- Drag-and-drop order on this page defines the order the leagues appear in the main scrolling ticker.
- Include theme controls so the user can choose dark, light, or a team-based theme.
- Save changes to `config.json`.

### League setup page

- Open when the user clicks a league on the main setup page.
- Show league-level settings.
- Show teams in that league.
- Support group/division filtering where applicable.
- Trigger team logo caching when the league is enabled or refreshed.

### Team setup page

- Open when the user clicks a team from the league setup page.
- Show team details.
- Show cached logo variants for that team.
- Allow include/exclude toggles if team-level filtering is supported.
- Allow using that team as the active app theme source.

### Setup behavior rules

- Setup page must read from `/api/config`.
- Save must post to `/api/config` and receive JSON.
- Enabling a league should refresh its meta and logos.
- UI must not silently remove leagues from config.
- The saved league order must be the same order used by the live ticker rotation.

---

## 13. Home Assistant and Future Modules

The application is not only a sports app. It is a modular ticker shell.

### Required initial module

- Home Assistant lower-third sensor bar

### Home Assistant push-display requirements

Home Assistant must be able to send display content into the app, not just act as a passive data source.

Required behavior:
- normal mode shows sports content plus the configured lower third
- Home Assistant can push a message that interrupts or overlays the normal content
- after the configured timeout expires, the screen returns to normal mode automatically unless the message is marked persistent

Required message presentation modes:
- full-width banner
- lower-third message
- temporary overlay
- persistent alert card

Supported use cases:
- display a Home Assistant sensor value on the screen
- show automation-triggered text
- receive custom messages from Home Assistant
- prioritize urgent alerts over sports content when configured

Suggested integration options:
- MQTT subscription as the preferred Home Assistant-to-screen messaging path
- inbound webhook/API endpoint as a secondary fallback for direct calls and testing
- Home Assistant entity-driven message source as an optional simple-input mode

Minimum message contract should support fields such as:
- `text`
- `icon`
- `mode`
- `priority`
- `duration`
- `theme`
- `persistent`
- `displayId` (optional)
- `messageId` (optional)
- optional target area or module identifier

Reference message payload example:

```json
{
  "messageId": "msg-20260524-001",
  "text": "Garage door has been open for 10 minutes",
  "icon": "mdi:garage-open",
  "mode": "banner",
  "priority": "high",
  "duration": 30,
  "persistent": false,
  "theme": "warning",
  "displayId": "main-bar-1"
}
```

Icon support requirements:
- messages may include an icon alongside text
- support Home Assistant `mdi:` icon identifiers
- support local bundled SVG/icon assets
- support cached team or league logos when appropriate
- the UI should render text-only messages cleanly when no icon is provided

Recommended MQTT topic model:
- `sportscreen/message`
- `sportscreen/banner`
- `sportscreen/lowerthird`
- `sportscreen/overlay`
- `sportscreen/alert`
- `sportscreen/clear`

Scoped topic model for multiple displays (optional):
- `sportscreen/{displayId}/message`
- `sportscreen/{displayId}/banner`
- `sportscreen/{displayId}/lowerthird`
- `sportscreen/{displayId}/overlay`
- `sportscreen/{displayId}/alert`
- `sportscreen/{displayId}/clear`

MQTT design rules:
- use MQTT for event-driven Home Assistant-to-screen messaging
- use API/webhook endpoints for admin, manual testing, and fallback control
- support multiple display instances subscribing to the same or scoped topics if needed later
- payloads should be JSON and versionable
- single-display deployments may use the unscoped topics, but the app should still support optional `displayId` filtering

Priority behavior rules:
- high-priority alerts may interrupt sports content immediately
- lower-priority messages may be confined to the lower third
- persistent alerts must remain visible until cleared or replaced
- timeout-based messages must expire cleanly and restore the prior screen state

Message interruption and queue rules:
- if a higher-priority message arrives, it preempts lower-priority active messages
- if equal-priority timed messages arrive while one is active, queue them FIFO by arrival time
- if a persistent message is active, only equal-or-higher priority messages may replace it
- `clear` commands should support clearing by `messageId`, by mode, or all active messages
- after message expiry or clear, restore the most recent normal screen state without restarting the app

### Home Assistant onboarding flow

- first-run setup should include MQTT broker host, port, auth, and topic prefix
- include a "test connection" action in setup
- include a "test message" action to validate end-to-end delivery
- store MQTT settings in config and support reconnection with exponential backoff
- if broker connection fails, continue normal sports display and surface a non-blocking status indicator

### Future modules to support cleanly

- weather
- stocks
- news
- clock/date

### Module design rules

Each module should:
- have its own backend data provider
- be independently configurable
- have a consistent response contract for frontend rendering
- be enable/disable-able without affecting the sports ticker architecture

Home Assistant messaging should be treated as a first-class module/overlay system, not a one-off special case.

---

## 14. Security and Environment Requirements

- Home Assistant token is stored only in `config.json`.
- Do not expose the HA token to the frontend.
- App runs locally on the Pi.
- Reverse proxy is optional, not required.
- Environment differences between local dev and production should be minimal.

Required runtime assets:
- `config.json`
- `team-meta/`
- `logos/`

### Pi kiosk operational requirements

- support boot-to-app behavior on Raspberry Pi
- support automatic app restart on crash (service/watchdog)
- support automatic browser kiosk launch after backend/frontend readiness
- provide offline startup behavior using cached data when network is unavailable
- provide a health endpoint for local monitoring
- document log file locations and service management commands

---

## 15. Error Handling Requirements

The new app should fail predictably.

### API errors

- Return JSON error payloads.
- Include actionable messages.
- Never return HTML to frontend API calls.

### ESPN failures

- Use last known cache.
- Log upstream failure with league and endpoint context.
- Retry on the next normal refresh cycle.

### Logo failures

- If a variant download fails, continue processing the rest.
- If no team logo can be cached, use a local placeholder or omit gracefully.

### Config failures

- Validate schema before save.
- Keep a safe backup copy.
- Do not overwrite config with partial test payloads.

### Cache retention policy

- scoreboard cache: short TTL suitable for live updates (for example 30-60 seconds)
- team-meta cache: medium TTL (for example 12-24 hours) with manual refresh option
- logo cache: long-lived until explicit recache or upstream format change
- HA message cache/history: short retention for troubleshooting only, configurable and optional
- stale cache should be marked and surfaced in diagnostics when data age exceeds configured thresholds

---

## 16. Testing and QA Requirements

The rebuild should include both automated and manual validation.

### Automated checks

- config read/write tests
- league endpoint normalization tests
- scoreboard parsing tests per sport family
- team meta generation tests
- logo path generation tests
- API response shape tests

### Manual QA checklist

- Enable a league and verify logos download.
- Confirm setup page shows all configured leagues.
- Confirm save returns JSON and persists changes.
- Confirm ticker rotates correctly through enabled leagues.
- Confirm football week filtering works.
- Confirm MLB/NBA/NHL client-side filters work.
- Confirm team colors render correctly.
- Confirm app survives ESPN failure using cache.
- Confirm Home Assistant can push a temporary banner message.
- Confirm Home Assistant can push a lower-third message without breaking the ticker.
- Confirm a persistent alert remains until cleared.
- Confirm timed messages expire and the screen returns to normal content.
- Confirm high-priority alerts override normal sports display when configured.

### Logo QA checklist

- Compare at least 3 teams per league visually.
- Confirm `/{league}/{ABBR}.png` serves correctly.
- Confirm no mixed-case duplicate league directories are used.
- Confirm all logo references in metadata use lowercase league paths.

---

## 17. Rebuild Phases

### Phase 1: Foundation

- scaffold backend structure
- implement config system
- implement canonical league registry
- implement normalized scoreboard endpoint

### Phase 2: Sports data

- implement football module with week filtering
- implement baseball module
- implement basketball module
- implement hockey module
- generate `team-meta/{league}.json`

### Phase 3: Logo system

- implement league logo cache
- implement team logo cache
- implement canonical lowercase logo serving
- add validation tooling for logo cache integrity

### Phase 4: Setup UI

- main setup page
- league details page
- team details page
- config save and refresh flows

### Phase 5: Kiosk frontend

- main ticker rendering
- league rotation
- lower-third HA module
- graceful empty and error states

### Phase 6: Hardening

- test suite
- startup scripts
- kiosk boot flow
- docs and deployment checklist

---

## 18. Acceptance Criteria

The rebuild is acceptable when all of the following are true:

1. Fresh install works from documented steps.
2. User can configure leagues and HA from setup UI.
3. Main ticker rotates enabled leagues correctly.
4. Football leagues use week filtering.
5. MLB/NBA/NHL display current relevant games correctly.
6. Team colors come from ESPN metadata where available.
7. Team metadata exists only in `team-meta/{league}.json`.
8. Logos are cached and served from canonical lowercase league folders.
9. API endpoints always return JSON for non-image routes.
10. App remains usable when ESPN is temporarily unavailable.

---

## 19. Implementation Notes for the New Build Team

- Treat this as a rebuild, not a line-by-line port.
- Preserve the product behavior and deployment model.
- Simplify aggressively where the old app became fragile.
- Keep casing, file paths, and API contracts consistent.
- Build stable normalization layers between ESPN and the UI.
- Make logo handling boring and predictable.

If any older document disagrees with this one, this document should be treated as the canonical spec.