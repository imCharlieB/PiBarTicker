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


def _division_label(name: str) -> str:
    """'American League East' -> 'AL East', 'Atlantic Division' -> 'Atlantic'; 'AFC East' stays."""
    label = re.sub(r"\s+Division$", "", str(name or "").strip())
    label = re.sub(r"^American League\b", "AL", label)
    label = re.sub(r"^National League\b", "NL", label)
    return label


def build_division_standings(children: list[dict]) -> dict[str, dict]:
    """Build {team_id: {division, divisionLabel, place, seed, streak}} from ESPN /standings?level=3.

    Entries inside a division come back ordered best-first, so place is the 1-based index.
    """
    out: dict[str, dict] = {}

    def stat(entry: dict, name: str) -> str:
        for item in entry.get("stats") or []:
            if item.get("name") == name:
                return str(item.get("displayValue") if item.get("displayValue") is not None else item.get("value") or "").strip()
        return ""

    def walk(nodes: list[dict], conference: str) -> None:
        for node in nodes:
            name = str(node.get("name") or "").strip()
            entries = (node.get("standings") or {}).get("entries") or []
            if isinstance(entries, list) and entries:
                for index, entry in enumerate(entries):
                    team_id = str((entry.get("team") or {}).get("id") or "").strip()
                    if not team_id:
                        continue
                    seed = stat(entry, "playoffSeed")
                    out[team_id] = {
                        "division": name,
                        "divisionLabel": _division_label(name),
                        "conference": conference,
                        "place": index + 1,
                        "seed": int(seed) if seed.isdigit() else None,
                        "streak": stat(entry, "streak"),
                    }
            nested = node.get("children") or []
            if isinstance(nested, list) and nested:
                walk(nested, name)

    walk(children if isinstance(children, list) else [], "")
    return out


def pick_headline_poll(rankings: list[dict], top_n: int = 25) -> tuple[dict[str, int], str]:
    """Pick the ranking to show on cards from ESPN's /rankings list: CFP committee when it exists, else AP,
    else the first poll with ranked teams. Returns ({team_id: rank}, label) — label is "CFP", "AP", "COACHES" or "RANK".
    """
    def ranks_of(ranking: dict) -> dict[str, int]:
        out: dict[str, int] = {}
        for entry in ranking.get("ranks") or []:
            current = entry.get("current")
            team_id = str((entry.get("team") or {}).get("id") or "").strip()
            if team_id and isinstance(current, int) and 0 < current <= top_n:
                out[team_id] = current
        return out

    def label_of(ranking: dict) -> str:
        text = _normalized(f"{ranking.get('name') or ''} {ranking.get('shortName') or ''}")
        if "playoff" in text or "cfp" in re.findall("[a-z]+", text):
            return "CFP"
        if "ap" in re.findall("[a-z]+", text) or "associated press" in text:
            return "AP"
        if "coaches" in text:
            return "COACHES"
        return "RANK"

    candidates = [(label_of(r), ranks_of(r)) for r in rankings or [] if isinstance(r, dict)]
    candidates = [c for c in candidates if c[1]]
    for wanted in ("CFP", "AP"):
        for label, ranks in candidates:
            if label == wanted:
                return ranks, label
    return (candidates[0][1], candidates[0][0]) if candidates else ({}, "")
