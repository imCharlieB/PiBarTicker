from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .espn_registry import EspnLeagueRegistryEntry
from .http_client import HttpClient


@dataclass
class EspnScoreboardFetchResult:
    payload: dict[str, Any]
    fallback_used: bool
    source: str


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
        use_cache: bool = True,
        cache_ttl_seconds: float = 60.0,
    ) -> EspnScoreboardFetchResult:
        params: dict[str, Any] | None = None
        if week is not None and entry.supports_week_filter:
            params = {"week": week}

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
