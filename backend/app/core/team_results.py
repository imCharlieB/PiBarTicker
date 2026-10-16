"""Per-team win/loss results kept on the team's own record in team-meta/{league}.json (so they survive restarts and are never re-asked for a finished game).

ESPN's college standings carry a streak for most teams in ONE call, but leave it blank for ~40% (American, ACC, MAC, Mountain West, ...).
For those teams the streak is counted from the team's schedule, which costs one call per team. A team's streak can only change when one of
its games finishes, so a stored result is reused until a game we have not counted yet has finished:

- game not started yet            -> stored streak is still right
- game in progress                -> stored streak is still right (it changes when the game ends)
- game finished and already stored -> stored streak is still right
- game finished and NOT stored yet -> look the team up once, store it
"""

from __future__ import annotations

from typing import Any, Callable

from .groups_util import completed_event_ids, streak_from_schedule
from .logo_store import LogoStore, cache_id_for


def load_results(league_id: str) -> dict[str, dict[str, Any]]:
    """{team_id: {"streak", "done"}} read from each team's own record in team-meta/{league}.json."""
    meta = LogoStore().load_league_meta(cache_id_for(league_id))
    return {tid: t.data["results"] for tid, t in meta.teams.items() if isinstance(t.data.get("results"), dict)}


def save_results(league_id: str, teams: dict[str, dict[str, Any]]) -> None:
    store = LogoStore()
    meta = store.load_league_meta(cache_id_for(league_id))
    changed = False
    for tid, value in teams.items():
        team = meta.teams.get(tid)
        if team is not None and team.data.get("results") != value:
            team.data["results"] = value
            changed = True
    if changed:
        store.save_league_meta(meta)  # storing is an optimisation; a team that is not synced yet simply has nothing stored


def needs_lookup(entry: dict[str, Any] | None, game_id: str, state: str) -> bool:
    """True only when the stored result could be out of date."""
    if not entry or not entry.get("streak"):
        return True
    if str(state or "").lower() in ("pre", "in"):
        return False
    return str(game_id) not in set(entry.get("done") or [])


def resolve_streak(
    entry: dict[str, Any] | None,
    team_id: str,
    game_id: str,
    state: str,
    fetch_events: Callable[[], list[dict]],
    compute: Callable[[list[dict], str], str] = streak_from_schedule,
) -> tuple[str, dict[str, Any] | None]:
    """(streak to show, new stored entry or None when nothing changed). A failed lookup falls back to the stored streak."""
    if not needs_lookup(entry, game_id, state):
        return str((entry or {}).get("streak") or ""), None
    try:
        events = fetch_events()
    except Exception:  # noqa: BLE001 - keep whatever we already knew
        return str((entry or {}).get("streak") or ""), None
    streak = compute(events, team_id)
    if not streak:
        return str((entry or {}).get("streak") or ""), None
    return streak, {"streak": streak, "done": sorted(completed_event_ids(events))}


# ---------------------------------------------------------------------------------------------------------------------------
# League standings snapshot — pulled from ESPN, stored in team-meta/{league}-standings.json, and read by the ticker from there.
# Standings only change when a game finishes, so ESPN is asked again ONLY when a finished game on the board is not yet reflected.
# ---------------------------------------------------------------------------------------------------------------------------

def load_snapshot(league_id: str) -> dict[str, Any] | None:
    """{"teams": {team_id: standing}, "counted": [...]}: every team's standing is read from its own record; the list of finished games already
    reflected sits in the league header of the same file."""
    meta = LogoStore().load_league_meta(cache_id_for(league_id))
    teams = {tid: t.data["standing"] for tid, t in meta.teams.items() if isinstance(t.data.get("standing"), dict)}
    if not teams:
        return None
    return {"league": league_id, "teams": teams, "counted": list(meta.sync.get("standingsCounted") or [])}


def save_snapshot(league_id: str, teams: dict[str, dict], counted: set[str]) -> None:
    store = LogoStore()
    meta = store.load_league_meta(cache_id_for(league_id))
    for tid, team in meta.teams.items():
        if tid in teams:
            team.data["standing"] = teams[tid]
        else:
            team.data.pop("standing", None)
    meta.sync["standingsCounted"] = sorted(counted)
    store.save_league_meta(meta)


def _finished(games: list[dict]) -> list[dict]:
    return [g for g in games if str(g.get("state") or "").lower() == "post" and g.get("id")]


def needs_standings_refresh(snapshot: dict[str, Any] | None, games: list[dict], frozen: bool = False) -> bool:
    """True when we have nothing stored, or a game on the board has finished that the stored standings do not reflect yet.
    `frozen`: the postseason of a pro league - ESPN's standings no longer change (a playoff game never moves the regular-season record), so every
    finished playoff game would look "not reflected" and the standings would be pulled again every rotation for nothing. Keep the stored copy."""
    if not snapshot:
        return True
    if frozen:
        return False
    counted = set(snapshot.get("counted") or [])
    return any(str(g["id"]) not in counted for g in _finished(games))


def reflected_game_ids(previous: dict[str, Any] | None, fresh_teams: dict[str, dict], games: list[dict]) -> set[str]:
    """Finished games whose result shows up in the freshly pulled standings. A game counts once the standings of at least one of its two teams
    changed (record or streak) compared with what was stored — if neither changed, ESPN has not caught up yet and we ask again next time."""
    counted = set((previous or {}).get("counted") or [])
    old_teams = (previous or {}).get("teams") or {}
    for game in _finished(games):
        gid = str(game["id"])
        if gid in counted:
            continue
        if not old_teams:
            counted.add(gid)  # first snapshot: nothing to compare with
            continue
        changed = False
        for side in ("away", "home"):
            tid = str(((game.get("teams") or {}).get(side) or {}).get("id") or "")
            old, new = old_teams.get(tid) or {}, fresh_teams.get(tid) or {}
            if tid and new and ((old.get("overall"), old.get("streak")) != (new.get("overall"), new.get("streak"))):
                changed = True
        if changed:
            counted.add(gid)
    return counted
