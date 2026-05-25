# PiBarTicker Build Todo (Pi-First)

Derived from REBUILD_SPEC.md and supporting docs.

## Phase 0: Foundations

- [x] Create backend app skeleton with FastAPI under backend/
- [x] Create frontend app skeleton with React + Vite under frontend/
- [x] Define shared project layout and module boundaries from spec
- [x] Add root-level scripts for run/dev/build and basic README updates

## Phase 1: Backend Core and Config

- [x] Implement config service for config.json (load, validate, save, defaults)
- [x] Add config model sections: monitor, homeAssistant, http, kiosk, boards, theme
- [x] Implement filesystem/path helpers and cache directory bootstrap
- [x] Implement HTTP client with retry, timeout, and response caching hooks
- [x] Add API endpoints for reading/updating app configuration

## Phase 2: ESPN Data Pipeline

- [x] Add backend ESPN proxy endpoint with host allowlist and TTL cache (`/api/v1/espn/proxy`)
- [x] Add backend endpoint for per-team logo payloads (`/api/v1/espn/team-logos`)
- [x] Add backend endpoint for league group metadata (`/api/v1/espn/league-groups`)
- [x] Add backend league discovery endpoint from ESPN core sports/leagues catalog (`/api/v1/espn/discover-leagues`)
- [x] Add standings-enriched group fallback for shallow college group feeds
- [x] Implement league registry mapping sport/league IDs to ESPN endpoints
- [x] Implement scoreboard fetcher using Site API v2
- [x] Implement football week-filter strategy (?week=) for NFL/CFB/CFL/XFL/UFL
- [x] Simplify setup/runtime league filtering to ESPN slate + live-only mode for consistent cross-league UX
- [x] Keep backend date/week filter support for compatibility while frontend uses simplified league filtering
- [ ] Add config migration for legacy league filter fields, then remove deprecated backend filter fields (`gameFilter`, `useWeekFilter`, `fallbackWhenEmpty`)
- [x] Normalize raw ESPN events into internal game model
- [x] Add sport-aware live-state mapping (football, baseball, basketball, hockey)
- [x] Add league-level resilience fallback to cached scoreboard payloads

## Phase 3: Team Metadata and Logos

- [ ] Implement team metadata fetch/cache per league to team-meta/{league}.json
- [ ] Implement logo caching pipeline for league/team logos under logos/{league}/
- [ ] Add backend endpoints to serve cached logos and metadata
- [ ] Add cache refresh/invalidation policy for logos and team metadata

## Phase 4: Scheduler and Boards Runtime

- [ ] Implement scheduler for periodic refresh (30-60s per enabled league)
- [ ] Implement board runtime model for sports board and home-assistant board
- [ ] Implement league rotation state machine (single active league, cycle on completion)
- [ ] Implement no-games behavior (empty card vs skip, configurable)

## Phase 5: Frontend Kiosk Display

- [ ] Build main kiosk surface with main ticker area + persistent lower third
- [ ] Build game card UI with logos, score, status, TV/odds/venue toggles
- [x] Build game card UI with logos, score, status, TV/odds/venue toggles
- [ ] Build league transition/scroll cycle behavior driven by backend data
- [x] Build league transition/scroll cycle behavior driven by backend data
- [ ] Add fallback rendering when logos or optional fields are unavailable
- [ ] Add text-size/contrast guardrails for distance readability
- [x] Add baseball live-card rendering for outs/count plus runner diamond and batting-side placement
- [x] Remove duplicate baseball live situation text when the dedicated live panel is shown

## Phase 6: Setup UI

- [x] Build setup page for monitor, kiosk, and HTTP settings
- [x] Split setup UI into page-based sections (Overview, Display, Theme, Services, Ticker)
- [x] Add Overview quick navigation cards that open the related setup section
- [x] Add first-run setup checklist with section completion states
- [x] Add required-field validation for setup-critical fields
- [x] Add inline validation messaging near invalid controls
- [x] Block save while required setup fields are invalid
- [x] Add unsaved-changes indicator and per-section dirty tracking
- [x] Add Save and Continue action for setup flow
- [ ] Build boards editor for sports board and lower-third modules
- [x] Build league editor (enable/disable, order, filters, showTV/showOdds/showNews)
- [x] Add team/group inclusion UI (including NFL groups endpoint support)
- [x] Add ESPN league catalog browse/add flow in Ticker setup
- [x] Expand league teams fetch size for large leagues (`teams?limit=1000`)
- [x] Build Home Assistant sensor configuration UI

## Phase 7: Theming System

- [x] Implement theme modes: dark, light, team
- [x] Implement CSS variable token generation from selected theme mode
- [x] Implement team-theme color derivation using color/alternateColor
- [x] Implement contrast checks and automatic fallback colors
- [x] Ensure setup UI and kiosk UI share same theme behavior

## Phase 8: Pi Kiosk Deployment

- [x] Add production build + startup scripts for Raspberry Pi OS
- [x] Add Chromium kiosk launch with required flags
- [x] Add autostart integration and recovery behavior on reboot
- [ ] Validate target monitor modes (1920x380 and 3840x380)

## Phase 9: Quality and Validation

- [ ] Add backend tests for config validation, ESPN normalization, filtering logic
- [ ] Add frontend tests for league rotation and card rendering states
- [ ] Add offline and ESPN-failure behavior tests using cached payloads
- [ ] Run end-to-end smoke test on a Pi device and document results

## Immediate Sprint (Recommended Next 8 Tasks)

- [x] Add setup first-run checklist and completion badges in Overview
- [x] Implement setup required-field validation and save blocking
- [x] Add inline validation errors for monitor, HTTP, and service fields
- [x] Add unsaved-changes indicator and save timestamp
- [x] Add Save and Continue flow between setup pages
- [x] Implement ESPN scoreboard client + league registry
- [x] Implement normalization model for one league (NFL) first
- [x] Implement week-filter strategy for football leagues

## Immediate Next Tasks (Ticker Runtime)

- [x] Build backend ticker data endpoint that applies `gameFilter`, `useWeekFilter`, and `includedGroups`
- [x] Resolve league group membership for each event competitor during normalization
- [x] Enforce included group/team filtering in ticker game selection
- [x] Add frontend ticker runtime view fed from backend ticker endpoint
- [x] Add test fixtures for NFL division filtering (example: NFC South only)
