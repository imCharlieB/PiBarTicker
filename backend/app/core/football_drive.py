"""Where the current football drive started, from ESPN's per-game summary.

ESPN measures every yard line from the HOME team's goal line on a fixed axis (0 = home goal, 100 = away goal),
including a play's start.yardLine, so drive start can be drawn on the same axis as the ball.
"""

from __future__ import annotations

from typing import Any


def drive_start_from_summary(summary: dict[str, Any]) -> dict[str, Any] | None:
    """{"yardLine": int, "teamId": str} for the drive in progress, or None between drives / when unknown."""
    current = ((summary or {}).get("drives") or {}).get("current")
    if not isinstance(current, dict):
        return None
    plays = current.get("plays") or []
    if not plays or not isinstance(plays[0], dict):
        return None
    start = plays[0].get("start") or {}
    yard_line = start.get("yardLine")
    if not isinstance(yard_line, (int, float)):
        return None
    team = current.get("team") or {}
    return {"yardLine": int(yard_line), "teamId": str(team.get("id") or "")}


def win_probability_from_summary(summary: dict[str, Any]) -> dict[str, int] | None:
    """{"home": 0-100, "away": 0-100} from the last entry of ESPN's per-play `winprobability` list, or None when it is missing."""
    plays = (summary or {}).get("winprobability")
    if not isinstance(plays, list) or not plays or not isinstance(plays[-1], dict):
        return None
    pct = plays[-1].get("homeWinPercentage")
    if isinstance(pct, bool) or not isinstance(pct, (int, float)):
        return None
    home = max(0, min(100, round(float(pct) * 100)))
    return {"home": home, "away": 100 - home}
