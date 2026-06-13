"""Shared utilities for building team→group membership mappings from ESPN data.

Used by:
  - api/espn/scoreboard.py  (live group filtering at request time)
  - core/logos/cache_service.py  (caching group memberships during sync)
"""

from __future__ import annotations

import re


def _normalized(value: object) -> str:
    return str(value or "").strip().lower()


def _group_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _normalized(value)).strip("-")


def build_team_group_memberships_from_groups(groups: list[dict]) -> dict[str, set[str]]:
    """Build {team_id: {group_id, ...}} from ESPN /groups endpoint payload."""
    memberships: dict[str, set[str]] = {}

    def walk(items: list[dict], parent: dict | None = None) -> None:
        for item in items:
            raw_group_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            abbreviation = str(item.get("abbreviation") or "").strip()
            group_id = raw_group_id or _group_key(abbreviation or name)

            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and group_id:
                group_id = f"{parent_id}:{group_id}"

            teams = item.get("teams") or []
            if isinstance(teams, list):
                for team_entry in teams:
                    team = (team_entry or {}).get("team") or team_entry or {}
                    team_id = str(team.get("id") or "").strip()
                    if not team_id:
                        continue
                    team_groups = memberships.setdefault(team_id, set())
                    if group_id:
                        team_groups.add(group_id.lower())
                    if parent_id:
                        team_groups.add(parent_id.lower())

            nested = item.get("groups") or item.get("children") or []
            if isinstance(nested, list) and nested:
                walk(nested, {"id": group_id, "name": name, "abbreviation": abbreviation})

    walk(groups if isinstance(groups, list) else [])
    return memberships


def build_group_id_to_name(groups: list[dict], standings_children: list[dict] | None = None) -> dict[str, str]:
    """Build {composite_group_id: human_readable_name} from ESPN groups + standings data."""
    id_to_name: dict[str, str] = {}

    def walk_groups(items: list[dict], parent: dict | None = None) -> None:
        for item in items:
            raw_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            abbreviation = str(item.get("abbreviation") or "").strip()
            group_id = raw_id or _group_key(abbreviation or name)
            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and group_id:
                group_id = f"{parent_id}:{group_id}"
            if group_id and name:
                id_to_name[group_id.lower()] = name
            nested = item.get("groups") or item.get("children") or []
            if isinstance(nested, list) and nested:
                walk_groups(nested, {"id": group_id, "name": name})

    walk_groups(groups if isinstance(groups, list) else [])

    def walk_standings(children: list[dict], parent: dict | None = None) -> None:
        for child in children:
            raw_id = str(child.get("id") or "").strip()
            name = str(child.get("name") or "").strip()
            abbreviation = str(child.get("abbreviation") or "").strip()
            child_id = raw_id or _group_key(abbreviation or name)
            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and child_id:
                child_id = f"{parent_id}:{child_id}"
            if child_id and name:
                id_to_name[child_id.lower()] = name
            nested = child.get("children") or []
            if isinstance(nested, list) and nested:
                walk_standings(nested, {"id": child_id, "name": name})

    walk_standings(standings_children if isinstance(standings_children, list) else [])
    return id_to_name


def build_team_group_memberships_from_standings(children: list[dict]) -> dict[str, set[str]]:
    """Build {team_id: {group_id, ...}} from ESPN /standings endpoint payload."""
    memberships: dict[str, set[str]] = {}

    def walk(children: list[dict], parent: dict | None = None) -> None:
        for child in children:
            raw_child_id = str(child.get("id") or "").strip()
            name = str(child.get("name") or "").strip()
            abbreviation = str(child.get("abbreviation") or "").strip()
            child_id = raw_child_id or _group_key(abbreviation or name)

            parent_id = str((parent or {}).get("id") or "").strip()
            if parent_id and child_id:
                child_id = f"{parent_id}:{child_id}"

            standings = child.get("standings") or {}
            entries = standings.get("entries") or []
            if isinstance(entries, list):
                for entry in entries:
                    team = entry.get("team") or {}
                    team_id = str(team.get("id") or "").strip()
                    if not team_id:
                        continue
                    team_groups = memberships.setdefault(team_id, set())
                    if child_id:
                        team_groups.add(child_id.lower())
                    if parent_id:
                        team_groups.add(parent_id.lower())

            nested = child.get("children") or []
            if isinstance(nested, list) and nested:
                walk(nested, {"id": child_id, "name": name, "abbreviation": abbreviation})

    walk(children if isinstance(children, list) else [])
    return memberships
