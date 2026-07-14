"""MMA-specific athlete sync service.

Pulls the current fighter roster from ESPN's core API and downloads
headshots. Supports UFC and any other MMA league ESPN tracks.

Output:
  team-meta/{league}.json   athlete_id → TeamLogoInfo (headshot path)
  logos/mma/{league}/       downloaded headshot PNGs
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from typing import Any

from ..paths import get_runtime_paths
from .logo_store import LogoStore, TeamLogoInfo

_ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/mma/leagues"
_ESPN_HEADSHOT_URL = "https://a.espncdn.com/i/headshots/mma/players/full/{id}.png"


def _ssl_ctx() -> ssl.SSLContext:
    return ssl.create_default_context()


def _fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def _download_bytes(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
            return r.read()
    except Exception as exc:
        print(f"[mma-cache] Download failed {url}: {exc}")
        return None


class MmaCacheService:
    def __init__(self) -> None:
        self.store = LogoStore()
        self.paths = get_runtime_paths()

    def sync_fighters(self, league: str = "ufc") -> dict:
        """Fetch MMA fighter roster and download headshots from ESPN CDN."""
        current_season = datetime.now(timezone.utc).year

        # Collect all athlete IDs from paginated $ref list
        ids: list[str] = []
        page = 1
        while True:
            try:
                url = f"{_ESPN_CORE_BASE}/{league}/seasons/{current_season}/athletes?limit=100&page={page}"
                data = _fetch_json(url)
                for item in data.get("items") or []:
                    ref = str(item.get("$ref") or "")
                    m = re.search(r"/athletes/(\d+)", ref)
                    if m:
                        ids.append(m.group(1))
                if page >= int(data.get("pageCount") or 1):
                    break
                page += 1
            except Exception as exc:
                print(f"[mma-cache] Athletes list failed {league} page {page}: {exc}")
                break

        if not ids:
            return {"ok": False, "error": f"No athletes found for {league} season {current_season}"}

        # Resolve athlete names + flag URLs in parallel
        def _fetch_athlete(athlete_id: str) -> dict | None:
            try:
                data = _fetch_json(f"{_ESPN_CORE_BASE}/{league}/athletes/{athlete_id}")
                name = str(data.get("fullName") or data.get("displayName") or "").strip()
                short_name = str(data.get("shortName") or "").strip()
                flag_href = str((data.get("flag") or {}).get("href") or "").strip()
                headshot_href = str(data.get("headshot") or "").strip()
                if name and athlete_id:
                    return {
                        "id": athlete_id,
                        "name": name,
                        "short_name": short_name,
                        "flag_href": flag_href,
                        "headshot_href": headshot_href,
                    }
            except Exception:
                pass
            return None

        athletes: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            for result in executor.map(_fetch_athlete, ids):
                if result:
                    athletes.append(result)

        logos_dir = self.paths.logos / "mma" / league
        logos_dir.mkdir(parents=True, exist_ok=True)

        meta = self.store.load_league_meta(league)
        meta.ts = datetime.now(timezone.utc).isoformat()

        headshots_downloaded = 0
        headshots_skipped = 0

        for athlete in athletes:
            athlete_id = athlete["id"]
            name = athlete["name"]
            short_name = athlete["short_name"]

            info = meta.teams.get(athlete_id) or TeamLogoInfo(
                id=athlete_id,
                abbreviation="",
                display_name=name,
            )
            info.display_name = name
            if short_name:
                info.remote_urls["short_name"] = short_name
            if athlete["flag_href"]:
                info.remote_urls["flag"] = athlete["flag_href"]

            # Build headshot URL: prefer ESPN field on athlete object, else construct from ID
            headshot_url = athlete["headshot_href"] or _ESPN_HEADSHOT_URL.format(id=athlete_id)
            info.remote_urls["headshot_url"] = headshot_url

            headshot_filename = f"{athlete_id}_headshot.png"
            headshot_dest = logos_dir / headshot_filename

            if not headshot_dest.exists():
                hs_data = _download_bytes(headshot_url)
                # Reject placeholder silhouettes (real headshots are typically >5KB)
                if hs_data and len(hs_data) > 5000:
                    headshot_dest.write_bytes(hs_data)
                    headshots_downloaded += 1
                else:
                    headshots_skipped += 1
            else:
                headshots_skipped += 1

            if headshot_dest.exists():
                relative = f"mma/{league}/{headshot_filename}"
                info.logos["headshot"] = relative
                if "headshot" not in info.available_variants:
                    info.available_variants.append("headshot")

            meta.teams[athlete_id] = info

        self.store.save_league_meta(meta)
        return {
            "ok": True,
            "league": league,
            "fighters_synced": len(athletes),
            "headshots_downloaded": headshots_downloaded,
            "headshots_already_cached": headshots_skipped,
        }

    def sync_all(self, league: str = "ufc") -> dict:
        return self.sync_fighters(league)
