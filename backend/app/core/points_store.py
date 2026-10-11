"""Racing points standings (NASCAR from ESPN, F1 from Jolpica), stored in the league header of team-meta/{league}.json.

Points only change when a race finishes, so the ticker reads the stored copy and the source is asked again ONLY when a finished race on the
board is not yet reflected in what we stored:

- nothing stored                                  -> pull once
- a finished race on the board is not counted yet -> pull; it counts once the pulled points differ from the stored ones
                                                     (the source can lag a little behind the checkered flag, so while they are
                                                     identical we ask again, but at most every RECHECK)
- otherwise                                       -> no call at all
Practice / qualifying never change points, so only races (and F1 sprints) are watched.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .logos.logo_store import LogoStore, cache_id_for

RECHECK = timedelta(minutes=30)       # while a finished race is not reflected yet, ask at most this often
RACE_SESSIONS = ("", "race", "sr")    # ESPN session abbreviations that award points (blank = NASCAR, SR = F1 sprint)


def load_points(league_id: str) -> dict[str, Any] | None:
    """The league's points tables (rows with name, points, wins, gap...) from the league header of team-meta/{league}.json."""
    meta = LogoStore().load_league_meta(cache_id_for(league_id))
    data = meta.sync.get("points")
    if not data:
        return None
    return {"checkedAt": meta.sync.get("pointsCheckedAt"), "counted": list(meta.sync.get("pointsCounted") or []), "data": data}


def save_points(league_id: str, data: dict[str, Any], counted: set[str], checked_at: datetime) -> None:
    store = LogoStore()
    meta = store.load_league_meta(cache_id_for(league_id))
    meta.sync["points"] = data
    meta.sync["pointsCounted"] = sorted(counted)
    meta.sync["pointsCheckedAt"] = checked_at.isoformat()
    store.save_league_meta(meta)


def finished_race_ids(games: list[dict]) -> set[str]:
    out: set[str] = set()
    for game in games or []:
        gid = str(game.get("id") or "")
        if not gid or gid.endswith("-order") or str(game.get("state") or "").lower() != "post":
            continue
        if str(game.get("sessionLabel") or "").strip().lower() in RACE_SESSIONS:
            out.add(gid)
    return out


def points_due(stored: dict[str, Any] | None, games: list[dict], now: datetime) -> bool:
    """True only when a finished race could have changed the points."""
    if not stored:
        return True
    if not (finished_race_ids(games) - set(stored.get("counted") or [])):
        return False
    try:
        checked = datetime.fromisoformat(str(stored.get("checkedAt") or ""))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return now - checked >= RECHECK


def counted_after_pull(previous: dict[str, Any] | None, fresh: dict[str, Any], games: list[dict]) -> set[str]:
    """Finished races that are now reflected. The first pull counts everything on the board; later, races only count once the pulled points
    differ from what was stored (otherwise the source has not caught up yet and we ask again after RECHECK)."""
    finished = finished_race_ids(games)
    if not previous:
        return finished
    counted = set(previous.get("counted") or [])
    return counted | finished if previous.get("data") != fresh else counted
