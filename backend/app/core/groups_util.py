"""Shared utilities for building team→group membership mappings from ESPN data.

Used by:
  - api/espn/scoreboard.py  (live group filtering at request time)
  - core/cache_service.py  (caching group memberships during sync)
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


def build_division_standings(children: list[dict], show_seeds_up_to: int | None = None) -> dict[str, dict]:
    """Build {team_id: {division, divisionLabel, place, seed, streak}} from ESPN /standings?level=3.

    Entries inside a division come back ordered best-first, so place is the 1-based index.
    show_seeds_up_to: when set, teams seeded at or above that line also get showSeed=True (cards show the seed
    instead of the division place); conferenceAbbr ("AFC") labels it.
    """
    out: dict[str, dict] = {}

    def stat(entry: dict, name: str) -> str:
        for item in entry.get("stats") or []:
            if item.get("name") == name:
                return str(item.get("displayValue") if item.get("displayValue") is not None else item.get("value") or "").strip()
        return ""

    def walk(nodes: list[dict], conference: str, conference_abbr: str) -> None:
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
                        "conferenceAbbr": conference_abbr,
                        "place": index + 1,
                        "seed": int(seed) if seed.isdigit() else None,
                        "streak": stat(entry, "streak"),
                        "overall": stat(entry, "overall"),
                    }
                    seed_no = out[team_id]["seed"]
                    if show_seeds_up_to and seed_no and seed_no <= show_seeds_up_to:
                        out[team_id]["showSeed"] = True
            nested = node.get("children") or []
            if isinstance(nested, list) and nested:
                walk(nested, name, str(node.get("abbreviation") or "").strip())

    walk(children if isinstance(children, list) else [], "", "")
    return out


def poll_label(ranking: dict) -> str:
    """"CFP", "AP", "COACHES" or "RANK" for one entry of ESPN's /rankings list."""
    text = _normalized(f"{ranking.get('name') or ''} {ranking.get('shortName') or ''}")
    words = re.findall("[a-z]+", text)
    if "playoff" in text or "cfp" in words:
        return "CFP"
    if "ap" in words or "associated press" in text:
        return "AP"
    if "coaches" in text:
        return "COACHES"
    return "RANK"


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

    candidates = [(poll_label(r), ranks_of(r)) for r in rankings or [] if isinstance(r, dict)]
    candidates = [c for c in candidates if c[1]]
    for wanted in ("CFP", "AP"):
        for label, ranks in candidates:
            if label == wanted:
                return ranks, label
    return (candidates[0][1], candidates[0][0]) if candidates else ({}, "")


def results_from_schedule(events: list[dict], team_id: str) -> list[bool]:
    """Won (True) / lost (False) for every finished game in an ESPN team schedule, oldest first."""
    results: list[tuple[str, bool]] = []
    for event in events or []:
        for competition in event.get("competitions") or []:
            if not ((competition.get("status") or {}).get("type") or {}).get("completed"):
                continue
            mine = next(
                (c for c in competition.get("competitors") or [] if str((c.get("team") or {}).get("id")) == str(team_id)),
                None,
            )
            if mine is None or mine.get("winner") is None:
                continue
            results.append((str(event.get("date") or ""), bool(mine.get("winner"))))
    results.sort(key=lambda r: r[0])
    return [won for _, won in results]


def streak_from_results(results: list[bool]) -> str:
    """"W3" / "L1" from oldest-first results; "" when there are none."""
    if not results:
        return ""
    last_win = results[-1]
    run = 0
    for won in reversed(results):
        if won != last_win:
            break
        run += 1
    return f"{'W' if last_win else 'L'}{run}"


def streak_from_schedule(events: list[dict], team_id: str) -> str:
    """Current win/loss streak ("W3", "L1") from an ESPN team schedule's events; "" when no completed game."""
    return streak_from_results(results_from_schedule(events, team_id))


def carry_streak(base: str, later_results: list[bool]) -> str:
    """A streak that goes on through more games: `base` is the streak so far ("W3"), `later_results` the games since, oldest first.
    ESPN's standings streak is frozen at the end of the regular season, so the playoff games are added to it here."""
    letter = base[:1] if base[:1] in ("W", "L") else ""
    run = int(base[1:]) if letter and base[1:].isdigit() else 0
    for won in later_results:
        mark = "W" if won else "L"
        if mark == letter:
            run += 1
        else:
            letter, run = mark, 1
    return f"{letter}{run}" if letter and run else ""


def completed_event_ids(events: list[dict]) -> set[str]:
    """ESPN event ids of a team schedule's finished games."""
    out: set[str] = set()
    for event in events or []:
        for competition in event.get("competitions") or []:
            if ((competition.get("status") or {}).get("type") or {}).get("completed"):
                out.add(str(event.get("id") or ""))
    out.discard("")
    return out


def college_standings_snapshot(children: list[dict]) -> dict[str, dict]:
    """{team_id: {"streak": "W6"/"L1" or "", "overall": "6-0"}} for EVERY team in ESPN's /standings?level=3.
    The streak is blank ("-") for roughly 40% of college teams; those are filled in from the team's schedule elsewhere."""
    out: dict[str, dict] = {}

    def walk(nodes: list[dict]) -> None:
        for node in nodes:
            for entry in (node.get("standings") or {}).get("entries") or []:
                team_id = str((entry.get("team") or {}).get("id") or "").strip()
                if not team_id:
                    continue
                names = {str(st.get("name")): str(st.get("displayValue") or "").strip() for st in entry.get("stats") or []}
                streak = names.get("streak", "")
                out[team_id] = {"streak": streak if re.fullmatch(r"[WL]\d+", streak) else "", "overall": names.get("overall", "")}
            nested = node.get("children") or []
            if isinstance(nested, list) and nested:
                walk(nested)

    walk(children if isinstance(children, list) else [])
    return out


def apply_seed_line(teams: dict[str, dict], line: int | None) -> dict[str, dict]:
    """Copy of the stored standings with showSeed set for teams seeded at or above `line` (None = nobody). The line depends on the week,
    so it is applied per request and never stored."""
    out: dict[str, dict] = {}
    for team_id, standing in teams.items():
        item = {k: v for k, v in standing.items() if k != "showSeed"}
        seed = item.get("seed")
        if line and isinstance(seed, int) and 0 < seed <= line:
            item["showSeed"] = True
        out[team_id] = item
    return out


def merge_schedule_events(first: list[dict], extra: list[dict]) -> list[dict]:
    """A team's regular-season schedule plus its postseason games (ESPN returns them from separate calls), without duplicates."""
    seen = {str(e.get("id") or "") for e in first or []}
    return list(first or []) + [e for e in (extra or []) if str(e.get("id") or "") not in seen]
