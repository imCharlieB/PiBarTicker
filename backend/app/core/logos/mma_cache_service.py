"""MMA-specific headshot cache — on-demand per fighter.

Called from the scoreboard enrichment block whenever a fighter appears
in a fight card and their headshot isn't yet on disk. Downloads happen
in a background thread so the scoreboard response is never delayed.

Output:
  team-meta/{league}.json   athlete_id → TeamLogoInfo (headshot + stats)
  logos/mma/{league}/       downloaded headshot PNGs
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from datetime import datetime, timezone

from ..paths import get_runtime_paths
from .logo_store import LogoStore, TeamLogoInfo

_ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/mma/leagues"
_ESPN_HEADSHOT_URL = "https://a.espncdn.com/i/headshots/mma/players/full/{id}.png"


def _ssl_ctx() -> ssl.SSLContext:
    return ssl.create_default_context()


def _fetch_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _download_bytes(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
            return r.read()
    except Exception:
        return None


class MmaCacheService:
    def __init__(self) -> None:
        self.store = LogoStore()
        self.paths = get_runtime_paths()

    def cache_fighter(
        self,
        athlete_id: str,
        league: str = "ufc",
        *,
        name_hint: str = "",
        record_hint: str = "",
        flag_hint: str = "",
    ) -> bool:
        """Download headshot and fetch fighter details for a single athlete.

        name_hint/record_hint/flag_hint are passed from the scoreboard data
        we already have so we don't need an extra API call for the basics.
        Returns True if the headshot is now on disk.
        """
        logos_dir = self.paths.logos / "mma" / league
        logos_dir.mkdir(parents=True, exist_ok=True)

        meta = self.store.load_league_meta(league)
        existing = meta.teams.get(athlete_id)

        headshot_dest = logos_dir / f"{athlete_id}_headshot.png"
        headshot_exists = headshot_dest.exists()

        # If we already have a real name and headshot, nothing to do
        name_is_placeholder = not existing or existing.display_name == athlete_id
        if headshot_exists and not name_is_placeholder:
            return True

        # Fetch full athlete detail from ESPN core API for extended stats
        detail = _fetch_json(f"{_ESPN_CORE_BASE}/{league}/athletes/{athlete_id}")

        # Resolve name — prefer API, fall back to scoreboard hint
        full_name = ""
        if detail:
            full_name = str(detail.get("fullName") or detail.get("displayName") or "").strip()
        if not full_name:
            full_name = name_hint

        info = existing or TeamLogoInfo(
            id=athlete_id,
            abbreviation="",
            display_name=full_name or athlete_id,
        )
        info.display_name = full_name or info.display_name

        if detail:
            nickname = str(detail.get("nickname") or "").strip()
            if nickname:
                info.remote_urls["nickname"] = nickname

            short_name = str(detail.get("shortName") or "").strip()
            if short_name:
                info.remote_urls["short_name"] = short_name

            weight_class = str((detail.get("weightClass") or {}).get("text") or "").strip()
            if weight_class:
                info.remote_urls["weight_class"] = weight_class

            display_height = str(detail.get("displayHeight") or "").strip()
            if display_height:
                info.remote_urls["height"] = display_height

            display_weight = str(detail.get("displayWeight") or "").strip()
            if display_weight:
                info.remote_urls["weight"] = display_weight

            display_reach = str(detail.get("displayReach") or "").strip()
            if display_reach:
                info.remote_urls["reach"] = display_reach

            stance = str((detail.get("stance") or {}).get("text") or "").strip()
            if stance:
                info.remote_urls["stance"] = stance

            citizenship = str(detail.get("citizenship") or "").strip()
            if citizenship:
                info.remote_urls["citizenship"] = citizenship

            age = detail.get("age")
            if age is not None:
                info.remote_urls["age"] = str(age)

            association = str((detail.get("association") or {}).get("name") or "").strip()
            if association:
                info.remote_urls["association"] = association

            flag_href = str((detail.get("flag") or {}).get("href") or "").strip()
            if flag_href:
                info.remote_urls["flag"] = flag_href
        elif flag_hint:
            info.remote_urls["flag"] = flag_hint

        # Record comes from scoreboard data — store if provided
        if record_hint:
            info.remote_urls["record"] = record_hint

        # Download headshot if not already on disk
        if not headshot_exists:
            hs_url = _ESPN_HEADSHOT_URL.format(id=athlete_id)
            data = _download_bytes(hs_url)
            if data and len(data) > 5000:
                headshot_dest.write_bytes(data)
                headshot_exists = True

        if headshot_exists:
            relative = f"mma/{league}/{athlete_id}_headshot.png"
            info.logos["headshot"] = relative
            if "headshot" not in info.available_variants:
                info.available_variants.append("headshot")

        meta.teams[athlete_id] = info
        meta.ts = datetime.now(timezone.utc).isoformat()
        self.store.save_league_meta(meta)
        return headshot_exists
