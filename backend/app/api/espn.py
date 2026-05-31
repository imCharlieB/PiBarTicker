from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from ..core.espn_normalizer import normalize_scoreboard_events
from ..core.espn_registry import list_registry_entries, resolve_registry_entry
from ..core.espn_scoreboard import EspnScoreboardClient
from ..core.http_client import HttpClient, InMemoryResponseCache


router = APIRouter(prefix="/api/v1/espn", tags=["espn"])

_ALLOWED_HOSTS = {
    "site.api.espn.com",
    "sports.core.api.espn.com",
}

_http_client = HttpClient(
    timeout_seconds=8.0,
    max_retries=2,
    retry_backoff_seconds=0.4,
    cache=InMemoryResponseCache(),
)
_scoreboard_client = EspnScoreboardClient(_http_client)


def _validate_espn_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid URL.") from error

    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Only https URLs are allowed.")

    hostname = parsed.hostname or ""
    if hostname not in _ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="URL host is not allowed.")

    return url


def _teams_endpoint_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams"


def _core_team_endpoint_url(*, sport: str, league: str, team_id: str) -> str:
    return f"https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/teams/{team_id}?lang=en&region=us"

def _core_athlete_endpoint_url(*, sport: str, league: str, athlete_id: str) -> str:
    return f"https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/athletes/{athlete_id}?lang=en&region=us"


def _groups_endpoint_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/groups"


def _team_detail_endpoint_url(*, sport: str, league: str, team: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{team}"


def _core_sports_endpoint_url() -> str:
    return "https://sports.core.api.espn.com/v2/sports?lang=en&region=us"


def _core_sport_leagues_endpoint_url(*, sport: str) -> str:
    return f"https://sports.core.api.espn.com/v2/sports/{sport}/leagues?lang=en&region=us"


def _normalized(value: object) -> str:
    return str(value or "").strip().lower()


def _team_matches_query(team: dict, team_query: str) -> bool:
    query = _normalized(team_query)
    if not query:
        return False

    candidates = {
        _normalized(team.get("id")),
        _normalized(team.get("abbreviation")),
        _normalized(team.get("slug")),
        _normalized(team.get("name")),
        _normalized(team.get("displayName")),
        _normalized(team.get("shortDisplayName")),
    }
    candidates.discard("")
    return query in candidates


def _group_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _normalized(value)).strip("-")


def _normalize_ref_url(url: str) -> str:
    return url.replace("http://sports.core.api.espn.com", "https://sports.core.api.espn.com")


def _parse_sport_slug_from_ref(ref: str) -> str:
    match = re.search(r"/sports/([^/?]+)", ref)
    return match.group(1) if match else ""


def _parse_league_slug_from_ref(ref: str) -> str:
    match = re.search(r"/leagues/([^/?]+)", ref)
    return match.group(1) if match else ""


def _site_scoreboard_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard"


def _site_standings_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings"


def _flatten_groups(groups: list[dict], parent: dict | None = None) -> list[dict[str, object]]:
    flattened: list[dict[str, object]] = []

    for group in groups:
        raw_group_id = str(group.get("id") or "").strip()
        name = str(group.get("name") or "").strip()
        abbreviation = str(group.get("abbreviation") or "").strip()
        group_id = raw_group_id or _group_key(abbreviation or name)

        if parent and group_id:
            parent_key = str(parent.get("id") or "").strip()
            if parent_key:
                group_id = f"{parent_key}:{group_id}"

        if group_id or name:
            flattened.append(
                {
                    "id": group_id,
                    "name": name,
                    "abbreviation": abbreviation,
                    "parent": parent,
                }
            )

        children = group.get("groups") or group.get("children") or []
        if isinstance(children, list) and children:
            child_parent = {
                "id": group_id,
                "name": name,
                "abbreviation": abbreviation,
            }
            flattened.extend(_flatten_groups(children, child_parent))

    return flattened


def _flatten_standings_children(children: list[dict], parent: dict | None = None) -> list[dict[str, object]]:
    flattened: list[dict[str, object]] = []

    for child in children:
        raw_child_id = str(child.get("id") or "").strip()
        name = str(child.get("name") or "").strip()
        abbreviation = str(child.get("abbreviation") or "").strip()
        child_id = raw_child_id or _group_key(abbreviation or name)

        if parent and child_id:
            parent_key = str(parent.get("id") or "").strip()
            if parent_key:
                child_id = f"{parent_key}:{child_id}"

        if child_id or name:
            flattened.append(
                {
                    "id": child_id,
                    "name": name,
                    "abbreviation": abbreviation,
                    "parent": parent,
                }
            )

        nested = child.get("children") or []
        if isinstance(nested, list) and nested:
            child_parent = {
                "id": child_id,
                "name": name,
                "abbreviation": abbreviation,
            }
            flattened.extend(_flatten_standings_children(nested, child_parent))

    return flattened


def _find_team_standings_entry(children: list[dict], team_id: str) -> tuple[dict | None, dict | None]:
    for child in children:
        standings = child.get("standings") or {}
        entries = standings.get("entries") or []
        for entry in entries:
            entry_team = entry.get("team") or {}
            if str(entry_team.get("id") or "").strip() == team_id:
                return entry, child

        nested = child.get("children") or []
        if isinstance(nested, list) and nested:
            nested_entry, nested_group = _find_team_standings_entry(nested, team_id)
            if nested_entry is not None:
                return nested_entry, nested_group

    return None, None


def _map_standings_stats(entry_stats: list[dict]) -> dict[str, str]:
    wanted = {
        "overall": "overall",
        "wins": "wins",
        "losses": "losses",
        "ties": "ties",
        "divisionRecord": "divisionRecord",
        "conferenceRecord": "conferenceRecord",
        "streak": "streak",
        "winPercent": "winPercent",
        "pointsFor": "pointsFor",
        "pointsAgainst": "pointsAgainst",
        "pointDifferential": "pointDifferential",
        "playoffSeed": "playoffSeed",
        "Home": "homeRecord",
        "Road": "awayRecord",
    }

    mapped: dict[str, str] = {}
    for stat in entry_stats:
        name = str(stat.get("name") or "").strip()
        key = wanted.get(name)
        if not key:
            continue
        mapped[key] = str(stat.get("displayValue") or stat.get("value") or "").strip()

    return mapped


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


def _build_team_group_memberships(standings_children: list[dict]) -> dict[str, set[str]]:
    memberships: dict[str, set[str]] = {}

    def walk(children: list[dict], parent: dict | None = None) -> None:
        for child in children:
            raw_child_id = str(child.get("id") or "").strip()
            name = str(child.get("name") or "").strip()
            abbreviation = str(child.get("abbreviation") or "").strip()
            child_id = raw_child_id or _group_key(abbreviation or name)

            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and child_id:
                child_id = f"{parent_id}:{child_id}"

            standings = child.get("standings") or {}
            entries = standings.get("entries") or []
            if isinstance(entries, list):
                for entry in entries:
                    team = entry.get("team") or {}
                    team_id = str(team.get("id") or "").strip()
                    if not team_id:
                        continue

                    team_groups = memberships.setdefault(team_id, set())
                    if child_id:
                        team_groups.add(child_id.lower())
                    if parent_id:
                        team_groups.add(parent_id.lower())

            nested = child.get("children") or []
            if isinstance(nested, list) and nested:
                walk(
                    nested,
                    {
                        "id": child_id,
                        "name": name,
                        "abbreviation": abbreviation,
                    },
                )

    walk(standings_children if isinstance(standings_children, list) else [])
    return memberships


def _build_team_group_memberships_from_groups(groups: list[dict]) -> dict[str, set[str]]:
    memberships: dict[str, set[str]] = {}

    def walk(items: list[dict], parent: dict | None = None) -> None:
        for item in items:
            raw_group_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            abbreviation = str(item.get("abbreviation") or "").strip()
            group_id = raw_group_id or _group_key(abbreviation or name)

            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and group_id:
                group_id = f"{parent_id}:{group_id}"

            teams = item.get("teams") or []
            if isinstance(teams, list):
                for team_entry in teams:
                    team = (team_entry or {}).get("team") or team_entry or {}
                    team_id = str(team.get("id") or "").strip()
                    if not team_id:
                        continue

                    team_groups = memberships.setdefault(team_id, set())
                    if group_id:
                        team_groups.add(group_id.lower())
                    if parent_id:
                        team_groups.add(parent_id.lower())

            nested = item.get("groups") or item.get("children") or []
            if isinstance(nested, list) and nested:
                walk(
                    nested,
                    {
                        "id": group_id,
                        "name": name,
                        "abbreviation": abbreviation,
                    },
                )

    walk(groups if isinstance(groups, list) else [])
    return memberships


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


def _normalized_team_nickname(
    *,
    display_name: object,
    location: object,
    nickname: object,
    short_display_name: object,
) -> str:
    display = str(display_name or "").strip()
    loc = str(location or "").strip()
    nick = str(nickname or "").strip()
    short_name = str(short_display_name or "").strip()

    if nick and _normalized(nick) != _normalized(loc):
        return nick

    if short_name and _normalized(short_name) != _normalized(loc):
        return short_name

    if display and loc:
        lowered_display = display.lower()
        lowered_loc = loc.lower()
        if lowered_display.startswith(lowered_loc):
            remainder = display[len(loc) :].strip(" -")
            if remainder:
                return remainder

    return nick or short_name


def _venue_profile(venue: dict | None) -> dict[str, object] | None:
    if not isinstance(venue, dict) or not venue:
        return None

    address = venue.get("address") or {}
    return {
        "name": venue.get("fullName") or venue.get("name") or venue.get("shortName"),
        "city": address.get("city"),
        "state": address.get("state"),
        "country": address.get("country"),
        "indoor": venue.get("indoor"),
        "grass": venue.get("grass"),
    }


@router.get("/proxy")
def proxy_espn_json(
    url: str = Query(..., description="Absolute ESPN JSON endpoint URL."),
    cache_ttl_seconds: float = Query(120.0, ge=0.0, le=3600.0),
) -> object:
    safe_url = _validate_espn_url(url)

    try:
        return _http_client.get_json(
            safe_url,
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN data: {error}") from error


@router.get("/league-registry")
def get_league_registry() -> object:
    entries = list_registry_entries()
    return {
        "leagueCount": len(entries),
        "leagues": [
            {
                "leagueId": entry.league_id,
                "sport": entry.sport,
                "league": entry.league,
                "scoreboardUrl": entry.scoreboard_url,
                "supportsWeekFilter": entry.supports_week_filter,
            }
            for entry in entries
        ],
    }


@router.get("/scoreboard")
def get_scoreboard(
    league: str = Query(..., description="League id, for example nfl or mlb."),
    sport: str | None = Query(None, description="Optional sport slug. If omitted, registry mapping is used."),
    week: int | None = Query(None, ge=1, le=30, description="Optional football week filter."),
    use_week_filter: bool = Query(False, description="Apply week filtering when the league supports it."),
    game_filter: str = Query("all", description="Game filter: all, live, today, upcoming, this-week."),
    included_teams: str | None = Query(None, description="Comma-separated team ids/abbreviations/slugs."),
    included_groups: str | None = Query(None, description="Comma-separated group ids from league-groups."),
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
        try:
            groups_payload = _http_client.get_json(
                _groups_endpoint_url(sport=entry.sport, league=entry.league),
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
            groups = groups_payload.get("groups") or []
            team_group_memberships = _build_team_group_memberships_from_groups(
                groups if isinstance(groups, list) else []
            )

            if not team_group_memberships:
                standings_payload = _http_client.get_json(
                    _site_standings_url(sport=entry.sport, league=entry.league),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                standings_children = standings_payload.get("children") or []
                team_group_memberships = _build_team_group_memberships(
                    standings_children if isinstance(standings_children, list) else []
                )
        except Exception:
            team_group_memberships = {}

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
        if not _event_matches_group_filter(event, parsed_included_groups, team_group_memberships):
            continue
        filtered_events.append(event)

    filtered_payload = dict(payload) if isinstance(payload, dict) else {"events": filtered_events}
    filtered_payload["events"] = filtered_events
    normalized_games = normalize_scoreboard_events(
        entry=entry,
        events=filtered_events,
    )
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


@router.get("/team-logos")
def get_team_logos(
    team: str = Query(..., description="Team id, abbreviation, slug, or display name."),
    league: str = Query(..., description="League key, for example nfl or college-football."),
    sport: str = Query("football", description="Sport key, for example football, baseball, basketball."),
    cache_ttl_seconds: float = Query(300.0, ge=0.0, le=3600.0),
) -> object:
    teams_url = _teams_endpoint_url(sport=sport, league=league)

    try:
        payload = _http_client.get_json(
            teams_url,
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN teams data: {error}") from error

    teams = payload.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
    matched_team = None

    for entry in teams:
        team_obj = entry.get("team") or {}
        if _team_matches_query(team_obj, team):
            matched_team = team_obj
            break

    if matched_team is None:
        # For racing, MMA, and other individual sports, try treating the ID as an athlete
        # (NASCAR drivers, F1 drivers, MMA fighters, etc. often won't be in the "teams" list)
        is_individual_sport = sport in ("racing", "motorsports", "mma", "boxing", "golf", "tennis") or any(
            x in league.lower() for x in ("nascar", "f1", "formula", "indycar", "motogp", "wec", "imsa", "ufc", "bellator")
        )

        if is_individual_sport:
            try:
                athlete_core_url = _core_athlete_endpoint_url(sport=sport, league=league, athlete_id=team)
                athlete_payload = _http_client.get_json(
                    athlete_core_url,
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                athlete_logos = athlete_payload.get("logos") or athlete_payload.get("headshots") or []
                if athlete_logos or athlete_payload.get("id"):
                    # Treat athlete as our "entity"
                    return {
                        "sport": sport,
                        "league": league,
                        "team": {  # keep response shape compatible
                            "id": athlete_payload.get("id"),
                            "name": athlete_payload.get("displayName") or athlete_payload.get("fullName"),
                            "abbreviation": athlete_payload.get("shortName"),
                        },
                        "teamProfile": {
                            "id": athlete_payload.get("id"),
                            "name": athlete_payload.get("displayName"),
                            "logos": athlete_logos,
                        },
                        "logoCount": len(athlete_logos) if isinstance(athlete_logos, list) else 0,
                        "logos": athlete_logos if isinstance(athlete_logos, list) else [],
                    }
            except Exception:
                pass  # fall through to 404

        # Fallback: some college teams (and others) are not present in the main league teams list
        # response (the /teams endpoint often only returns major conferences or requires group filters).
        # Try hitting the site team detail directly with the provided ID/slug. This frequently
        # returns a much richer logos array for individual teams.
        try:
            direct_url = _team_detail_endpoint_url(sport=sport, league=league, team=team)
            direct_payload = _http_client.get_json(
                direct_url,
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
            direct_team = direct_payload.get("team") or {}
            if direct_team and (direct_team.get("id") or direct_team.get("logos")):
                logos = direct_team.get("logos") or []
                team_id = str(direct_team.get("id") or team).strip()
                team_profile = {
                    "id": direct_team.get("id"),
                    "name": direct_team.get("displayName") or direct_team.get("name"),
                    "abbreviation": direct_team.get("abbreviation"),
                    "slug": direct_team.get("slug"),
                    "location": direct_team.get("location"),
                    "nickname": _normalized_team_nickname(
                        display_name=direct_team.get("displayName") or direct_team.get("name"),
                        location=direct_team.get("location"),
                        nickname=direct_team.get("nickname") or direct_team.get("name"),
                        short_display_name=direct_team.get("shortDisplayName"),
                    ),
                    "color": direct_team.get("color"),
                    "alternateColor": direct_team.get("alternateColor"),
                    "isActive": direct_team.get("isActive"),
                    "recordSummary": "",
                    "group": None,
                    "venue": None,
                    "standings": None,
                }
                # Try to enrich venue from the direct payload if present
                venue = direct_team.get("venue") or {}
                venue_profile = _venue_profile(venue)
                if venue_profile:
                    team_profile["venue"] = venue_profile

                return {
                    "sport": sport,
                    "league": league,
                    "team": {
                        "id": direct_team.get("id"),
                        "name": direct_team.get("displayName") or direct_team.get("name"),
                        "abbreviation": direct_team.get("abbreviation"),
                    },
                    "teamProfile": team_profile,
                    "logoCount": len(logos),
                    "logos": logos,
                }
        except Exception:
            pass  # fall through to 404

        raise HTTPException(
            status_code=404,
            detail=f"Team '{team}' was not found for sport='{sport}' league='{league}'.",
        )

    logos = matched_team.get("logos") or []
    team_id = str(matched_team.get("id") or "").strip()
    team_profile: dict[str, object] = {
        "id": matched_team.get("id"),
        "name": matched_team.get("displayName") or matched_team.get("name"),
        "abbreviation": matched_team.get("abbreviation"),
        "slug": matched_team.get("slug"),
        "location": matched_team.get("location"),
        "nickname": _normalized_team_nickname(
            display_name=matched_team.get("displayName") or matched_team.get("name"),
            location=matched_team.get("location"),
            nickname=matched_team.get("nickname"),
            short_display_name=matched_team.get("shortDisplayName"),
        ),
        "color": matched_team.get("color"),
        "alternateColor": matched_team.get("alternateColor"),
        "isActive": matched_team.get("isActive"),
        "recordSummary": "",
        "group": None,
        "venue": None,
        "standings": None,
    }

    if team_id:
        core_team_url = _core_team_endpoint_url(sport=sport, league=league, team_id=team_id)
        try:
            core_payload = _http_client.get_json(
                core_team_url,
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
            core_logos = core_payload.get("logos") or []
            if core_logos:
                logos = core_logos

            venue = core_payload.get("venue") or {}
            venue_profile = _venue_profile(venue)
            if venue_profile:
                team_profile["venue"] = venue_profile

            group = core_payload.get("groups") or {}
            if isinstance(group, dict):
                group_data = group
                group_ref = str(group.get("$ref") or "").strip()
                if group_ref:
                    try:
                        group_data = _http_client.get_json(
                            _normalize_ref_url(group_ref),
                            use_cache=cache_ttl_seconds > 0,
                            cache_ttl_seconds=cache_ttl_seconds,
                        )
                    except Exception:
                        group_data = group

                team_profile["group"] = {
                    "id": group_data.get("id"),
                    "name": group_data.get("name") or group_data.get("shortName") or group_data.get("abbreviation"),
                    "abbreviation": group_data.get("abbreviation"),
                }

            record = core_payload.get("record") or {}
            if isinstance(record, dict):
                record_summary = str(record.get("summary") or "").strip()
                record_ref = str(record.get("$ref") or "").strip()

                if not record_summary and record_ref:
                    try:
                        record_payload = _http_client.get_json(
                            _normalize_ref_url(record_ref),
                            use_cache=cache_ttl_seconds > 0,
                            cache_ttl_seconds=cache_ttl_seconds,
                        )
                        record_items = record_payload.get("items") or []
                        if isinstance(record_items, list) and record_items:
                            first_record = record_items[0] or {}
                            record_summary = str(first_record.get("summary") or "").strip()
                    except Exception:
                        record_summary = ""

                team_profile["recordSummary"] = record_summary

            try:
                standings_payload = _http_client.get_json(
                    _site_standings_url(sport=sport, league=league),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                standings_children = standings_payload.get("children") or []
                entry, entry_group = _find_team_standings_entry(
                    standings_children if isinstance(standings_children, list) else [],
                    team_id,
                )
                if entry:
                    stats = entry.get("stats") or []
                    mapped_stats = _map_standings_stats(stats if isinstance(stats, list) else [])
                    team_profile["standings"] = {
                        "group": {
                            "name": entry_group.get("name") if isinstance(entry_group, dict) else None,
                            "abbreviation": entry_group.get("abbreviation") if isinstance(entry_group, dict) else None,
                        },
                        "stats": mapped_stats,
                    }

                    if not team_profile["recordSummary"]:
                        team_profile["recordSummary"] = mapped_stats.get("overall", "")
            except Exception:
                pass
        except Exception:
            # Fallback to site endpoint logos when core lookup is unavailable.
            pass

    if team_profile.get("venue") is None:
        team_identifier = (
            str(matched_team.get("abbreviation") or "").strip()
            or str(matched_team.get("slug") or "").strip()
            or str(matched_team.get("id") or "").strip()
        )
        if team_identifier:
            try:
                site_team_payload = _http_client.get_json(
                    _team_detail_endpoint_url(sport=sport, league=league, team=team_identifier),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                site_team = site_team_payload.get("team") or {}
                fallback_venue = site_team.get("venue") or ((site_team.get("franchise") or {}).get("venue") or {})
                venue_profile = _venue_profile(fallback_venue)
                if venue_profile:
                    team_profile["venue"] = venue_profile

                if not str(team_profile.get("nickname") or "").strip():
                    team_profile["nickname"] = _normalized_team_nickname(
                        display_name=site_team.get("displayName") or site_team.get("name"),
                        location=site_team.get("location"),
                        nickname=site_team.get("nickname") or site_team.get("name"),
                        short_display_name=site_team.get("shortDisplayName"),
                    )
            except Exception:
                pass

    return {
        "sport": sport,
        "league": league,
        "team": {
            "id": matched_team.get("id"),
            "name": matched_team.get("displayName") or matched_team.get("name"),
            "abbreviation": matched_team.get("abbreviation"),
        },
        "teamProfile": team_profile,
        "logoCount": len(logos),
        "logos": logos,
    }


@router.get("/league-groups")
def get_league_groups(
    league: str = Query(..., description="League key, for example nfl or college-football."),
    sport: str = Query("football", description="Sport key, for example football, baseball, basketball."),
    cache_ttl_seconds: float = Query(300.0, ge=0.0, le=3600.0),
) -> object:
    groups_url = _groups_endpoint_url(sport=sport, league=league)

    try:
        payload = _http_client.get_json(
            groups_url,
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN league groups: {error}") from error

    groups = payload.get("groups") or []
    flattened = _flatten_groups(groups if isinstance(groups, list) else [])

    # Some leagues (notably college sports) expose richer conference trees via standings.
    try:
        standings_payload = _http_client.get_json(
            _site_standings_url(sport=sport, league=league),
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
        standings_children = standings_payload.get("children") or []
        standings_groups = _flatten_standings_children(
            standings_children if isinstance(standings_children, list) else []
        )

        existing_ids = {str(entry.get("id") or "") for entry in flattened}
        existing_name_keys = {
            (
                _normalized((entry.get("parent") or {}).get("name")),
                _normalized(entry.get("name")),
            )
            for entry in flattened
        }
        for entry in standings_groups:
            entry_id = str(entry.get("id") or "")
            entry_name_key = (
                _normalized((entry.get("parent") or {}).get("name")),
                _normalized(entry.get("name")),
            )
            if entry_id and entry_id not in existing_ids and entry_name_key not in existing_name_keys:
                flattened.append(entry)
                existing_ids.add(entry_id)
                existing_name_keys.add(entry_name_key)
    except Exception:
        # Keep base group payload if standings endpoint is unavailable for a league.
        pass

    flattened.sort(
        key=lambda item: (
            (item.get("parent") or {}).get("name", "").lower(),
            str(item.get("name") or "").lower(),
        )
    )
    return {
        "sport": sport,
        "league": league,
        "groupCount": len(flattened),
        "groups": flattened,
    }


@router.get("/discover-leagues")
def discover_leagues(
    sport: str | None = Query(None, description="Optional sport slug filter, for example football."),
    cache_ttl_seconds: float = Query(600.0, ge=0.0, le=3600.0),
) -> object:
    normalized_sport_filter = _normalized(sport)

    try:
        sports_payload = _http_client.get_json(
            _core_sports_endpoint_url(),
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN sports catalog: {error}") from error

    sports_items = sports_payload.get("items") or []
    discovered: list[dict[str, str]] = []

    for sport_item in sports_items:
        sport_ref = str((sport_item or {}).get("$ref") or "").strip()
        if not sport_ref:
            continue

        sport_slug = _parse_sport_slug_from_ref(sport_ref)
        if not sport_slug:
            continue

        if normalized_sport_filter and _normalized(sport_slug) != normalized_sport_filter:
            continue

        sport_name = sport_slug
        try:
            sport_payload = _http_client.get_json(
                _normalize_ref_url(sport_ref),
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
            sport_name = str(sport_payload.get("name") or sport_slug)
        except Exception:
            sport_name = sport_slug

        try:
            leagues_payload = _http_client.get_json(
                _core_sport_leagues_endpoint_url(sport=sport_slug),
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
        except Exception:
            continue

        league_items = leagues_payload.get("items") or []
        for league_item in league_items:
            league_ref = str((league_item or {}).get("$ref") or "").strip()
            if not league_ref:
                continue

            league_slug = _parse_league_slug_from_ref(league_ref)
            if not league_slug:
                continue

            league_name = league_slug
            league_abbreviation = ""
            league_logo = ""
            try:
                league_payload = _http_client.get_json(
                    _normalize_ref_url(league_ref),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                league_name = str(league_payload.get("name") or league_slug)
                league_abbreviation = str(league_payload.get("abbreviation") or "")
                league_logos = league_payload.get("logos") or []
                if isinstance(league_logos, list):
                    for logo_item in league_logos:
                        logo_href = str((logo_item or {}).get("href") or "").strip()
                        if logo_href:
                            league_logo = logo_href
                            break
            except Exception:
                league_name = league_slug
                league_logo = ""

            discovered.append(
                {
                    "sport": sport_slug,
                    "sportName": sport_name,
                    "league": league_slug,
                    "leagueName": league_name,
                    "abbreviation": league_abbreviation,
                    "logo": league_logo,
                    "id": league_slug,
                    "scoreboardUrl": _site_scoreboard_url(sport=sport_slug, league=league_slug),
                }
            )

    discovered.sort(key=lambda item: (item["sportName"].lower(), item["leagueName"].lower()))
    return {
        "sportFilter": normalized_sport_filter,
        "count": len(discovered),
        "leagues": discovered,
    }
