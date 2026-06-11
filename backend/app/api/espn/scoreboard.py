from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from ...core.espn_normalizer import normalize_scoreboard_events
from ...core.espn_registry import resolve_registry_entry
from ...core.espn_scoreboard import EspnScoreboardClient
from ...core.logos.logo_store import LogoStore
from ._utils import _group_key, _groups_endpoint_url, _http_client, _normalized, _site_standings_url

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
        if _normalized(entry.sport) != "racing" and not _event_matches_group_filter(event, parsed_included_groups, team_group_memberships):
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
            meta = LogoStore().load_league_meta(entry.league_id)
            for game in normalized_games:
                for race_entry in game.get("racingEntries") or []:
                    if not race_entry.get("teamColor"):
                        team_id = str(race_entry.get("teamId") or "").strip()
                        if team_id and team_id in meta.teams:
                            race_entry["teamColor"] = meta.teams[team_id].color
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
