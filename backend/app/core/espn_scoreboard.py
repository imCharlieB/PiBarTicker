from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .espn_registry import EspnLeagueRegistryEntry
from .http_client import HttpClient


@dataclass
class EspnScoreboardFetchResult:
    payload: dict[str, Any]
    fallback_used: bool
    source: str


@dataclass(frozen=True)
class CalendarWeek:
    week: int
    seasontype: int | None
    start: datetime
    end: datetime


def resolve_calendar_weeks(payload: dict[str, Any]) -> list[CalendarWeek]:
    """Flatten `leagues[0].calendar` into a chronologically-sorted list of every week ESPN
    knows about for this season, across every season type.

    ESPN's scoreboard response always includes this regardless of what week/date the request
    itself asked for -- it's season metadata, not query results. For football-family leagues
    it's nested: top-level groups (Preseason/Regular Season/Postseason, `value` = seasontype)
    each with `entries` (individual weeks, `value` = week number). Returning every group's
    entries (not just whichever ESPN's own default happens to be showing) means callers can
    naturally roll across season-type boundaries -- conference championships, bowl games, the
    Super Bowl -- without any hardcoded week-count assumptions.
    """
    leagues = payload.get("leagues") if isinstance(payload, dict) else None
    calendar = (leagues or [{}])[0].get("calendar") if isinstance(leagues, list) and leagues else None
    if not isinstance(calendar, list):
        return []

    def _parse(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None

    weeks: list[CalendarWeek] = []
    for group in calendar:
        if not isinstance(group, dict):
            continue
        entries = group.get("entries")
        if isinstance(entries, list) and entries:
            try:
                seasontype = int(group.get("value"))
            except (TypeError, ValueError):
                seasontype = None
            for entry_item in entries:
                if not isinstance(entry_item, dict):
                    continue
                start = _parse(entry_item.get("startDate"))
                end = _parse(entry_item.get("endDate"))
                try:
                    week = int(entry_item.get("value"))
                except (TypeError, ValueError):
                    continue
                if start and end:
                    weeks.append(CalendarWeek(week=week, seasontype=seasontype, start=start, end=end))
        else:
            # Flat calendar (no nested entries) -- each top-level item is itself a week/date range.
            start = _parse(group.get("startDate"))
            end = _parse(group.get("endDate"))
            try:
                week = int(group.get("value"))
            except (TypeError, ValueError):
                continue
            if start and end:
                weeks.append(CalendarWeek(week=week, seasontype=None, start=start, end=end))

    weeks.sort(key=lambda w: w.start)
    return weeks


class EspnScoreboardClient:
    def __init__(self, http_client: HttpClient) -> None:
        self._http_client = http_client
        self._last_successful_by_league: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _league_key(entry: EspnLeagueRegistryEntry) -> str:
        return f"{entry.sport}/{entry.league}"

    def fetch(
        self,
        *,
        entry: EspnLeagueRegistryEntry,
        week: int | None = None,
        seasontype: int | None = None,
        use_cache: bool = True,
        cache_ttl_seconds: float = 60.0,
    ) -> EspnScoreboardFetchResult:
        params: dict[str, Any] | None = None
        if week is not None and entry.supports_week_filter:
            params = {"week": week}
            if seasontype is not None:
                params["seasontype"] = seasontype

        league_key = self._league_key(entry)

        try:
            payload = self._http_client.get_json(
                entry.scoreboard_url,
                params=params,
                use_cache=use_cache,
                cache_ttl_seconds=cache_ttl_seconds,
            )
        except Exception:
            fallback_payload = self._last_successful_by_league.get(league_key)
            if isinstance(fallback_payload, dict):
                return EspnScoreboardFetchResult(
                    payload=fallback_payload,
                    fallback_used=True,
                    source="league-fallback",
                )
            raise

        if not isinstance(payload, dict):
            payload = {"events": []}

        self._last_successful_by_league[league_key] = payload

        return EspnScoreboardFetchResult(
            payload=payload,
            fallback_used=False,
            source="live",
        )
