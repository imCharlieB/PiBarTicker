"""High-level logo caching service.

This is the main entry point the API and refresh flows will use.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from .downloader import LogoDownloader
from .logo_store import LogoStore, LeagueTeamMeta, TeamLogoInfo
from ..groups_util import (
    build_group_id_to_name,
    build_team_group_memberships_from_groups,
    build_team_group_memberships_from_standings,
)


class LogoCacheService:
    """Coordinates fetching team data and caching logos locally."""

    def __init__(self) -> None:
        self.store = LogoStore()
        self.downloader = LogoDownloader(self.store)

    # Core "main" variants we always want during bulk "Sync Teams & Logos".
    # For high-team-count leagues like NCAA this keeps disk usage reasonable
    # (1-3 files per team instead of 8-15). Users can still pull full extras
    # per-team via the team detail page button.
    MAIN_VARIANT_ALLOWLIST: set[str] = {"default", "scoreboard", "dark", "primary"}

    def _collect_variants_to_download(
        self, raw_logos: list[dict], full: bool = False
    ) -> dict[str, str]:
        """
        Turn the ESPN logos[] array into a variant_name -> url map.

        When full=False (bulk sync default), we only keep a small curated set
        of main variants so NCAA etc. don't explode in file count.
        When full=True (per-team "download extras" button), we take everything
        non-size-based.
        """
        variants: dict[str, str] = {}
        first_good_href: str | None = None

        for logo in raw_logos or []:
            if not isinstance(logo, dict):
                continue
            href = logo.get("href")
            if not href:
                continue

            if first_good_href is None:
                first_good_href = href

            rels = logo.get("rel") or []
            if not isinstance(rels, list):
                rels = [rels] if rels else []

            for rel in rels:
                if not rel:
                    continue
                variant = str(rel).lower().replace(" ", "_")
                if variant.isdigit():
                    continue

                if full:
                    variants[variant] = href
                else:
                    if variant in self.MAIN_VARIANT_ALLOWLIST:
                        variants[variant] = href

        # Bulk main-only safety net: if we collected nothing useful, at least grab
        # the first non-size logo as "default" so every team has *something*.
        if not full and not variants and first_good_href:
            variants["default"] = first_good_href

        return variants

    def cache_league_from_espn_data(
        self,
        league: str,
        espn_teams: list[dict[str, Any]],
        *,
        full_variants: bool = False,
    ) -> LeagueTeamMeta:
        """
        Given raw team data from ESPN, download logos and update the local cache.

        By default (full_variants=False) we only download a small set of "main"
        variants (default/scoreboard/dark/primary). This is the new recommended
        behavior for bulk "Sync Teams & Logos" especially for NCAA and other
        high-team-count leagues.

        Set full_variants=True when doing a targeted per-team extra download.
        """
        meta = self.store.load_league_meta(league)
        meta.ts = datetime.now(timezone.utc).isoformat()

        for raw_team in espn_teams:
            team_id = str(raw_team.get("id") or "").strip()
            if not team_id:
                continue

            abbr = str(raw_team.get("abbreviation") or raw_team.get("shortDisplayName") or raw_team.get("shortName") or "").strip().upper()
            if not abbr:
                name = str(raw_team.get("displayName") or raw_team.get("name") or "").strip()
                parts = name.split()
                abbr = parts[-1][:5].upper() if parts else ""
            if not abbr:
                continue

            existing = meta.teams.get(team_id) or TeamLogoInfo(
                id=team_id,
                abbreviation=abbr,
                display_name=raw_team.get("displayName") or raw_team.get("name", ""),
            )

            # Update basic info
            existing.abbreviation = abbr or existing.abbreviation
            existing.display_name = raw_team.get("displayName") or raw_team.get("name") or existing.display_name
            existing.color = raw_team.get("color") or existing.color
            existing.alternate_color = raw_team.get("alternateColor") or existing.alternate_color

            raw_logos = raw_team.get("logos") or []
            variants_to_download = self._collect_variants_to_download(raw_logos, full=full_variants)

            if variants_to_download:
                self.downloader.download_variants(league, existing, variants_to_download)

            meta.teams[team_id] = existing

        self.store.save_league_meta(meta)
        return meta

    def cache_team_extras(
        self,
        league: str,
        team_id: str,
        raw_team_data: dict[str, Any],
    ) -> TeamLogoInfo:
        """
        Targeted download of (potentially many) logo variants for ONE team only.

        Intended for the "Download extra logos" button on a team's detail page.
        We always do the full set here (no main-only filtering).
        """
        meta = self.store.load_league_meta(league)
        meta.ts = datetime.now(timezone.utc).isoformat()

        tid = str(team_id or raw_team_data.get("id") or "").strip()
        if not tid:
            # fallback
            tid = team_id

        abbr = str(
            raw_team_data.get("abbreviation")
            or raw_team_data.get("shortDisplayName")
            or (raw_team_data.get("team") or {}).get("abbreviation")
            or ""
        ).strip().upper()

        display_name = (
            raw_team_data.get("displayName")
            or raw_team_data.get("name")
            or (raw_team_data.get("teamProfile") or {}).get("name")
            or ""
        )

        existing = meta.teams.get(tid) or TeamLogoInfo(
            id=tid,
            abbreviation=abbr or "UNK",
            display_name=display_name,
        )

        # Merge better metadata if the caller gave us richer info
        if abbr:
            existing.abbreviation = abbr
        if display_name:
            existing.display_name = display_name
        if raw_team_data.get("color"):
            existing.color = raw_team_data.get("color")
        if raw_team_data.get("alternateColor"):
            existing.alternate_color = raw_team_data.get("alternateColor")
        profile = raw_team_data.get("teamProfile") or {}
        if profile.get("color") and not existing.color:
            existing.color = profile["color"]
        if profile.get("alternateColor") and not existing.alternate_color:
            existing.alternate_color = profile["alternateColor"]

        # Always full set for per-team extras
        raw_logos = raw_team_data.get("logos") or []
        if not raw_logos:
            # try nested shapes from /team-logos response
            raw_logos = (raw_team_data.get("teamProfile") or {}).get("logos") or []

        variants_to_download = self._collect_variants_to_download(raw_logos, full=True)

        if variants_to_download:
            self.downloader.download_variants(league, existing, variants_to_download)

        meta.teams[tid] = existing
        self.store.save_league_meta(meta)
        return existing

    def enrich_team_groups(self, league: str, sport: str) -> None:
        """Fetch ESPN group/conference memberships and cache them in team-meta.

        Tries the groups endpoint first, then standings (which is more reliable
        for college sports). Merges both so we get complete coverage for NCAA.
        """
        meta = self.store.load_league_meta(league)
        if not meta.teams:
            return

        memberships: dict[str, set[str]] = {}
        raw_groups: list[dict] = []
        standings_children: list[dict] = []

        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                groups_url = f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/groups"
                try:
                    resp = client.get(groups_url)
                    if resp.is_success:
                        payload = resp.json()
                        raw_groups = payload.get("groups") or []
                        memberships = build_team_group_memberships_from_groups(raw_groups)
                except Exception:
                    pass

                standings_url = f"https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings"
                try:
                    resp = client.get(standings_url)
                    if resp.is_success:
                        payload = resp.json()
                        standings_children = payload.get("children") or []
                        standings_m = build_team_group_memberships_from_standings(standings_children)
                        for team_id, group_ids in standings_m.items():
                            memberships.setdefault(team_id, set()).update(group_ids)
                except Exception:
                    pass
        except Exception:
            return

        if not memberships:
            return

        id_to_name = build_group_id_to_name(raw_groups, standings_children)

        changed = False
        for team_id, group_ids in memberships.items():
            if team_id in meta.teams:
                new_groups = sorted(group_ids)
                # Pick the most specific group (deepest composite ID) for the display name
                deepest_id = max(group_ids, key=lambda g: g.count(':')) if group_ids else ''
                conf_name = id_to_name.get(deepest_id, '') if deepest_id else ''
                t = meta.teams[team_id]
                if t.groups != new_groups or t.conference_name != conf_name:
                    t.groups = new_groups
                    t.conference_name = conf_name
                    changed = True

        if changed:
            self.store.save_league_meta(meta)

    def close(self) -> None:
        self.downloader.close()