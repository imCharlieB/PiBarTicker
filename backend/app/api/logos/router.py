"""API endpoints for managing the local logo cache.

Replaces the old per-league teamStyles blob that used to live inside config.json.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ...core.logos.cache_service import LogoCacheService
from ...core.logos.f1_cache_service import F1CacheService
from ...core.logos.nascar_cache_service import NascarCacheService
from ...core.logos.logo_store import LogoStore

router = APIRouter(prefix="/api/v1/logos", tags=["logos"])

_store = LogoStore()
_cache_service = LogoCacheService()


@router.get("/meta/{league}")
def get_league_logo_meta(league: str) -> dict:
    """Return cached team metadata + logo information for a league."""
    meta = _store.load_league_meta(league)
    return {
        "league": meta.league,
        "ts": meta.ts,
        "team_count": len(meta.teams),
        "teams": {
            tid: {
                "id": t.id,
                "abbreviation": t.abbreviation,
                "display_name": t.display_name,
                "color": t.color,
                "alternate_color": t.alternate_color,
                "available_variants": t.available_variants,
                "preferred_variant": t.preferred_variant,
                "logos": t.logos,
                "remote_urls": t.remote_urls,
            }
            for tid, t in meta.teams.items()
        },
    }


@router.post("/meta/{league}/override/{team_id}")
def set_team_logo_override(league: str, team_id: str, variant: str | None = None) -> dict:
    """Allow user to set (or clear) a preferred logo variant for a team."""
    meta = _store.load_league_meta(league)
    if team_id not in meta.teams:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found in cache for {league}")

    meta.teams[team_id].preferred_variant = variant
    _store.save_league_meta(meta)

    return {
        "league": league,
        "team_id": team_id,
        "preferred_variant": variant,
        "message": "Override saved",
    }


@router.post("/cache/{league}")
def trigger_league_logo_cache(league: str, teams: list[dict], full_variants: bool = False) -> dict:
    """
    Accepts raw team data (same shape as what the frontend gets from ESPN teams endpoint)
    and triggers logo downloading + metadata update for the league.

    By default (full_variants=False) only main/primary variants are downloaded.
    This keeps NCAA and other large leagues from creating thousands of files.
    Per-team "download the rest" is available via the dedicated team extras endpoint.
    """
    if not teams:
        raise HTTPException(status_code=400, detail="No teams provided")

    try:
        meta = _cache_service.cache_league_from_espn_data(league, teams, full_variants=full_variants)
        return {
            "league": league,
            "status": "success",
            "teams_cached": len(meta.teams),
            "message": f"Cached logos for {len(meta.teams)} teams in {league}",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to cache logos: {exc}") from exc


@router.delete("/cache/{league}")
def clear_league_logo_cache(league: str) -> dict:
    """Delete the local logo cache (meta JSON + all logo image files) for a league."""
    try:
        _store.clear_league_cache(league)
        return {
            "league": league,
            "status": "success",
            "message": f"Cleared cached logos and meta for {league}",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to clear logo cache: {exc}") from exc


@router.post("/cache/nascar/sync")
def sync_nascar_data() -> dict:
    """Sync NASCAR driver headshots and badge metadata from cf.nascar.com."""
    service = NascarCacheService()
    try:
        return service.sync_all()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"NASCAR sync failed: {exc}") from exc


@router.post("/cache/f1/sync")
def sync_f1_data(year: int = 2026) -> dict:
    """Sync F1 driver headshots, team car images, and circuit maps from F1 CDN."""
    service = F1CacheService()
    try:
        return service.sync_all(year=year)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"F1 sync failed: {exc}") from exc
    finally:
        service.close()


@router.post("/cache/{league}/team/{team_id}")
def cache_extras_for_single_team(league: str, team_id: str, payload: dict) -> dict:
    """
    Download extra (or all) logo variants for ONE specific team only.

    This is the "get the extra logos on demand" path for the team detail page.
    The body should be the rich response from /api/v1/espn/team-logos (or at minimum
    contain a "logos" array + team identifiers). We always fetch the full set here.
    """
    if not payload:
        raise HTTPException(status_code=400, detail="No team/logo payload provided")

    try:
        updated = _cache_service.cache_team_extras(league, team_id, payload)
        return {
            "league": league,
            "team_id": updated.id,
            "status": "success",
            "variants_now_cached": len(updated.logos),
            "available_variants": updated.available_variants,
            "message": f"Cached extra logos for {updated.abbreviation or team_id} in {league}",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to cache team extras: {exc}") from exc