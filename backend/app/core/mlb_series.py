"""Series info for MLB games from the MLB Stats API (statsapi.mlb.com).

One schedule call covers every game in a date range. Each game carries a seriesStatus (game N of M, "Series tied 2-2",
"PIT wins 3-0") for the regular season, every postseason round and the World Series. ESPN game ids do not match MLB's,
so games are matched by team names plus the closest start time.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .logo_store import LogoStore, cache_id_for

RECHECK = timedelta(minutes=30)   # while a finished game is not reflected in the series yet, ask at most this often

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
                "awayName": str(((teams.get("away") or {}).get("team") or {}).get("name") or ""),
                "homeName": str(((teams.get("home") or {}).get("team") or {}).get("name") or ""),
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


# ---------------------------------------------------------------------------------------------------------------------------
# Stored copy: the schedule/series lookup lives in the league header of team-meta/mlb.json (sync.series). The MLB Stats API is asked again ONLY
# when the board shows dates the stored copy does not cover, or a finished game on the board is not yet reflected in the series text.
# ---------------------------------------------------------------------------------------------------------------------------

def _day(value: str):
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def series_range(start_times_utc: list[str]) -> tuple[str, str] | None:
    """(first day, last day) the Stats API call covers for these ESPN start times, one day of slack either side, or None."""
    days = []
    for raw in start_times_utc:
        try:
            days.append(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(timezone.utc).date())
        except ValueError:
            continue
    if not days:
        return None
    return (min(days) - timedelta(days=1)).isoformat(), (max(days) + timedelta(days=1)).isoformat()


def _serial(lookup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**item, "start": item["start"].isoformat() if isinstance(item.get("start"), datetime) else item.get("start")} for item in lookup]


def _parsed(lookup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for item in lookup or []:
        try:
            out.append({**item, "start": datetime.fromisoformat(str(item["start"]))})
        except (KeyError, ValueError):
            continue
    return out


def load_series(league_id: str) -> dict[str, Any] | None:
    meta = LogoStore().load_league_meta(cache_id_for(league_id))
    stored = meta.sync.get("series")
    if not stored:
        return None
    return {
        "lookup": _parsed(stored),
        "range": meta.sync.get("seriesRange"),
        "counted": list(meta.sync.get("seriesCounted") or []),
        "checkedAt": meta.sync.get("seriesCheckedAt"),
    }


def save_series(league_id: str, lookup: list[dict[str, Any]], rng: tuple[str, str], counted: set[str], checked_at: datetime) -> None:
    store = LogoStore()
    meta = store.load_league_meta(cache_id_for(league_id))
    meta.sync["series"] = _serial(lookup)
    meta.sync["seriesRange"] = list(rng)
    meta.sync["seriesCounted"] = sorted(counted)
    meta.sync["seriesCheckedAt"] = checked_at.isoformat()
    store.save_league_meta(meta)


def _finished(games: list[dict[str, Any]]) -> set[str]:
    return {str(g["id"]) for g in games or [] if g.get("id") and str(g.get("state") or "").lower() == "post"}


def series_due(stored: dict[str, Any] | None, games: list[dict[str, Any]], rng: tuple[str, str] | None, now: datetime) -> bool:
    """True only when the stored series copy could be out of date."""
    if rng is None:
        return False
    if not stored or not stored.get("lookup"):
        return True
    have = stored.get("range") or []
    if len(have) != 2 or _day(rng[0]) is None or _day(have[0]) is None or _day(rng[0]) < _day(have[0]) or _day(rng[1]) > _day(have[1]):
        return True   # the board shows days the stored copy does not cover
    if not (_finished(games) - set(stored.get("counted") or [])):
        return False
    try:
        checked = datetime.fromisoformat(str(stored.get("checkedAt") or ""))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return now - checked >= RECHECK


def counted_after_pull(previous: dict[str, Any] | None, fresh: list[dict[str, Any]], games: list[dict[str, Any]]) -> set[str]:
    """Finished games now reflected: the first pull counts everything on the board; later a game counts only once the series data actually changed."""
    finished = _finished(games)
    if not previous:
        return finished
    counted = set(previous.get("counted") or [])
    return counted | finished if _serial(previous.get("lookup") or []) != _serial(fresh) else counted


def team_series(league_id: str, team_name: str, now: datetime) -> dict[str, Any] | None:
    """The stored series entry for one team (closest game to now), for the Setup team page. None when nothing is stored."""
    stored = load_series(league_id)
    if not stored:
        return None
    key = _key(team_name)
    mine = [i for i in stored["lookup"] if key and key in (i["away"], i["home"])]
    if not mine:
        return None
    item = min(mine, key=lambda i: abs((i["start"] - now).total_seconds()))
    series = item["series"]
    return {
        "text": series.get("statusText") or "",
        "gameNumber": series.get("gameNumber"),
        "totalGames": series.get("totalGames"),
        "round": series.get("round"),
        "kind": series.get("kind"),
        "away": item.get("awayName") or "",
        "home": item.get("homeName") or "",
        "start": item["start"].isoformat(),
    }
