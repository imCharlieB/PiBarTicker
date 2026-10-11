"""Racing points standings (NASCAR from ESPN, F1 from Jolpica), stored in team-meta/{league}-points.json.

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

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .paths import get_runtime_paths

RECHECK = timedelta(minutes=30)       # while a finished race is not reflected yet, ask at most this often
RACE_SESSIONS = ("", "race", "sr")    # ESPN session abbreviations that award points (blank = NASCAR, SR = F1 sprint)


def points_path(league_id: str) -> Path:
    safe = "".join(ch for ch in str(league_id) if ch.isalnum() or ch in "-_.")
    return get_runtime_paths().team_meta / f"{safe}-points.json"


def load_points(league_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(points_path(league_id).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) and data.get("data") else None
    except (OSError, ValueError):
        return None


def save_points(league_id: str, data: dict[str, Any], counted: set[str], checked_at: datetime) -> None:
    path = points_path(league_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"league": league_id, "checkedAt": checked_at.isoformat(), "counted": sorted(counted), "data": data}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


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
