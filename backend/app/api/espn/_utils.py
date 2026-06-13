from __future__ import annotations

import re

from ...core.http_client import HttpClient, InMemoryResponseCache

_http_client = HttpClient(
    timeout_seconds=8.0,
    max_retries=2,
    retry_backoff_seconds=0.4,
    cache=InMemoryResponseCache(),
)


def _normalized(value: object) -> str:
    return str(value or "").strip().lower()


def _group_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _normalized(value)).strip("-")


def _normalize_ref_url(url: str) -> str:
    return url.replace("http://sports.core.api.espn.com", "https://sports.core.api.espn.com")


def _groups_endpoint_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/groups"


def _site_standings_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings"


def _rankings_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/rankings"
