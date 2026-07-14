"""MMA-specific headshot cache — on-demand per fighter.

Called from the scoreboard enrichment block whenever a fighter appears
in a fight card and their headshot isn't yet on disk. Downloads happen
in a background thread so the scoreboard response is never delayed.

Output:
  team-meta/{league}.json   athlete_id → TeamLogoInfo (headshot path)
  logos/mma/{league}/       downloaded headshot PNGs
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from datetime import datetime, timezone

from ..paths import get_runtime_paths
from .logo_store import LogoStore, TeamLogoInfo

_ESPN_HEADSHOT_URL = "https://a.espncdn.com/i/headshots/mma/players/full/{id}.png"


def _ssl_ctx() -> ssl.SSLContext:
    return ssl.create_default_context()


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

    def cache_fighter(self, athlete_id: str, league: str = "ufc") -> bool:
        """Download and cache the headshot for a single fighter.

        Returns True if the headshot is now on disk (freshly downloaded or
        already existed), False if ESPN has no image for this fighter.
        """
        logos_dir = self.paths.logos / "mma" / league
        logos_dir.mkdir(parents=True, exist_ok=True)

        dest = logos_dir / f"{athlete_id}_headshot.png"
        if dest.exists():
            return True

        url = _ESPN_HEADSHOT_URL.format(id=athlete_id)
        data = _download_bytes(url)
        # Reject placeholder silhouettes — real headshots are >5 KB
        if not data or len(data) <= 5000:
            return False

        dest.write_bytes(data)

        # Register in meta so the enrichment block finds it next request
        meta = self.store.load_league_meta(league)
        info = meta.teams.get(athlete_id) or TeamLogoInfo(
            id=athlete_id,
            abbreviation="",
            display_name=athlete_id,
        )
        relative = f"mma/{league}/{athlete_id}_headshot.png"
        info.logos["headshot"] = relative
        if "headshot" not in info.available_variants:
            info.available_variants.append("headshot")
        meta.teams[athlete_id] = info
        meta.ts = datetime.now(timezone.utc).isoformat()
        self.store.save_league_meta(meta)
        return True
