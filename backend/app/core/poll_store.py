"""College polls (CFP / AP / Coaches), stored on each team's own record in team-meta/{league}.json (rank per poll) with the poll dates in the league header.

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

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .groups_util import poll_label
from .logo_store import LogoStore, cache_id_for

POLL_PERIOD = timedelta(days=7)   # polls are weekly
EARLY = timedelta(hours=2)        # start looking this long before a week has passed
RECHECK = timedelta(minutes=30)   # while a poll is overdue, ask at most this often
CFP_WATCH = timedelta(hours=6)    # looking for the first CFP release (Nov+), at most this often
LOWER_DIVISIONS = ("fcs", "division ii", "d2", "d3", "naia")
KEEP = ("CFP", "AP", "COACHES")   # polls we can show on a card; FCS / D2 / D3 polls are ignored


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
    """Each team's rank in each poll is read from the team's own record; the poll's week/date headers sit in the league header."""
    meta = LogoStore().load_league_meta(cache_id_for(league_id))
    heads = meta.sync.get("polls") or []
    if not heads:
        return None
    polls = []
    for head in heads:
        ranks = {
            tid: team.data["polls"][head["label"]]
            for tid, team in meta.teams.items()
            if isinstance(team.data.get("polls"), dict) and head["label"] in team.data["polls"]
        }
        polls.append({**head, "ranks": ranks})
    return {"league": league_id, "checkedAt": meta.sync.get("pollsCheckedAt"), "polls": polls}


def save_polls(league_id: str, polls: list[dict[str, Any]], checked_at: datetime) -> None:
    store = LogoStore()
    meta = store.load_league_meta(cache_id_for(league_id))
    for team in meta.teams.values():
        team.data.pop("polls", None)
    for poll in polls:
        for tid, rank in (poll.get("ranks") or {}).items():
            team = meta.teams.get(tid)
            if team is not None:
                team.data.setdefault("polls", {})[poll["label"]] = rank
    meta.sync["polls"] = [{key: poll.get(key) for key in ("label", "name", "week", "updated")} for poll in polls]
    meta.sync["pollsCheckedAt"] = checked_at.isoformat()
    store.save_league_meta(meta)


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
    if {"AP", "COACHES"} - {p.get("label") for p in polls} and not recently(RECHECK):
        return True  # one of the two weekly polls is missing from our copy: ask again soon instead of waiting a week
    has_cfp = any(p.get("label") == "CFP" for p in polls)
    if not has_cfp and now.month >= 11 and not recently(CFP_WATCH):
        return True
    return False


def headline_from_stored(polls: list[dict[str, Any]], preferred: str | None = "auto") -> tuple[dict[str, int], str]:
    """The poll to show on cards. `preferred` is the user's choice (AP / COACHES / CFP); "auto" or a poll we do not have stored uses the default order:
    CFP when stored, else AP, else Coaches. Returns ({team_id: rank}, label)."""
    by_label = {p.get("label"): p for p in polls or []}
    wanted = str(preferred or "auto").upper()
    order = ([wanted] if wanted in KEEP else []) + [label for label in KEEP if label != wanted]
    for label in order:
        poll = by_label.get(label)
        if poll and poll.get("ranks"):
            return {str(k): int(v) for k, v in poll["ranks"].items()}, label
    return {}, ""


def merge_polls(fresh: list[dict[str, Any]], stored: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """A fresh pull can list only some polls (right after one updates). Keep the stored copy of any poll the fresh pull lacks, so a poll never
    disappears (and the card never flips to another poll) until ESPN publishes a newer one."""
    have = {p.get("label") for p in fresh}
    return list(fresh) + [p for p in (stored or []) if p.get("label") not in have]
