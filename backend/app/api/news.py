from __future__ import annotations

import re
from fastapi import APIRouter

from ..core.espn_registry import get_registry_entry, _REGISTRY
from .espn._utils import _http_client

# Strips ESPN's "MLB 2026: " / "NFL 2025-26: " league+year prefixes from headlines
_HEADLINE_PREFIX_RE = re.compile(r'^[A-Z][A-Z0-9 ]+\d{4}(?:-\d{2,4})?:\s*', re.IGNORECASE)

router = APIRouter(prefix="/api/v1/news", tags=["news"])

_NEWS_TTL = 300.0  # 5 minutes — backend handles rate limiting for all clients

# Article types ESPN returns that are not displayable as ticker headlines.
# "media" (TV/video segments) is kept — headlines are valid sports items even if content is a clip.
_SKIP_TYPES = {"video", "fantasy"}


def _is_unwanted(article: dict) -> bool:
    art_type = str(article.get("type") or "").strip().lower()
    if art_type in _SKIP_TYPES:
        return True

    headline = str(article.get("headline") or "").lower()
    _FANTASY_TERMS = (
        "fantasy", "rankings", "projections", "waiver wire",
        "start/sit", "sit/start", "mock draft", "sleeper",
        "trade value", "depth chart", "injury report for fantasy",
        "betting", "sportsbook", "gambling", "parlay", "prop bet",
        "wagering", "best bets", "betting guide", "betting odds",
    )
    if any(term in headline for term in _FANTASY_TERMS):
        return True

    # ESPN tags fantasy articles with a "fantasy" category description or uid
    for cat in article.get("categories") or []:
        if not isinstance(cat, dict):
            continue
        if "fantasy" in str(cat.get("description") or "").lower():
            return True
        if "fantasy" in str(cat.get("uid") or "").lower():
            return True

    return False


@router.get("")
def get_news(leagues: str = "", limit: int = 10) -> list[dict]:
    league_ids = [lid.strip() for lid in leagues.split(",") if lid.strip()]
    articles: list[dict] = []
    seen_ids: set[str] = set()

    for league_id in league_ids:
        entry = get_registry_entry(league_id)
        if not entry:
            continue
        url = f"https://site.api.espn.com/apis/site/v2/sports/{entry.sport}/{entry.league}/news"
        try:
            data = _http_client.get_json(url, cache_ttl_seconds=_NEWS_TTL)
            for article in data.get("articles") or []:
                if _is_unwanted(article):
                    continue
                art_id = str(
                    article.get("dataSourceIdentifier") or article.get("id") or ""
                ).strip()
                if not art_id or art_id in seen_ids:
                    continue
                seen_ids.add(art_id)
                headline = _HEADLINE_PREFIX_RE.sub("", str(article.get("headline") or "").strip()).strip()
                if not headline:
                    continue
                articles.append({
                    "id": art_id,
                    "headline": headline,
                    "description": str(article.get("description") or "").strip(),
                    "published": str(article.get("published") or "").strip(),
                    "leagueId": league_id,
                    "link": (article.get("links") or {}).get("web", {}).get("href", ""),
                })
                if len(articles) >= limit:
                    break
        except Exception:
            pass

    return articles


@router.get("/league-support")
def get_league_support() -> dict[str, bool]:
    """Return a mapping of league_id → True/False indicating ESPN news support."""
    return {league_id: entry.has_news for league_id, entry in _REGISTRY.items()}
