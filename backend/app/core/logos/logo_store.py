"""Core logic for caching team logos and metadata to disk.

Design goals:
- Logos and colors are relatively static (unlike live stats).
- Support multiple variants per team (default, dark, scoreboard, etc.).
- Keep team-meta/{league}.json as the source of truth for team data + logo paths.
- Allow the system to intelligently pick the best logo variant.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ...core.paths import get_runtime_paths


@dataclass
class TeamLogoInfo:
    """Represents one entity's cached logo information.

    NOTE (2026-05): Currently named "Team" for historical reasons. This is being
    generalized to support individual athletes/drivers/riders/golfers etc. for
    motorsports and single-person sports (NASCAR, Motocross, Golf, F1 drivers, etc.).
    The storage format and keys will stay compatible.
    """
    id: str
    abbreviation: str
    display_name: str
    color: str = ""
    alternate_color: str = ""
    # Map of variant name -> relative path (e.g. "dark" -> "logos/mlb/BAL_dark.png")
    logos: dict[str, str] = field(default_factory=dict)
    # Original remote URLs (for re-download if needed)
    remote_urls: dict[str, str] = field(default_factory=dict)

    # User override: if set, the system will prefer this variant when possible.
    # Example: "dark", "scoreboard", "full", etc.
    preferred_variant: str | None = None

    # List of known variants we have successfully cached
    available_variants: list[str] = field(default_factory=list)

    # Conference/division/group IDs this team belongs to (populated during sync, used for scoreboard filtering)
    groups: list[str] = field(default_factory=list)
    # Human-readable name of the most specific group (e.g. "SEC West", "NFC North")
    conference_name: str = ""


@dataclass
class LeagueTeamMeta:
    """Cached metadata for an entire league.

    The dict is still called `teams` for storage compatibility, but now holds
    both traditional teams *and* individual athletes (drivers, riders, golfers, etc.)
    depending on the sport.
    """
    league: str
    ts: str = ""
    teams: dict[str, TeamLogoInfo] = field(default_factory=dict)  # keyed by entity id (team or athlete)


class LogoStore:
    """Handles reading/writing the local logo cache."""

    def __init__(self) -> None:
        self.paths = get_runtime_paths()
        self.logos_root = self.paths.logos
        self.team_meta_root = self.paths.team_meta

    def get_league_meta_path(self, league: str) -> Path:
        return self.team_meta_root / f"{league}.json"

    def load_league_meta(self, league: str) -> LeagueTeamMeta:
        path = self.get_league_meta_path(league)
        if not path.exists():
            return LeagueTeamMeta(league=league)

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            teams: dict[str, TeamLogoInfo] = {}
            for team_id, tdata in (data.get("teams") or {}).items():
                teams[team_id] = TeamLogoInfo(
                    id=team_id,
                    abbreviation=tdata.get("abbreviation", ""),
                    display_name=tdata.get("display_name", ""),
                    color=tdata.get("color", ""),
                    alternate_color=tdata.get("alternate_color", ""),
                    logos=tdata.get("logos", {}),
                    remote_urls=tdata.get("remote_urls", {}),
                    preferred_variant=tdata.get("preferred_variant"),
                    available_variants=tdata.get("available_variants", []),
                    groups=tdata.get("groups", []),
                    conference_name=tdata.get("conference_name", ""),
                )
            return LeagueTeamMeta(
                league=league,
                ts=data.get("ts", ""),
                teams=teams,
            )
        except Exception:
            # Corrupt file? Start fresh.
            return LeagueTeamMeta(league=league)

    def save_league_meta(self, meta: LeagueTeamMeta) -> None:
        path = self.get_league_meta_path(meta.league)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "league": meta.league,
            "ts": meta.ts,
            "teams": {
                tid: {
                    "abbreviation": t.abbreviation,
                    "display_name": t.display_name,
                    "color": t.color,
                    "alternate_color": t.alternate_color,
                    "logos": t.logos,
                    "remote_urls": t.remote_urls,
                    "preferred_variant": t.preferred_variant,
                    "available_variants": t.available_variants,
                    "groups": t.groups,
                    "conference_name": t.conference_name,
                }
                for tid, t in meta.teams.items()
            },
        }
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def get_logo_filename(self, abbreviation: str, team_id: str, variant: str) -> str:
        """Generate filename using abbreviation + team id for uniqueness: BAL-1_dark.png"""
        safe_abbr = str(abbreviation or "").upper().replace("/", "").replace("\\", "")
        safe_id = str(team_id or "").replace("/", "").replace("\\", "")
        safe_variant = variant.lower().replace(" ", "_")
        return f"{safe_abbr}-{safe_id}_{safe_variant}.png"

    def get_logo_path(self, league: str, abbreviation: str, team_id: str, variant: str) -> Path:
        """Returns the full filesystem path using abbreviation+id naming for uniqueness."""
        league_dir = self.logos_root / league.lower()
        filename = self.get_logo_filename(abbreviation, team_id, variant)
        return league_dir / filename

    def has_logo(self, league: str, abbreviation: str, team_id: str, variant: str) -> bool:
        return self.get_logo_path(league, abbreviation, team_id, variant).exists()

    # ------------------------------------------------------------------
    # Smart Logo Selection
    # ------------------------------------------------------------------

    def get_best_logo_path(
        self,
        league: str,
        team: TeamLogoInfo,
        *,
        theme_mode: str | None = None,
        context: str | None = None,
    ) -> str | None:
        """
        Intelligently pick the best logo for a team.

        Priority:
        1. User override (`preferred_variant`) if the file exists
        2. Context-aware (e.g. "dark" when theme_mode == "dark" or "team")
        3. Common good defaults: scoreboard > dark > default > full
        4. First available variant

        Returns relative path (suitable for frontend) or None.
        """
        if not team.logos:
            return None

        # 1. Respect explicit user override
        if team.preferred_variant:
            if team.preferred_variant in team.logos:
                return team.logos[team.preferred_variant]

        # 2. Theme-aware selection
        if theme_mode in ("dark", "team"):
            for candidate in ("dark", "full_dark"):
                if candidate in team.logos:
                    return team.logos[candidate]

        # 3. Context hints (future use: "card", "small", "header", etc.)
        if context == "card":
            for candidate in ("scoreboard", "default"):
                if candidate in team.logos:
                    return team.logos[candidate]

        # 4. Reasonable default priority order
        priority_order = ["scoreboard", "default", "dark", "full", "full_default"]
        for variant in priority_order:
            if variant in team.logos:
                return team.logos[variant]

        # 5. Fallback to whatever we have
        first_key = next(iter(team.logos.keys()), None)
        if first_key:
            return team.logos[first_key]

        return None

    def set_user_override(self, meta: LeagueTeamMeta, team_id: str, variant: str | None) -> None:
        """Allow user to force a specific variant for a team."""
        if team_id in meta.teams:
            meta.teams[team_id].preferred_variant = variant

    def clear_league_cache(self, league: str) -> None:
        """Delete all cached data for a league: the team-meta JSON and the logos/<league> directory tree.
        Safe to call even if nothing exists.
        """
        league_key = (league or "").lower().strip()
        if not league_key:
            return

        # Remove meta file
        meta_path = self.get_league_meta_path(league_key)
        try:
            if meta_path.exists():
                meta_path.unlink()
        except Exception:
            pass  # best effort

        # Remove the logos directory for the league
        league_logos_dir = self.logos_root / league_key
        try:
            if league_logos_dir.exists() and league_logos_dir.is_dir():
                shutil.rmtree(league_logos_dir)
        except Exception:
            pass  # best effort