"""Series info for MLB games from the MLB Stats API (statsapi.mlb.com).

One schedule call covers every game in a date range. Each game carries a seriesStatus (game N of M, "Series tied 2-2",
"PIT wins 3-0") for the regular season, every postseason round and the World Series. ESPN game ids do not match MLB's,
so games are matched by team names plus the closest start time.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate={start}&endDate={end}&hydrate=seriesStatus"

_ROUNDS = {"ALDS", "NLDS", "ALCS", "NLCS", "WS"}
_TIED = re.compile(r"^series tied (\d+)-(\d+)$", re.IGNORECASE)
_LEADS = re.compile(r"^(\S+) (lead|leads|wins|win)(?: series)? (\d+)-(\d+)$", re.IGNORECASE)


def _key(name: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def round_of(game: dict[str, Any]) -> str:
    """ALDS / NLDS / ALCS / NLCS / WS / WC, or "" for the regular season."""
    status = game.get("seriesStatus") or {}
    abbr = str(status.get("abbreviation") or status.get("shortName") or "").strip().upper()
    if abbr in _ROUNDS:
        return abbr
    game_type = str(game.get("gameType") or "").upper()
    return {"W": "WS", "F": "WC"}.get(game_type, "")


def status_text(result: str, wins: int, losses: int) -> str:
    """'Series tied 2-2' -> 'TIED 2–2', 'PIT wins 3-0' -> 'PIT WIN 3–0', 'NYY leads series 2-1' -> 'NYY LEAD 2–1'."""
    if not wins and not losses:
        return ""
    text = str(result or "").strip()
    tied = _TIED.match(text)
    if tied:
        return f"TIED {tied.group(1)}–{tied.group(2)}"
    lead = _LEADS.match(text)
    if lead:
        verb = "WIN" if lead.group(2).lower().startswith("win") else "LEAD"
        return f"{lead.group(1).upper()} {verb} {lead.group(3)}–{lead.group(4)}"
    return text.upper()


def parse_schedule(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten a Stats API schedule response into [{away, home, start, series}] for games that have a series."""
    out: list[dict[str, Any]] = []
    for day in (payload or {}).get("dates") or []:
        for game in day.get("games") or []:
            series = game.get("seriesStatus")
            if not isinstance(series, dict):
                continue
            teams = game.get("teams") or {}
            try:
                start = datetime.fromisoformat(str(game.get("gameDate") or "").replace("Z", "+00:00"))
            except ValueError:
                continue
            wins = int(series.get("wins") or 0)
            losses = int(series.get("losses") or 0)
            out.append({
                "away": _key(((teams.get("away") or {}).get("team") or {}).get("name")),
                "home": _key(((teams.get("home") or {}).get("team") or {}).get("name")),
                "start": start,
                "series": {
                    "kind": "season" if str(game.get("gameType") or "").upper() == "R" else "playoff",
                    "round": round_of(game),
                    "gameNumber": int(series.get("gameNumber") or 0),
                    "totalGames": int(series.get("totalGames") or 0),
                    "statusText": status_text(str(series.get("result") or ""), wins, losses),
                    "completed": bool(series.get("isOver")),
                },
            })
    return out


def match_series(lookup: list[dict[str, Any]], away_name: object, home_name: object, start_utc: str) -> dict[str, Any] | None:
    """Series for one ESPN game: same two teams, closest start time (handles doubleheaders)."""
    away, home = _key(away_name), _key(home_name)
    try:
        start = datetime.fromisoformat(str(start_utc).replace("Z", "+00:00"))
    except ValueError:
        start = None
    best = None
    best_gap = None
    for item in lookup:
        if item["away"] != away or item["home"] != home:
            continue
        gap = abs((item["start"] - start).total_seconds()) if start else 0
        if best_gap is None or gap < best_gap:
            best, best_gap = item, gap
    if best is None or (start and best_gap is not None and best_gap > 6 * 3600):
        return None
    return best["series"]


def schedule_url(start_times_utc: list[str]) -> str | None:
    """Stats API URL covering the given ESPN start times (one day of slack either side), or None."""
    days = []
    for raw in start_times_utc:
        try:
            days.append(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(timezone.utc).date())
        except ValueError:
            continue
    if not days:
        return None
    return SCHEDULE_URL.format(start=(min(days) - timedelta(days=1)).isoformat(), end=(max(days) + timedelta(days=1)).isoformat())
