"""College polls (CFP / AP / Coaches), stored in team-meta/{league}-polls.json.

Polls come out on their own weekly schedule (not when games end), and ESPN stamps every poll with when it was last updated. So the stored
copy is read by the ticker, and ESPN is asked again only when a newer poll is due:

- no stored polls                                   -> pull once
- every stored poll is less than a week old         -> no call at all
- a stored poll is about a week old (a new one is due) -> check, but at most every RECHECK until it actually updates
- no CFP poll stored yet, and it is November or later -> the CFP rankings start in early November on a different day than the AP poll,
                                                        so look for them at most every CFP_WATCH until one appears
All the timings are constants below so they are easy to change.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .groups_util import poll_label
from .paths import get_runtime_paths

POLL_PERIOD = timedelta(days=7)   # polls are weekly
EARLY = timedelta(hours=2)        # start looking this long before a week has passed
RECHECK = timedelta(minutes=30)   # while a poll is overdue, ask at most this often
CFP_WATCH = timedelta(hours=6)    # looking for the first CFP release (Nov+), at most this often
LOWER_DIVISIONS = ("fcs", "division ii", "d2", "d3", "naia")
KEEP = ("CFP", "AP", "COACHES")   # polls we can show on a card; FCS / D2 / D3 polls are ignored


def polls_path(league_id: str) -> Path:
    safe = "".join(ch for ch in str(league_id) if ch.isalnum() or ch in "-_.")
    return get_runtime_paths().team_meta / f"{safe}-polls.json"


def _parse(ts: object) -> datetime | None:
    try:
        text = str(ts or "").strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_polls(rankings: list[dict], top_n: int = 25) -> list[dict[str, Any]]:
    """Reduce ESPN's /rankings list to the polls we can show: [{label, name, week, updated, ranks{team_id: rank}}]."""
    out: list[dict[str, Any]] = []
    for ranking in rankings or []:
        if not isinstance(ranking, dict):
            continue
        label = poll_label(ranking)
        name_text = f"{ranking.get('name') or ''} {ranking.get('shortName') or ''}".lower()
        if label not in KEEP or any(word in name_text for word in LOWER_DIVISIONS) or any(p["label"] == label for p in out):
            continue  # FCS / D2 / D3 polls are not shown; first poll listed for each label wins
        ranks: dict[str, int] = {}
        for entry in ranking.get("ranks") or []:
            current = entry.get("current")
            team_id = str((entry.get("team") or {}).get("id") or "").strip()
            if team_id and isinstance(current, int) and 0 < current <= top_n:
                ranks[team_id] = current
        if not ranks:
            continue
        week = re.search(r"Week\s+(\d+)", str(ranking.get("headline") or ""), re.IGNORECASE)
        out.append({
            "label": label,
            "name": str(ranking.get("name") or ""),
            "week": int(week.group(1)) if week else None,
            "updated": str(ranking.get("lastUpdated") or ranking.get("date") or ""),
            "ranks": ranks,
        })
    return out


def load_polls(league_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(polls_path(league_id).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) and data.get("polls") else None
    except (OSError, ValueError):
        return None


def save_polls(league_id: str, polls: list[dict[str, Any]], checked_at: datetime) -> None:
    path = polls_path(league_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"league": league_id, "checkedAt": checked_at.isoformat(), "polls": polls}, indent=1), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def touch_checked(league_id: str, stored: dict[str, Any], checked_at: datetime) -> None:
    """Remember that we asked (and nothing newer was there) so we do not ask again right away."""
    save_polls(league_id, stored.get("polls") or [], checked_at)


def polls_due(stored: dict[str, Any] | None, now: datetime) -> bool:
    """True only when a newer poll could exist."""
    if not stored or not stored.get("polls"):
        return True
    polls = stored["polls"]
    checked = _parse(stored.get("checkedAt"))
    recently = lambda gap: checked is not None and now - checked < gap
    due = False
    for poll in polls:
        updated = _parse(poll.get("updated"))
        if updated is None or now >= updated + POLL_PERIOD - EARLY:
            due = True
            break
    if due and not recently(RECHECK):
        return True
    has_cfp = any(p.get("label") == "CFP" for p in polls)
    if not has_cfp and now.month >= 11 and not recently(CFP_WATCH):
        return True
    return False


def headline_from_stored(polls: list[dict[str, Any]]) -> tuple[dict[str, int], str]:
    """The poll to show on cards: CFP when stored, else AP, else Coaches. Returns ({team_id: rank}, label)."""
    by_label = {p.get("label"): p for p in polls or []}
    for label in KEEP:
        poll = by_label.get(label)
        if poll and poll.get("ranks"):
            return {str(k): int(v) for k, v in poll["ranks"].items()}, label
    return {}, ""
