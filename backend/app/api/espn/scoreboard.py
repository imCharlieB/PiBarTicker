from __future__ import annotations

import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ...core.espn_normalizer import normalize_scoreboard_events
from ...core.espn_registry import resolve_registry_entry
from ...core.espn_scoreboard import EspnScoreboardClient
import json
import re

from ...core.groups_util import build_team_group_memberships_from_groups, build_team_group_memberships_from_standings
from ...core.logos.logo_store import LogoStore
from ...core.paths import get_runtime_paths
from ._utils import _groups_endpoint_url, _http_client, _normalized, _rankings_url, _site_standings_url

router = APIRouter()

_scoreboard_client = EspnScoreboardClient(_http_client)


def _parse_csv_filter_values(raw_values: str | None) -> set[str]:
    if not raw_values:
        return set()
    return {str(value).strip().lower() for value in raw_values.split(",") if str(value).strip()}


def _event_matches_game_filter(
    event: dict,
    game_filter: str,
    *,
    sport: str,
    week_filter_applied: bool,
    now_utc: datetime | None = None,
) -> bool:
    normalized_filter = _normalized(game_filter)
    if not normalized_filter or normalized_filter == "all":
        return True

    status = (event.get("status") or {}).get("type") or {}
    state = _normalized(status.get("state"))
    is_completed = bool(status.get("completed"))

    event_date_str = str(event.get("date") or "").strip()
    event_date = None
    if event_date_str:
        try:
            event_date = datetime.fromisoformat(event_date_str.replace("Z", "+00:00"))
        except ValueError:
            event_date = None

    now = now_utc or datetime.now(timezone.utc)

    if normalized_filter == "live":
        return state == "in" and not is_completed

    if normalized_filter == "today":
        if sport == "baseball":
            return True

        local_today = now.astimezone().date()
        return event_date is not None and event_date.astimezone().date() == local_today

    if normalized_filter == "upcoming":
        return state in {"pre", "postponed"} and (event_date is None or event_date >= now)

    if normalized_filter == "this-week":
        # For football with API-level week filtering enabled, the upstream response is already narrowed.
        if _normalized(sport) == "football" and week_filter_applied:
            return True
        if event_date is None:
            return False

        local_now = now.astimezone()
        local_event = event_date.astimezone()
        week_start = local_now - timedelta(days=local_now.weekday())
        week_end = week_start + timedelta(days=6)
        return week_start.date() <= local_event.date() <= week_end.date()

    return True


def _iter_event_competitors(event: dict) -> list[dict]:
    competitions = event.get("competitions") or []
    if not isinstance(competitions, list) or not competitions:
        return []

    competitors = (competitions[0] or {}).get("competitors") or []
    return competitors if isinstance(competitors, list) else []


def _event_matches_team_filter(event: dict, included_teams: set[str]) -> bool:
    if not included_teams:
        return True

    for competitor in _iter_event_competitors(event):
        team = competitor.get("team") or {}
        candidates = {
            _normalized(team.get("id")),
            _normalized(team.get("abbreviation")),
            _normalized(team.get("slug")),
            _normalized(team.get("displayName")),
            _normalized(team.get("name")),
        }
        if candidates.intersection(included_teams):
            return True

    return False



def _event_matches_group_filter(
    event: dict,
    included_groups: set[str],
    team_group_memberships: dict[str, set[str]],
) -> bool:
    if not included_groups:
        return True

    for competitor in _iter_event_competitors(event):
        team = competitor.get("team") or {}
        team_id = str(team.get("id") or "").strip()
        if not team_id:
            continue

        memberships = team_group_memberships.get(team_id) or set()
        if memberships.intersection(included_groups):
            return True

    return False


def _fetch_ap_ranked_team_ids(sport: str, league: str, top_n: int, cache_ttl: float) -> set[str]:
    """Fetch the ESPN AP Top 25 rankings and return the set of team IDs within the top_n."""
    try:
        payload = _http_client.get_json(
            _rankings_url(sport=sport, league=league),
            use_cache=cache_ttl > 0,
            cache_ttl_seconds=min(cache_ttl, 3600.0),
        )
        rankings_list = payload.get("rankings") or []
        for ranking in rankings_list:
            name = _normalized(ranking.get("name") or ranking.get("shortName") or "")
            if "ap" not in name and "associated press" not in name:
                continue
            ranked: set[str] = set()
            for entry in ranking.get("ranks") or []:
                current = entry.get("current")
                if current is None or int(current) > top_n:
                    continue
                team_id = str((entry.get("team") or {}).get("id") or "").strip()
                if team_id:
                    ranked.add(team_id)
            if ranked:
                return ranked
    except Exception:
        pass
    return set()


def _event_matches_rankings_filter(event: dict, ranked_team_ids: set[str]) -> bool:
    """Return True if at least one competitor is in the ranked set."""
    if not ranked_team_ids:
        return True
    for competitor in _iter_event_competitors(event):
        team_id = str((competitor.get("team") or {}).get("id") or "").strip()
        if team_id and team_id in ranked_team_ids:
            return True
    return False


@router.get("/scoreboard")
def get_scoreboard(
    league: str = Query(..., description="League id, for example nfl or mlb."),
    sport: str | None = Query(None, description="Optional sport slug. If omitted, registry mapping is used."),
    week: int | None = Query(None, ge=1, le=30, description="Optional football week filter."),
    use_week_filter: bool = Query(False, description="Apply week filtering when the league supports it."),
    game_filter: str = Query("all", description="Game filter: all, live, today, upcoming, this-week."),
    included_teams: str | None = Query(None, description="Comma-separated team ids/abbreviations/slugs."),
    included_groups: str | None = Query(None, description="Comma-separated group ids from league-groups."),
    rankings_limit: int | None = Query(None, ge=1, le=100, description="Only show games with a team ranked within top-N of the AP poll."),
    cache_ttl_seconds: float = Query(60.0, ge=0.0, le=3600.0),
) -> object:
    now = datetime.now(timezone.utc)

    try:
        entry = resolve_registry_entry(league, sport)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    try:
        effective_week = week if (use_week_filter and entry.supports_week_filter) else None
        fetch_result = _scoreboard_client.fetch(
            entry=entry,
            week=effective_week,
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN scoreboard: {error}") from error

    payload = fetch_result.payload
    raw_events = payload.get("events") if isinstance(payload, dict) else []
    events = raw_events if isinstance(raw_events, list) else []

    parsed_included_teams = _parse_csv_filter_values(included_teams)
    parsed_included_groups = _parse_csv_filter_values(included_groups)

    team_group_memberships: dict[str, set[str]] = {}
    if parsed_included_groups:
        # Use team-meta cache if populated during sync (avoids extra ESPN API call)
        try:
            store = LogoStore()
            meta = store.load_league_meta(entry.league_id)
            if meta.teams and any(t.groups for t in meta.teams.values()):
                for team_id, team_info in meta.teams.items():
                    if team_info.groups:
                        team_group_memberships[team_id] = set(team_info.groups)
        except Exception:
            pass

        if not team_group_memberships:
            # Fall back to live ESPN fetch when team-meta hasn't been synced yet
            try:
                groups_payload = _http_client.get_json(
                    _groups_endpoint_url(sport=entry.sport, league=entry.league),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                groups = groups_payload.get("groups") or []
                team_group_memberships = build_team_group_memberships_from_groups(
                    groups if isinstance(groups, list) else []
                )

                if not team_group_memberships:
                    standings_payload = _http_client.get_json(
                        _site_standings_url(sport=entry.sport, league=entry.league),
                        use_cache=cache_ttl_seconds > 0,
                        cache_ttl_seconds=cache_ttl_seconds,
                    )
                    standings_children = standings_payload.get("children") or []
                    team_group_memberships = build_team_group_memberships_from_standings(
                        standings_children if isinstance(standings_children, list) else []
                    )
            except Exception:
                team_group_memberships = {}

    # Fetch AP ranked team IDs once if rankings_limit is set (live, so rankings stay current)
    ap_ranked_team_ids: set[str] = set()
    if rankings_limit and _normalized(entry.sport) != "racing":
        ap_ranked_team_ids = _fetch_ap_ranked_team_ids(
            sport=entry.sport,
            league=entry.league,
            top_n=rankings_limit,
            cache_ttl=cache_ttl_seconds,
        )

    filtered_events: list[dict] = []
    for event in events:
        if not _event_matches_game_filter(
            event,
            game_filter,
            sport=entry.sport,
            week_filter_applied=effective_week is not None,
            now_utc=now,
        ):
            continue
        if not _event_matches_team_filter(event, parsed_included_teams):
            continue
        if _normalized(entry.sport) != "racing" and not _event_matches_group_filter(event, parsed_included_groups, team_group_memberships):
            continue
        if ap_ranked_team_ids and not _event_matches_rankings_filter(event, ap_ranked_team_ids):
            continue
        filtered_events.append(event)

    # For racing leagues (NASCAR Cup/Xfinity/Trucks via nascar-*, F1, Indy, etc.),
    # ESPN's scoreboard "events" array is frequently empty (or only contains a just-finished "post" event)
    # when the next race is still "in a few days". The authoritative list of all season races
    # (with dates) is in payload.leagues[0].calendar. When our filters leave zero events,
    # synthesize a single minimal upcoming "pre" event from the first future calendar entry.
    # This lets the ticker (which forces game_filter=all + visits every selected league in order)
    # actually show the scheduled race for NASCAR etc. instead of blank/empty slot.
    # The synthetic is shaped so normalize_scoreboard_events produces a usable game (title/date/state=pre).
    # Current/live events (when present) still win and get full competitor/racingEntries data.
    if not filtered_events and _normalized(entry.sport) == "racing":
        try:
            cal = (payload.get("leagues") or [{}])[0].get("calendar") or []
            for item in cal:
                start_str = str((item or {}).get("startDate") or "").strip()
                if not start_str:
                    continue
                try:
                    ev_date = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                except Exception:
                    continue
                if ev_date >= now:
                    ref = str(((item or {}).get("event") or {}).get("$ref") or "")
                    cal_id = ref.rstrip("/").split("/")[-1].split("?")[0] if ref else ""
                    fake_event = {
                        "id": cal_id or f"cal-{start_str[:10]}",
                        "date": start_str,
                        "shortName": (item or {}).get("label") or (item or {}).get("name") or entry.league_id,
                        "name": (item or {}).get("label") or (item or {}).get("name"),
                        "status": {
                            "type": {
                                "state": "pre",
                                "name": "Scheduled",
                                "detail": "Upcoming",
                                "completed": False,
                            }
                        },
                        "competitions": [
                            {
                                "venue": {},
                                "broadcasts": [],
                                "odds": [],
                                "competitors": [],
                            }
                        ],
                    }
                    filtered_events.append(fake_event)
                    break  # just the next upcoming one
        except Exception:
            # best-effort only; fall back to whatever (possibly empty) we had
            pass

    filtered_payload = dict(payload) if isinstance(payload, dict) else {"events": filtered_events}
    filtered_payload["events"] = filtered_events
    normalized_games = normalize_scoreboard_events(
        entry=entry,
        events=filtered_events,
    )

    # For racing leagues: enrich teamColor from the logo_store cache when ESPN
    # doesn't include it directly in the scoreboard competitor data.
    if entry.sport == "racing":
        try:
            store = LogoStore()
            meta = store.load_league_meta(entry.league_id)

            # NASCAR: enrich entries from cached per-series meta (nascar-cup.json etc.)
            # ESPN uses "nascar-premier" / "nascar-truck"; cf.nascar.com uses "nascar-cup" / "nascar-trucks".
            _NASCAR_ESPN_TO_CACHE: dict[str, str] = {
                "nascar-premier": "nascar-cup",
                "nascar-truck": "nascar-trucks",
            }
            nascar_drivers_meta = None
            nascar_series_logo: str = ""
            _is_nascar = "nascar" in entry.league_id.lower() or "nascar" in entry.league.lower()
            if _is_nascar:
                nascar_cache_id = _NASCAR_ESPN_TO_CACHE.get(entry.league_id, entry.league_id)
                try:
                    nascar_drivers_meta = store.load_league_meta(nascar_cache_id)
                except Exception:
                    pass
                try:
                    series_meta_path = get_runtime_paths().team_meta / "nascar-series.json"
                    series_data: dict = json.loads(series_meta_path.read_text(encoding="utf-8"))
                    nascar_series_logo = str(series_data.get(nascar_cache_id) or series_data.get(entry.league_id) or "").strip()
                except Exception:
                    pass

            # F1: auto-sync circuits in background when new ones appear in the F1 index
            f1_drivers_meta = None
            if entry.league_id == "f1":
                try:
                    f1_drivers_meta = store.load_league_meta("f1-drivers")
                except Exception:
                    pass
                try:
                    from ...core.logos.f1_cache_service import F1CacheService
                    import threading
                    def _bg_circuit_sync():
                        svc = F1CacheService()
                        try:
                            svc.sync_circuit_maps()
                        finally:
                            svc.close()
                    circuits_path = get_runtime_paths().team_meta / "f1-circuits.json"
                    try:
                        existing_circuits: dict = json.loads(circuits_path.read_text(encoding="utf-8"))
                    except Exception:
                        existing_circuits = {}
                    # Trigger background sync if any F1 game has no circuit in the local cache.
                    # ESPN venue is null for all F1 events, so we use the game title to check.
                    known_circuit_keys = set(existing_circuits.keys()) - {"_ts"}
                    has_uncached = bool(normalized_games and not known_circuit_keys)
                    if not has_uncached:
                        for g in normalized_games:
                            g_title = str(g.get("title") or "").lower()
                            if g_title and not any(
                                kk.replace("_", " ") in g_title or g_title in kk.replace("_", " ")
                                for kk in known_circuit_keys
                            ):
                                has_uncached = True
                                break
                    if has_uncached:
                        threading.Thread(target=_bg_circuit_sync, daemon=True).start()
                except Exception:
                    pass
            # Country name → adjective form used in ESPN race titles like "Australian Grand Prix".
            # This is stable language data, not race-specific.
            _COUNTRY_ADJECTIVES: dict[str, str] = {
                "australia": "australian",
                "austria": "austrian",
                "azerbaijan": "azerbaijani",
                "bahrain": "bahraini",
                "belgium": "belgian",
                "brazil": "brazilian",
                "canada": "canadian",
                "china": "chinese",
                "great britain": "british",
                "hungary": "hungarian",
                "italy": "italian",
                "japan": "japanese",
                "mexico": "mexican",
                "netherlands": "dutch",
                "saudi arabia": "saudi arabian",
                "spain": "spanish",
                "united kingdom": "british",
                "united states": "american",
            }
            # Build circuit lookup: text key → (image_url, circuit_name)
            f1_circuit_lookup: dict[str, tuple[str, str]] = {}
            if entry.league_id == "f1":
                try:
                    circuits_path = get_runtime_paths().team_meta / "f1-circuits.json"
                    circuits_data: dict = json.loads(circuits_path.read_text(encoding="utf-8"))
                    for map_key, val in circuits_data.items():
                        if map_key == "_ts":
                            continue
                        key_lower = map_key.replace("_", " ").lower()
                        if isinstance(val, str):
                            f1_circuit_lookup[key_lower] = (f"/logos/{val}", "")
                        elif isinstance(val, dict):
                            path = str(val.get("path") or "").strip()
                            if not path:
                                continue
                            img_url = f"/logos/{path}"
                            circuit_name = str(val.get("circuit_name") or "").strip()
                            entry_pair = (img_url, circuit_name)
                            country_lower = str(val.get("country") or "").strip().lower()
                            for k in (
                                key_lower,
                                str(val.get("location") or "").strip().lower(),
                                country_lower,
                                circuit_name.lower(),
                                _COUNTRY_ADJECTIVES.get(country_lower, ""),
                            ):
                                if k:
                                    f1_circuit_lookup[k] = entry_pair
                except Exception:
                    pass

            # Fetch cf.nascar.com live feed for lap/flag data when a NASCAR race is active.
            # Generic endpoint covers whichever series is currently live.
            nascar_live_data: dict | None = None
            if _is_nascar and any(str(g.get("state") or "").lower() == "in" for g in normalized_games):
                try:
                    nascar_live_data = _http_client.get_json(
                        "https://cf.nascar.com/live/feeds/live-feed.json",
                        use_cache=True,
                        cache_ttl_seconds=5.0,
                    )
                except Exception:
                    pass

            for game in normalized_games:
                for race_entry in game.get("racingEntries") or []:
                    if not race_entry.get("teamColor"):
                        team_id = str(race_entry.get("teamId") or "").strip()
                        if team_id and team_id in meta.teams:
                            race_entry["teamColor"] = meta.teams[team_id].color
                    # F1 surname join — ESPN has no teamId for F1 entries.
                    # Normalize accents so "Pérez" → "perez", "Hülkenberg" → "hulkenberg".
                    if f1_drivers_meta and not race_entry.get("teamColor"):
                        full_name = str(race_entry.get("name") or "").strip()
                        _raw = full_name.split()[-1] if full_name else ""
                        surname = unicodedata.normalize("NFKD", _raw).encode("ascii", "ignore").decode().lower()
                        driver = f1_drivers_meta.teams.get(surname)
                        if driver:
                            if driver.color:
                                race_entry["teamColor"] = driver.color
                            if driver.logos.get("headshot") and not race_entry.get("headshot"):
                                race_entry["headshot"] = driver.logos["headshot"]

                    # NASCAR surname join — inject headshot, car number, badge image
                    if _is_nascar:
                        # Fallback: ESPN CDN headshot from athleteId (no sync required)
                        athlete_id = str(race_entry.get("athleteId") or "").strip()
                        if athlete_id and not race_entry.get("headshot"):
                            race_entry["headshot"] = f"https://a.espncdn.com/i/headshots/rpm/players/full/{athlete_id}.png"
                        if nascar_drivers_meta:
                            full_name = str(race_entry.get("name") or "").strip()
                            surname = full_name.split()[-1].lower() if full_name else ""
                            driver = nascar_drivers_meta.teams.get(surname)
                            if driver:
                                # Prefer locally-cached images (relative paths served via /logos/)
                                if driver.logos.get("headshot") and not race_entry.get("headshot"):
                                    race_entry["headshot"] = driver.logos["headshot"]
                                car_num = str(driver.remote_urls.get("car_number") or "").strip()
                                if car_num and not race_entry.get("carNumber"):
                                    race_entry["carNumber"] = car_num
                                # Use local cached badge if available, else fall back to CDN URL
                                if not race_entry.get("carBadge"):
                                    local_badge = driver.logos.get("badge")
                                    if local_badge:
                                        race_entry["carBadge"] = local_badge
                                    else:
                                        cdn_badge = str(driver.remote_urls.get("badge_image") or "").strip()
                                        if cdn_badge:
                                            race_entry["carBadge"] = cdn_badge
                                if driver.color and not race_entry.get("teamColor"):
                                    race_entry["teamColor"] = driver.color

            # Inject seriesLogo for NASCAR so the frontend can display the real series logo
            if nascar_series_logo:
                game["seriesLogo"] = nascar_series_logo

            # Inject lap number, laps to go, and flag state from cf.nascar.com live feed
            if _is_nascar and nascar_live_data and str(game.get("state") or "").lower() == "in":
                _FLAG_INT_MAP = {1: "green", 2: "yellow", 3: "red", 4: "checkered", 5: "white", 8: "yellow"}
                lap_num = nascar_live_data.get("lap_number")
                laps_go = nascar_live_data.get("laps_to_go")
                flag_raw = nascar_live_data.get("flag_state")
                if lap_num is not None:
                    try:
                        game["lapNumber"] = int(lap_num)
                    except (TypeError, ValueError):
                        pass
                if laps_go is not None:
                    try:
                        game["lapsToGo"] = int(laps_go)
                    except (TypeError, ValueError):
                        pass
                if isinstance(flag_raw, int):
                    game["flagState"] = _FLAG_INT_MAP.get(flag_raw, "")
                elif isinstance(flag_raw, str):
                    fs = flag_raw.lower()
                    if fs in ("green", "yellow", "red", "caution", "checkered", "white"):
                        game["flagState"] = fs

            # Inject circuitImage + circuitName for F1 games.
            # ESPN returns venue:null for all F1 events, so we match against the
            # event title (shortName / name) which contains the race name.
            if f1_circuit_lookup and not game.get("circuitImage"):
                    venue = game.get("venue") or {}
                    venue_city = str(venue.get("city") or "").strip().lower()
                    venue_name = str(venue.get("name") or "").strip().lower()
                    game_title = str(game.get("title") or "").strip().lower()
                    status_detail = str((game.get("status") or {}).get("shortDetail") or "").strip().lower()
                    matched: tuple[str, str] | None = None
                    # Exact match on city, venue name, title, or known keys
                    for text in (venue_city, venue_name, game_title):
                        if text and text in f1_circuit_lookup:
                            matched = f1_circuit_lookup[text]
                            break
                    # Whole-word scan across all available text including race title
                    if not matched:
                        haystack = " ".join(filter(None, [venue_city, venue_name, status_detail, game_title]))
                        for key, pair in f1_circuit_lookup.items():
                            if key and re.search(r'\b' + re.escape(key) + r'\b', haystack):
                                matched = pair
                                break
                    if matched:
                        game["circuitImage"] = matched[0]
                        if matched[1]:
                            game["circuitName"] = matched[1]
        except Exception:
            pass

    event_count = len(filtered_events)
    return {
        "sport": entry.sport,
        "league": entry.league,
        "leagueId": entry.league_id,
        "scoreboardUrl": entry.scoreboard_url,
        "week": effective_week,
        "supportsWeekFilter": entry.supports_week_filter,
        "appliedFilters": {
            "useWeekFilter": use_week_filter,
            "gameFilter": _normalized(game_filter) or "all",
            "includedTeams": sorted(parsed_included_teams),
            "includedGroups": sorted(parsed_included_groups),
            "rankingsLimit": rankings_limit,
            "apRankedTeamCount": len(ap_ranked_team_ids),
        },
        "rawEventCount": len(events),
        "eventCount": event_count,
        "normalizedGameCount": len(normalized_games),
        "normalizedGames": normalized_games,
        "resilience": {
            "fallbackUsed": fetch_result.fallback_used,
            "source": fetch_result.source,
        },
        "scoreboard": filtered_payload,
    }
