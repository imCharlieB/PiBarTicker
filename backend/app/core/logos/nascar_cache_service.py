"""NASCAR-specific data sync service.

Pulls from:
  cf.nascar.com/cacher/drivers.json          (driver roster, car badge images)
  sports.core.api.espn.com                   (athlete IDs + names for ESPN CDN headshots)

Stores per series:
  team-meta/nascar-cup.json      surname → TeamLogoInfo
  team-meta/nascar-xfinity.json  surname → TeamLogoInfo
  team-meta/nascar-trucks.json   surname → TeamLogoInfo
  team-meta/nascar-series.json   league_id → series logo local path
  logos/nascar/cup/              Cup badges + headshots
  logos/nascar/xfinity/          Xfinity badges + headshots
  logos/nascar/trucks/           Trucks badges + headshots
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..paths import get_runtime_paths
from .logo_store import LogoStore, TeamLogoInfo

_DRIVERS_URL = "https://cf.nascar.com/cacher/drivers.json"

# ESPN core API — correct slugs discovered via leagues endpoint
# nascar-secondary = Xfinity series (not nascar-xfinity)
_ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/racing/leagues"

# (espn_core_slug, cache_league_id, subfolder_name)
_ESPN_CORE_SERIES: list[tuple[str, str, str]] = [
    ("nascar-premier", "nascar-cup", "cup"),
    ("nascar-secondary", "nascar-xfinity", "xfinity"),
    ("nascar-truck", "nascar-trucks", "trucks"),
]

# NASCAR headshots use /rpm/ not /racing/ on ESPN CDN
_ESPN_HEADSHOT_URL = "https://a.espncdn.com/i/headshots/rpm/players/full/{id}.png"

# Driver_Series string (from cacher/drivers.json) → cf/common cache league ID.
# Uses substring matching — order matters (longer/more-specific first)
_SERIES_SLUG_MAP: dict[str, str] = {
    "nascar-cup-series": "nascar-cup",
    "cup-series": "nascar-cup",
    "nascar-xfinity-series": "nascar-xfinity",
    "nascar-oreilly-auto-parts-series": "nascar-xfinity",
    "oreilly-auto-parts": "nascar-xfinity",
    "xfinity": "nascar-xfinity",
    "nascar-craftsman-truck-series": "nascar-trucks",
    "craftsman-truck": "nascar-trucks",
    # bare substrings last — they match inside longer names above
    "cup": "nascar-cup",
    "truck": "nascar-trucks",
}

# ESPN API slugs (from config.json) → cf cache league IDs.
# ESPN calls Cup "nascar-premier" and Trucks "nascar-truck"; we store using cf names.
ESPN_TO_CACHE_ID: dict[str, str] = {
    "nascar-premier": "nascar-cup",
    "nascar-secondary": "nascar-xfinity",
    "nascar-truck": "nascar-trucks",
}

# cache_league_id → subfolder name under logos/nascar/
_SERIES_SUBFOLDER: dict[str, str] = {
    "nascar-cup": "cup",
    "nascar-xfinity": "xfinity",
    "nascar-trucks": "trucks",
}

# Known manufacturer logo URL substrings → display name
_MANUFACTURER_NAMES: dict[str, str] = {
    "chevrolet": "Chevrolet",
    "ford": "Ford",
    "toyota": "Toyota",
}


def _dominant_badge_color(path: Path) -> str:
    """Extract dominant non-background hex color from a car badge PNG.

    Badge images have a transparent (or white) background; the badge itself
    is the team's primary color. We filter out near-transparent, near-white,
    and near-black pixels then quantize to find the most common color.
    """
    try:
        from PIL import Image  # type: ignore
        _lanczos = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
        img = Image.open(path).convert("RGBA").resize((64, 64), _lanczos)
        pixels = [
            (r, g, b)
            for r, g, b, a in img.getdata()
            if a > 100
            and not (r > 220 and g > 220 and b > 220)
            and (r + g + b) > 60
        ]
        if len(pixels) < 20:
            return ""
        canvas = Image.new("RGB", (len(pixels), 1))
        canvas.putdata(pixels)
        q = canvas.quantize(colors=6)
        counts: dict[int, int] = {}
        for idx in q.getdata():
            counts[idx] = counts.get(idx, 0) + 1
        pal = q.getpalette() or []
        best = max(counts, key=counts.get)
        r, g, b = pal[best * 3], pal[best * 3 + 1], pal[best * 3 + 2]
        return f"{r:02x}{g:02x}{b:02x}"
    except Exception:
        return ""


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
        print(f"[nascar-cache] Download failed {url}: {exc}")
        return None


def _series_league_id(driver_series_str: str) -> str | None:
    s = str(driver_series_str or "").lower()
    for key, league_id in _SERIES_SLUG_MAP.items():
        if key in s:
            return league_id
    return None


def _build_espn_athlete_map() -> dict[str, str]:
    """Build surname_lower → espn_athlete_id map for all NASCAR series.

    Uses the ESPN core API seasons/athletes pagination to collect IDs,
    then resolves each athlete in parallel to get display names.
    """
    athlete_map: dict[str, str] = {}
    current_season = datetime.now(timezone.utc).year

    for espn_slug, _cache_id, _subfolder in _ESPN_CORE_SERIES:
        # Collect all athlete IDs from paginated $ref list
        ids: list[str] = []
        page = 1
        while True:
            try:
                url = f"{_ESPN_CORE_BASE}/{espn_slug}/seasons/{current_season}/athletes?limit=100&page={page}"
                data = _fetch_json(url)
                for item in data.get("items") or []:
                    ref = str(item.get("$ref") or "")
                    m = re.search(r"/athletes/(\d+)", ref)
                    if m:
                        ids.append(m.group(1))
                page_count = int(data.get("pageCount") or 1)
                if page >= page_count:
                    break
                page += 1
            except Exception as exc:
                print(f"[nascar-cache] Athletes list failed {espn_slug} page {page}: {exc}")
                break

        # Resolve athlete names in parallel (max 8 concurrent requests)
        def _fetch_athlete_name(athlete_id: str, slug: str = espn_slug) -> tuple[str, str] | None:
            try:
                url = f"{_ESPN_CORE_BASE}/{slug}/athletes/{athlete_id}"
                data = _fetch_json(url)
                name = str(data.get("fullName") or data.get("displayName") or "").strip()
                if name and athlete_id:
                    surname = name.split()[-1].lower()
                    return (surname, athlete_id)
            except Exception:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = executor.map(_fetch_athlete_name, ids)
            for result in results:
                if result:
                    surname, aid = result
                    if surname not in athlete_map:
                        athlete_map[surname] = aid

    return athlete_map


class NascarCacheService:
    def __init__(self) -> None:
        self.store = LogoStore()
        self.paths = get_runtime_paths()

    def sync_drivers(self) -> dict:
        """Fetch NASCAR driver roster, download badges + headshots, save per-series meta."""
        try:
            data = _fetch_json(_DRIVERS_URL)
        except Exception as exc:
            return {"ok": False, "error": f"Failed to fetch drivers.json: {exc}"}

        drivers_list = data if isinstance(data, list) else data.get("response") or data.get("drivers") or []
        if not isinstance(drivers_list, list):
            return {"ok": False, "error": "Unexpected response shape from drivers.json"}

        # Only published drivers have real images
        drivers_list = [d for d in drivers_list if d.get("Driver_Post_Status") == "publish"]

        espn_athlete_map = _build_espn_athlete_map()

        logos_dir = self.paths.logos / "nascar"
        logos_dir.mkdir(parents=True, exist_ok=True)

        # Create per-series subfolders
        for subfolder in ("cup", "xfinity", "trucks"):
            (logos_dir / subfolder).mkdir(exist_ok=True)

        # Load existing series logo map
        series_logos: dict[str, str] = {}
        try:
            series_meta_path = self.paths.team_meta / "nascar-series.json"
            existing: dict = json.loads(series_meta_path.read_text(encoding="utf-8"))
            series_logos = {k: v for k, v in existing.items() if k != "_ts"}
        except Exception:
            pass

        # Group drivers by their ESPN league ID
        by_league: dict[str, list[dict]] = {}
        for driver in drivers_list:
            if not isinstance(driver, dict):
                continue
            series_str = str(driver.get("Driver_Series") or "").strip()
            league_id = _series_league_id(series_str)
            if not league_id:
                continue
            by_league.setdefault(league_id, []).append(driver)

            # Capture series logo
            series_logo_url = str(driver.get("Series_Logo") or "").strip()
            if series_logo_url and league_id not in series_logos:
                series_logos[league_id] = series_logo_url

        total_saved = 0
        badges_downloaded = 0
        headshots_downloaded = 0
        series_counts: dict[str, int] = {}

        for league_id, league_drivers in by_league.items():
            subfolder = _SERIES_SUBFOLDER.get(league_id, "")
            series_logos_dir = logos_dir / subfolder if subfolder else logos_dir

            meta = self.store.load_league_meta(league_id)
            meta.ts = datetime.now(timezone.utc).isoformat()

            for driver in league_drivers:
                nascar_id = str(driver.get("Nascar_Driver_ID") or "").strip()
                first = str(driver.get("First_Name") or "").strip()
                last = str(driver.get("Last_Name") or "").strip()
                full_name = str(driver.get("Full_Name") or f"{first} {last}").strip()
                if not full_name or not nascar_id:
                    continue

                surname_key = last.lower() if last else full_name.split()[-1].lower()

                badge_num = str(driver.get("Badge") or "").strip()
                badge_image_url = str(driver.get("Badge_Image") or "").strip()
                series_str = str(driver.get("Driver_Series") or "").strip()
                team_name = str(driver.get("Team") or "").strip()
                manufacturer_raw = str(driver.get("Manufacturer") or "").strip()

                # Extract text name from manufacturer logo URL
                manufacturer_name = ""
                if manufacturer_raw.startswith("http"):
                    url_lower = manufacturer_raw.lower()
                    for key, name in _MANUFACTURER_NAMES.items():
                        if key in url_lower:
                            manufacturer_name = name
                            break
                else:
                    manufacturer_name = manufacturer_raw

                info = meta.teams.get(surname_key) or TeamLogoInfo(
                    id=nascar_id,
                    abbreviation="",
                    display_name=full_name,
                )
                info.display_name = full_name
                info.remote_urls["nascar_driver_id"] = nascar_id
                if team_name:
                    info.remote_urls["team_name"] = team_name
                if badge_num:
                    info.remote_urls["car_number"] = badge_num
                if badge_image_url:
                    info.remote_urls["badge_image"] = badge_image_url
                if series_str:
                    info.remote_urls["driver_series"] = series_str
                if manufacturer_name:
                    info.remote_urls["manufacturer"] = manufacturer_name

                # Download car badge into per-series subfolder
                if badge_image_url:
                    ext = badge_image_url.rsplit(".", 1)[-1].lower() or "png"
                    badge_filename = f"{surname_key}_{nascar_id}_badge.{ext}"
                    badge_dest = series_logos_dir / badge_filename
                    if not badge_dest.exists():
                        badge_data = _download_bytes(badge_image_url)
                        if badge_data:
                            badge_dest.write_bytes(badge_data)
                            badges_downloaded += 1
                    if badge_dest.exists():
                        relative = f"nascar/{subfolder}/{badge_filename}" if subfolder else f"nascar/{badge_filename}"
                        info.logos["badge"] = relative
                        if "badge" not in info.available_variants:
                            info.available_variants.append("badge")
                        if not info.color:
                            color = _dominant_badge_color(badge_dest)
                            if color:
                                info.color = color

                # Download ESPN CDN headshot into per-series subfolder
                espn_id = espn_athlete_map.get(surname_key)
                if espn_id:
                    info.remote_urls["espn_athlete_id"] = espn_id
                    headshot_url = _ESPN_HEADSHOT_URL.format(id=espn_id)
                    headshot_filename = f"{surname_key}_{nascar_id}_headshot.png"
                    headshot_dest = series_logos_dir / headshot_filename
                    if not headshot_dest.exists():
                        hs_data = _download_bytes(headshot_url)
                        if hs_data and len(hs_data) > 1000:
                            headshot_dest.write_bytes(hs_data)
                            headshots_downloaded += 1
                    if headshot_dest.exists():
                        relative = f"nascar/{subfolder}/{headshot_filename}" if subfolder else f"nascar/{headshot_filename}"
                        info.logos["headshot"] = relative
                        if "headshot" not in info.available_variants:
                            info.available_variants.append("headshot")

                meta.teams[surname_key] = info
                total_saved += 1

            self.store.save_league_meta(meta)
            series_counts[league_id] = len(league_drivers)

        # Download series logos locally and replace remote URLs with local paths
        series_logos_downloaded = 0
        resolved_series_logos: dict[str, str] = {}
        for lid, logo_url in series_logos.items():
            if not logo_url or not logo_url.startswith("http"):
                resolved_series_logos[lid] = logo_url
                continue
            ext = logo_url.rsplit(".", 1)[-1].lower().split("?")[0] or "png"
            if ext not in ("png", "jpg", "jpeg", "svg", "webp", "gif"):
                ext = "png"
            series_filename = f"series_{lid}.{ext}"
            series_dest = logos_dir / series_filename
            if not series_dest.exists():
                logo_data = _download_bytes(logo_url)
                if logo_data:
                    series_dest.write_bytes(logo_data)
                    series_logos_downloaded += 1
            if series_dest.exists():
                resolved_series_logos[lid] = f"nascar/{series_filename}"
            else:
                resolved_series_logos[lid] = logo_url  # keep URL as fallback

        resolved_series_logos["_ts"] = datetime.now(timezone.utc).isoformat()
        series_meta_path = self.paths.team_meta / "nascar-series.json"
        series_meta_path.write_text(json.dumps(resolved_series_logos, indent=2), encoding="utf-8")

        return {
            "ok": True,
            "drivers_synced": total_saved,
            "badges_downloaded": badges_downloaded,
            "headshots_downloaded": headshots_downloaded,
            "series_logos_downloaded": series_logos_downloaded,
            "by_series": series_counts,
            "series_logos_found": len(resolved_series_logos) - 1,
        }

    def sync_all(self) -> dict:
        drivers = self.sync_drivers()
        return {"ok": drivers["ok"], "drivers": drivers}
