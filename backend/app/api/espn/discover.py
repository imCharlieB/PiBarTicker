from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from ...core.espn_registry import list_registry_entries
from ._utils import _http_client, _normalize_ref_url, _normalized

router = APIRouter()

_ALLOWED_HOSTS = {
    "site.api.espn.com",
    "sports.core.api.espn.com",
}


def _validate_espn_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid URL.") from error

    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Only https URLs are allowed.")

    hostname = parsed.hostname or ""
    if hostname not in _ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="URL host is not allowed.")

    return url


def _parse_sport_slug_from_ref(ref: str) -> str:
    match = re.search(r"/sports/([^/?]+)", ref)
    return match.group(1) if match else ""


def _parse_league_slug_from_ref(ref: str) -> str:
    match = re.search(r"/leagues/([^/?]+)", ref)
    return match.group(1) if match else ""


def _core_sports_endpoint_url() -> str:
    return "https://sports.core.api.espn.com/v2/sports?lang=en&region=us"


def _core_sport_leagues_endpoint_url(*, sport: str) -> str:
    return f"https://sports.core.api.espn.com/v2/sports/{sport}/leagues?lang=en&region=us"


def _site_scoreboard_url(*, sport: str, league: str) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard"


@router.get("/proxy")
def proxy_espn_json(
    url: str = Query(..., description="Absolute ESPN JSON endpoint URL."),
    cache_ttl_seconds: float = Query(120.0, ge=0.0, le=3600.0),
) -> object:
    safe_url = _validate_espn_url(url)

    try:
        return _http_client.get_json(
            safe_url,
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN data: {error}") from error


@router.get("/league-registry")
def get_league_registry() -> object:
    entries = list_registry_entries()
    return {
        "leagueCount": len(entries),
        "leagues": [
            {
                "leagueId": entry.league_id,
                "sport": entry.sport,
                "league": entry.league,
                "scoreboardUrl": entry.scoreboard_url,
                "supportsWeekFilter": entry.supports_week_filter,
            }
            for entry in entries
        ],
    }


@router.get("/discover-leagues")
def discover_leagues(
    sport: str | None = Query(None, description="Optional sport slug filter, for example football."),
    cache_ttl_seconds: float = Query(600.0, ge=0.0, le=3600.0),
) -> object:
    normalized_sport_filter = _normalized(sport)

    try:
        sports_payload = _http_client.get_json(
            _core_sports_endpoint_url(),
            use_cache=cache_ttl_seconds > 0,
            cache_ttl_seconds=cache_ttl_seconds,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to fetch ESPN sports catalog: {error}") from error

    sports_items = sports_payload.get("items") or []
    discovered: list[dict[str, str]] = []

    for sport_item in sports_items:
        sport_ref = str((sport_item or {}).get("$ref") or "").strip()
        if not sport_ref:
            continue

        sport_slug = _parse_sport_slug_from_ref(sport_ref)
        if not sport_slug:
            continue

        if normalized_sport_filter and _normalized(sport_slug) != normalized_sport_filter:
            continue

        sport_name = sport_slug
        try:
            sport_payload = _http_client.get_json(
                _normalize_ref_url(sport_ref),
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
            sport_name = str(sport_payload.get("name") or sport_slug)
        except Exception:
            sport_name = sport_slug

        try:
            leagues_payload = _http_client.get_json(
                _core_sport_leagues_endpoint_url(sport=sport_slug),
                use_cache=cache_ttl_seconds > 0,
                cache_ttl_seconds=cache_ttl_seconds,
            )
        except Exception:
            continue

        league_items = leagues_payload.get("items") or []
        for league_item in league_items:
            league_ref = str((league_item or {}).get("$ref") or "").strip()
            if not league_ref:
                continue

            league_slug = _parse_league_slug_from_ref(league_ref)
            if not league_slug:
                continue

            league_name = league_slug
            league_abbreviation = ""
            league_logo = ""
            try:
                league_payload = _http_client.get_json(
                    _normalize_ref_url(league_ref),
                    use_cache=cache_ttl_seconds > 0,
                    cache_ttl_seconds=cache_ttl_seconds,
                )
                league_name = str(league_payload.get("name") or league_slug)
                league_abbreviation = str(league_payload.get("abbreviation") or "")
                league_logos = league_payload.get("logos") or []
                if isinstance(league_logos, list):
                    for logo_item in league_logos:
                        logo_href = str((logo_item or {}).get("href") or "").strip()
                        if logo_href:
                            league_logo = logo_href
                            break
            except Exception:
                league_name = league_slug
                league_logo = ""

            discovered.append(
                {
                    "sport": sport_slug,
                    "sportName": sport_name,
                    "league": league_slug,
                    "leagueName": league_name,
                    "abbreviation": league_abbreviation,
                    "logo": league_logo,
                    "id": league_slug,
                    "scoreboardUrl": _site_scoreboard_url(sport=sport_slug, league=league_slug),
                }
            )

    discovered.sort(key=lambda item: (item["sportName"].lower(), item["leagueName"].lower()))
    return {
        "sportFilter": normalized_sport_filter,
        "count": len(discovered),
        "leagues": discovered,
    }
