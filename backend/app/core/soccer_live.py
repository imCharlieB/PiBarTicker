"""Where the ball is in a live soccer match, from ESPN's core "plays" feed.

Each play has `fieldPositionX` on a 0-100 scale **from the acting team's own goal (0) to the opponent's goal (100)** (checked against a real
match: the goals of BOTH teams are at x = 82-96). The ticker's pitch is fixed: the away team's goal on the left, the home team's on the right,
so the away team attacks right (x as is) and the home team attacks left (100 - x).
The feed lists plays oldest first (a whole match is ~1400 plays), so the newest ones are on the LAST page.
"""

from __future__ import annotations

import math
import re


def team_id_from_ref(ref: str) -> str:
    """".../seasons/2026/teams/357?lang=en" -> "357"."""
    match = re.search(r"/teams/(\d+)", str(ref or ""))
    return match.group(1) if match else ""


def ball_position(x: float, side: str) -> int | None:
    """Ball position 0-100 across the ticker's pitch (0 = away goal, 100 = home goal) for a play at `x` by the `side` ("away" / "home") team."""
    try:
        value = float(x)
    except (TypeError, ValueError):
        return None
    value = max(0.0, min(100.0, value))
    if side == "away":
        return round(value)
    if side == "home":
        return round(100.0 - value)
    return None


def last_page(count: int, page_size: int) -> int:
    """Page number (1-based) that holds the newest plays."""
    return max(1, math.ceil(max(0, int(count)) / max(1, int(page_size))))


def latest_ball_position(plays: list[dict], side_by_team_id: dict[str, str]) -> int | None:
    """Ball position from the newest play (oldest-first list) that has a position and a known team."""
    for play in reversed(plays or []):
        if not isinstance(play, dict) or play.get("fieldPositionX") is None:
            continue
        side = side_by_team_id.get(team_id_from_ref(((play.get("team") or {}).get("$ref")) or ""))
        position = ball_position(play.get("fieldPositionX"), side or "")
        if position is not None:
            return position
    return None
