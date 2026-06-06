from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .espn_registry import EspnLeagueRegistryEntry


def _normalized(value: object) -> str:
    return str(value or "").strip().lower()


def _parse_event_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _extract_competitors(event: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    competitions = event.get("competitions") or []
    if not isinstance(competitions, list) or not competitions:
        return None, None

    competitors = (competitions[0] or {}).get("competitors") or []
    if not isinstance(competitors, list):
        return None, None

    home = None
    away = None
    for competitor in competitors:
        if _normalized(competitor.get("homeAway")) == "home":
            home = competitor
        if _normalized(competitor.get("homeAway")) == "away":
            away = competitor

    if home is None and competitors:
        home = competitors[0]
    if away is None and len(competitors) > 1:
        away = competitors[1]

    return home, away


def _team_model(competitor: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(competitor, dict):
        return None

    team = competitor.get("team") or {}
    logos = team.get("logos") or []
    logo_href = ""
    if isinstance(logos, list) and logos:
        logo_href = str((logos[0] or {}).get("href") or "")

    records = competitor.get("records") or []
    record_summary = ""
    if isinstance(records, list) and records:
        record_summary = str((records[0] or {}).get("summary") or "")

    return {
        "id": str(team.get("id") or "").strip(),
        "name": team.get("displayName") or team.get("name"),
        "abbreviation": team.get("abbreviation"),
        "slug": team.get("slug"),
        "homeAway": competitor.get("homeAway"),
        "score": str(competitor.get("score") or "").strip(),
        "record": record_summary,
        "winner": bool(competitor.get("winner")),
        "logo": logo_href,
    }


def _racing_entries(competition: dict[str, Any]) -> list[dict[str, Any]]:
    competitors = competition.get("competitors") or []
    if not isinstance(competitors, list):
        return []

    entries: list[dict[str, Any]] = []
    for competitor in competitors:
        if not isinstance(competitor, dict):
            continue

        athlete = competitor.get("athlete") or {}
        flag = athlete.get("flag") or {}
        team = competitor.get("team") or {}
        statistics = competitor.get("statistics") or []
        stat_items: list[dict[str, str]] = []
        if isinstance(statistics, list):
            for statistic in statistics:
                if not isinstance(statistic, dict):
                    continue
                value = str(
                    statistic.get("displayValue")
                    or statistic.get("displayValueShort")
                    or statistic.get("value")
                    or ""
                ).strip()
                label = str(
                    statistic.get("abbreviation")
                    or statistic.get("shortDisplayName")
                    or statistic.get("name")
                    or ""
                ).strip()
                if not value:
                    continue
                stat_items.append(
                    {
                        "label": label,
                        "value": value,
                    }
                )

        entries.append(
            {
                "id": str(competitor.get("id") or "").strip(),
                "position": _safe_int(competitor.get("order")),
                "winner": bool(competitor.get("winner")),
                "name": athlete.get("displayName") or athlete.get("fullName"),
                "shortName": athlete.get("shortName") or athlete.get("displayName") or athlete.get("fullName"),
                "score": str(competitor.get("score") or "").strip(),
                "stats": stat_items[:4],
                "flag": {
                    "href": str(flag.get("href") or "").strip(),
                    "alt": str(flag.get("alt") or "").strip(),
                },
                "team": str(
                    team.get("shortDisplayName")
                    or team.get("displayName")
                    or team.get("name")
                    or ""
                ).strip(),
            }
        )

    return [entry for entry in entries if entry.get("name")]


def _safe_int(value: object) -> int | None:
    try:
        return int(str(value).strip())
    except Exception:
        return None


def _map_live_state(
    *,
    sport: str,
    status_type: dict[str, Any],
    status: dict[str, Any],
    competition: dict[str, Any],
) -> dict[str, Any] | None:
    if _normalized(status_type.get("state")) != "in":
        return None

    detail = str(status_type.get("detail") or "").strip()
    short_detail = str(status_type.get("shortDetail") or "").strip()
    display_clock = str(status.get("displayClock") or "").strip()
    period = _safe_int(status.get("period"))
    situation = competition.get("situation") or {}

    if sport == "football":
        return {
            "sport": "football",
            "quarter": period,
            "clock": display_clock,
            "detail": detail or short_detail,
            "possession": ((situation.get("possession") or {}).get("id") if isinstance(situation, dict) else None),
            "downDistanceText": situation.get("downDistanceText") if isinstance(situation, dict) else None,
        }

    if sport == "baseball":
        return {
            "sport": "baseball",
            "inning": period,
            "halfInning": situation.get("period") if isinstance(situation, dict) else None,
            "outs": _safe_int(situation.get("outs")) if isinstance(situation, dict) else None,
            "balls": _safe_int(situation.get("balls")) if isinstance(situation, dict) else None,
            "strikes": _safe_int(situation.get("strikes")) if isinstance(situation, dict) else None,
            "onFirst": bool(situation.get("onFirst")) if isinstance(situation, dict) else False,
            "onSecond": bool(situation.get("onSecond")) if isinstance(situation, dict) else False,
            "onThird": bool(situation.get("onThird")) if isinstance(situation, dict) else False,
            "detail": detail or short_detail,
        }

    if sport == "basketball":
        return {
            "sport": "basketball",
            "quarter": period,
            "clock": display_clock,
            "detail": detail or short_detail,
            "homeBonus": bool((situation.get("home") or {}).get("inBonus")) if isinstance(situation, dict) else False,
            "awayBonus": bool((situation.get("away") or {}).get("inBonus")) if isinstance(situation, dict) else False,
        }

    if sport == "hockey":
        power_play = situation.get("powerPlay") if isinstance(situation, dict) else {}
        return {
            "sport": "hockey",
            "period": period,
            "clock": display_clock,
            "detail": detail or short_detail,
            "powerPlay": bool((power_play or {}).get("isPowerPlay")) if isinstance(power_play, dict) else False,
            "powerPlayTeamId": str((power_play or {}).get("teamId") or "").strip() if isinstance(power_play, dict) else "",
        }

    return {
        "sport": sport,
        "period": period,
        "clock": display_clock,
        "detail": detail or short_detail,
    }


def normalize_scoreboard_events(
    *,
    entry: EspnLeagueRegistryEntry,
    events: list[dict[str, Any]],
    now_utc: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now_utc or datetime.now(timezone.utc)
    normalized_games: list[dict[str, Any]] = []

    for event in events:
        competitions = event.get("competitions") or []
        competition = (competitions[0] or {}) if isinstance(competitions, list) and competitions else {}
        status = (event.get("status") or {}).get("type") or {}
        status_block = event.get("status") or {}
        start_time = _parse_event_datetime(event.get("date"))

        home_comp, away_comp = _extract_competitors(event)
        home_team = _team_model(home_comp)
        away_team = _team_model(away_comp)

        venue = competition.get("venue") or {}
        broadcasts = competition.get("broadcasts") or []
        broadcast_names: list[str] = []
        if isinstance(broadcasts, list):
            for broadcast in broadcasts:
                if not isinstance(broadcast, dict):
                    continue
                names = broadcast.get("names") or []
                if isinstance(names, list) and names:
                    primary_name = str(names[0] or "").strip()
                    if primary_name:
                        broadcast_names.append(primary_name)

        competition_odds = competition.get("odds") or []
        odds_detail = ""
        if isinstance(competition_odds, list) and competition_odds:
            first_odds = competition_odds[0] or {}
            if isinstance(first_odds, dict):
                odds_detail = str(first_odds.get("details") or first_odds.get("displayValue") or "").strip()

        state = _normalized(status.get("state"))
        is_live = state == "in"
        is_completed = bool(status.get("completed"))
        normalized_games.append(
            {
                "id": str(event.get("id") or "").strip(),
                "sport": entry.sport,
                "league": entry.league,
                "leagueId": entry.league_id,
                "title": event.get("shortName") or event.get("name") or entry.league_id,
                "startTimeUtc": start_time.isoformat() if start_time else "",
                "startsInMinutes": int((start_time - now).total_seconds() // 60) if start_time else None,
                "state": state or "unknown",
                "isLive": is_live,
                "isCompleted": is_completed,
                "status": {
                    "name": status.get("name"),
                    "shortDetail": status.get("shortDetail"),
                    "detail": status.get("detail"),
                    "period": _safe_int(status_block.get("period")),
                    "clock": status_block.get("displayClock"),
                },
                "teams": {
                    "away": away_team,
                    "home": home_team,
                },
                "venue": {
                    "name": venue.get("fullName") or venue.get("name"),
                    "city": (venue.get("address") or {}).get("city") if isinstance(venue, dict) else None,
                    "state": (venue.get("address") or {}).get("state") if isinstance(venue, dict) else None,
                },
                "broadcasts": [name for name in broadcast_names if name],
                "odds": {
                    "details": odds_detail,
                },
                "racingEntries": _racing_entries(competition if isinstance(competition, dict) else {}) if entry.sport == "racing" else [],
                "liveState": _map_live_state(
                    sport=entry.sport,
                    status_type=status,
                    status=status_block,
                    competition=competition if isinstance(competition, dict) else {},
                ),
            }
        )

    return normalized_games

# Note: event_in_next_week was removed — the server-side game_filter + week handling in the ESPN scoreboard
# endpoint (plus the revived frontend query wiring) replaced the need for this client-side helper.