"""F1-specific data sync service.

Pulls from two sources:
  - livetiming.formula1.com/static  (driver list, team colours, headshots)
  - media.formula1.com Cloudinary CDN (team car renders, circuit maps)

Stores everything in the existing logo-store format so the rest of the app
(scoreboard enrichment, setup UI) can treat F1 assets identically to ESPN ones.

Output files:
  team-meta/f1-drivers.json   driver surname → TeamLogoInfo (colour + headshot)
  team-meta/f1.json           updated in-place with car-image variant per team
  team-meta/f1-circuits.json  simple dict: circuit_key → local PNG path
  logos/f1/                   all downloaded image files
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import ssl
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from ..paths import get_runtime_paths
from .logo_store import LeagueTeamMeta, LogoStore, TeamLogoInfo

# ---------------------------------------------------------------------------
# Static mappings — stable within a season
# ---------------------------------------------------------------------------

# F1 constructor display_name substring → Cloudinary team slug
_TEAM_SLUG_MAP: dict[str, str] = {
    "alpine": "alpine",
    "aston martin": "astonmartin",
    "ferrari": "ferrari",
    "haas": "haasf1team",
    "mclaren": "mclaren",
    "mercedes": "mercedes",
    "racing bulls": "racingbulls",
    "red bull": "redbullracing",
    "williams": "williams",
    "kick sauber": "kicksauber",
    "sauber": "kicksauber",
    "audi": "audi",
    "cadillac": "cadillac",
}

# Country name overrides for circuit map filenames (F1 CDN uses non-obvious names)
_COUNTRY_MAP_OVERRIDES: dict[str, str] = {
    "united kingdom": "Great_Britain",
    "great britain": "Great_Britain",
    "united states": "United_States",
    "usa": "United_States",
    "saudi arabia": "Saudi_Arabia",
    "abu dhabi": "Abu_Dhabi",
    "las vegas": "Las_Vegas",
}


_F1_STATIC_BASE = "https://livetiming.formula1.com/static"
_F1_CDN_BASE = "https://media.formula1.com"
_CAR_URL_TEMPLATE = (
    "{cdn}/image/upload/c_lfill,h_224/q_auto"
    "/d_common:f1:2026:fallback:car:2026fallbackcarright.webp"
    "/v1740000001/common/f1/2026/{slug}/2026{slug}carright.webp"
)
_CIRCUIT_URL_TEMPLATE = (
    "{cdn}/image/upload/content/dam/fom-website"
    "/2018-redesign-assets/Circuit%20maps%2016x9/{name}_Circuit.png"
)

# ESPN CDN fallback for F1 headshots — covers drivers where F1's own CDN returns placeholders
_ESPN_CORE_F1_BASE = "https://sports.core.api.espn.com/v2/sports/racing/leagues/f1"
_ESPN_F1_HEADSHOT_URL = "https://a.espncdn.com/i/headshots/f1/players/full/{id}.png"

# F1 profile headshot — used when both DriverList CDN and ESPN CDN return placeholders/404s
# driver_code extracted from HeadshotUrl (e.g. "gabbor01" from .../GABBOR01_.../gabbor01.png)
_F1_PROFILE_HEADSHOT_TEMPLATE = (
    "{cdn}/image/upload/c_fill,w_720/q_auto"
    "/v1740000001/common/f1/2026/{team_slug}/{driver_code}/2026{team_slug}{driver_code}right.webp"
)


def _ssl_ctx() -> ssl.SSLContext:
    return ssl.create_default_context()


def _fetch_json(url: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BestHTTP", "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def _download_bytes(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=15) as r:
            return r.read()
    except Exception as exc:
        print(f"[f1-cache] Download failed {url}: {exc}")
        return None


def _slug_for_team(display_name: str) -> str | None:
    name_lower = display_name.lower()
    for key, slug in _TEAM_SLUG_MAP.items():
        if key in name_lower:
            return slug
    return None


def _circuit_map_name(country_name: str, location: str) -> str:
    """Return the F1 CDN filename stem for a circuit map, e.g. 'Great_Britain'."""
    lower = country_name.lower()
    if lower in _COUNTRY_MAP_OVERRIDES:
        return _COUNTRY_MAP_OVERRIDES[lower]
    # Default: capitalise and replace spaces with underscores
    return country_name.replace(" ", "_").title()


def _ascii_surname(full_name: str) -> str:
    """Extract surname, strip accents/umlauts, return lowercase ASCII.

    Normalizes 'Pérez' → 'perez', 'Hülkenberg' → 'hulkenberg' so ESPN
    accented names match the unaccented keys in f1-drivers.json.
    """
    surname = full_name.split()[-1] if full_name else ""
    normalized = unicodedata.normalize("NFKD", surname)
    return normalized.encode("ascii", "ignore").decode().lower()


def _build_espn_f1_athlete_map() -> dict[str, str]:
    """Build ascii_surname → espn_athlete_id for all current F1 drivers.

    Uses ESPN core API seasons/athletes pagination, resolves names in parallel.
    """
    athlete_map: dict[str, str] = {}
    current_season = datetime.now(timezone.utc).year

    ids: list[str] = []
    page = 1
    while True:
        try:
            url = f"{_ESPN_CORE_F1_BASE}/seasons/{current_season}/athletes?limit=100&page={page}"
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
            print(f"[f1-cache] ESPN athletes list failed page {page}: {exc}")
            break

    def _fetch_athlete(athlete_id: str) -> tuple[str, str] | None:
        try:
            data = _fetch_json(f"{_ESPN_CORE_F1_BASE}/athletes/{athlete_id}")
            name = str(data.get("fullName") or data.get("displayName") or "").strip()
            if name and athlete_id:
                return (_ascii_surname(name), athlete_id)
        except Exception:
            pass
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for result in executor.map(_fetch_athlete, ids):
            if result:
                surname, aid = result
                if surname not in athlete_map:
                    athlete_map[surname] = aid

    return athlete_map


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------

class F1CacheService:
    def __init__(self) -> None:
        self.store = LogoStore()
        self.paths = get_runtime_paths()
        self._http = httpx.Client(timeout=15.0, follow_redirects=True)

    # -----------------------------------------------------------------------
    # F1 static index helpers
    # -----------------------------------------------------------------------

    def _get_season_index(self, year: int = 2026) -> dict:
        return _fetch_json(f"{_F1_STATIC_BASE}/{year}/Index.json")

    def _latest_race_path(self, year: int = 2026) -> str | None:
        """Return path of the most recently completed Race session."""
        try:
            index = self._get_season_index(year)
        except Exception as exc:
            print(f"[f1-cache] Failed to fetch season index: {exc}")
            return None

        now = datetime.now(timezone.utc)
        latest_path: str | None = None
        latest_ts: datetime | None = None

        for meeting in index.get("Meetings") or []:
            for session in meeting.get("Sessions") or []:
                if session.get("Type") != "Race":
                    continue
                path = session.get("Path")
                if not path:
                    continue
                start_str = str(session.get("StartDate") or "").strip()
                gmt_str = str(session.get("GmtOffset") or "00:00:00").strip()
                try:
                    naive = datetime.fromisoformat(start_str)
                    # parse GMT offset (+HH:MM:SS)
                    sign = 1
                    gmt = gmt_str
                    if gmt.startswith("-"):
                        sign = -1
                        gmt = gmt[1:]
                    parts = gmt.split(":")
                    offset_h, offset_m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
                    from datetime import timedelta, timezone as tz
                    offset = tz(sign * timedelta(hours=offset_h, minutes=offset_m))
                    aware = naive.replace(tzinfo=offset).astimezone(timezone.utc)
                except Exception:
                    continue

                if aware < now and (latest_ts is None or aware > latest_ts):
                    latest_ts = aware
                    latest_path = path

        return latest_path

    def _meeting_circuits(self, year: int = 2026) -> list[dict]:
        """Return list of {country, location, circuit_short_name} for all race meetings."""
        try:
            index = self._get_season_index(year)
        except Exception:
            return []

        results = []
        for meeting in index.get("Meetings") or []:
            country = (meeting.get("Country") or {}).get("Name", "")
            location = meeting.get("Location", "")
            circuit_short = (meeting.get("Circuit") or {}).get("ShortName", "")
            has_race = any(s.get("Type") == "Race" for s in meeting.get("Sessions") or [])
            if has_race:
                results.append({
                    "country": country,
                    "location": location,
                    "circuit_short": circuit_short,
                })
        return results

    # -----------------------------------------------------------------------
    # Sync: drivers (headshots + team colours)
    # -----------------------------------------------------------------------

    def sync_drivers(self, year: int = 2026) -> dict:
        path = self._latest_race_path(year)
        if not path:
            return {"ok": False, "error": "No completed race session found in index"}

        try:
            driver_list: dict = _fetch_json(f"{_F1_STATIC_BASE}/{path}DriverList.json")
        except Exception as exc:
            return {"ok": False, "error": f"Failed to fetch DriverList: {exc}"}

        meta = self.store.load_league_meta("f1-drivers")
        meta.ts = datetime.now(timezone.utc).isoformat()

        logos_dir = self.paths.logos / "f1"
        logos_dir.mkdir(parents=True, exist_ok=True)

        espn_athlete_map = _build_espn_f1_athlete_map()

        saved = 0
        for _car_number, driver in driver_list.items():
            if not isinstance(driver, dict):
                continue

            full_name = " ".join(w.title() for w in str(driver.get("FullName") or "").strip().split())
            tla = str(driver.get("Tla") or "").strip().upper()
            if not full_name or not tla:
                continue

            # Key by lowercase surname for ESPN join at scoreboard time
            parts = full_name.split()
            surname = parts[-1].lower() if parts else ""
            if not surname:
                continue

            team_colour = str(driver.get("TeamColour") or "").strip()
            team_name = str(driver.get("TeamName") or "").strip()
            headshot_url = str(driver.get("HeadshotUrl") or "").strip()

            info = meta.teams.get(surname) or TeamLogoInfo(
                id=surname,
                abbreviation=tla,
                display_name=full_name,
            )
            info.abbreviation = tla
            info.display_name = full_name
            if team_colour:
                info.color = team_colour
            if team_name:
                info.remote_urls["team_name"] = team_name

            # Full-body render — downloaded first so headshot fallback can reference it
            # common/f1/2026/{team_slug}/{driver_code}/2026{team_slug}{driver_code}right.webp
            team_slug = _slug_for_team(team_name)
            driver_code: str | None = None
            if headshot_url:
                m = re.search(r"/([a-z0-9]+)\.png", headshot_url, re.IGNORECASE)
                if m:
                    driver_code = m.group(1).lower()
            if team_slug and driver_code:
                render_filename = f"{tla}-{surname}_render.webp"
                render_dest = logos_dir / render_filename
                if not render_dest.exists():
                    render_url = _F1_PROFILE_HEADSHOT_TEMPLATE.format(
                        cdn=_F1_CDN_BASE, team_slug=team_slug, driver_code=driver_code
                    )
                    info.remote_urls["f1_render"] = render_url
                    render_data = _download_bytes(render_url)
                    if render_data and len(render_data) > 5000:
                        render_dest.write_bytes(render_data)
                if render_dest.exists():
                    info.logos["render"] = f"f1/{render_filename}"
                    if "render" not in info.available_variants:
                        info.available_variants.append("render")

            # Download headshot — priority: F1 DriverList CDN (6col) → ESPN CDN → render fallback
            # DriverList.json HeadshotUrl uses 1col (~4-5KB thumbnail or fallback silhouette).
            # We upgrade to 6col which gives real headshots at ~100-240KB; fallback silhouettes
            # stay tiny (<10KB) at 6col, so a 50KB threshold separates real images from placeholders.
            dest_filename = self.store.get_logo_filename(tla, surname, "headshot")
            dest = logos_dir / dest_filename

            # Delete small thumbnails (1col artifacts, ~12KB) and placeholders (<5KB)
            if dest.exists() and dest.stat().st_size < 50_000:
                dest.unlink()

            # 1. F1 DriverList CDN at 6col — real headshots for all drivers who have them
            if not dest.exists() and headshot_url:
                info.remote_urls["headshot"] = headshot_url
                url_6col = headshot_url.replace(".transform/1col/image.png", ".transform/6col/image.png")
                data = _download_bytes(url_6col)
                if data and len(data) > 50_000:
                    dest.write_bytes(data)

            # 2. ESPN CDN fallback — covers drivers not yet on F1's 2026 CDN
            if not dest.exists():
                espn_id = espn_athlete_map.get(surname)
                if espn_id:
                    info.remote_urls["espn_athlete_id"] = espn_id
                    espn_url = _ESPN_F1_HEADSHOT_URL.format(id=espn_id)
                    espn_data = _download_bytes(espn_url)
                    if espn_data and len(espn_data) > 5000:
                        dest.write_bytes(espn_data)

            if dest.exists():
                relative = f"f1/{dest_filename}"
                info.logos["headshot"] = relative
                if "headshot" not in info.available_variants:
                    info.available_variants.append("headshot")
            else:
                info.logos.pop("headshot", None)
                if "headshot" in info.available_variants:
                    info.available_variants.remove("headshot")

            meta.teams[surname] = info
            saved += 1

        self.store.save_league_meta(meta)
        return {"ok": True, "drivers_synced": saved, "session_path": path}

    # -----------------------------------------------------------------------
    # Sync: team car images
    # -----------------------------------------------------------------------

    def sync_team_cars(self) -> dict:
        logos_dir = self.paths.logos / "f1"
        logos_dir.mkdir(parents=True, exist_ok=True)

        # Download every known constructor slug independently — works on a fresh
        # install even before the standard ESPN "Sync Teams & Logos" has run.
        all_slugs = set(_TEAM_SLUG_MAP.values())
        synced = 0
        for slug in sorted(all_slugs):
            car_url = _CAR_URL_TEMPLATE.format(cdn=_F1_CDN_BASE, slug=slug)
            dest = logos_dir / f"{slug}_car.webp"
            if not dest.exists():
                data = _download_bytes(car_url)
                if data:
                    dest.write_bytes(data)
            if dest.exists():
                synced += 1

        # Update f1.json team meta with car variant; create entries for teams ESPN has but without logos.
        # Keyed by ESPN team ID so getCachedOrRemoteLogo(leagueId, team) resolves correctly.
        # ESPN IDs confirmed from site.api.espn.com/apis/site/v2/sports/racing/f1/teams
        _ESPNID_STUB: dict[str, str] = {
            "132212": "audi",       # Audi (formerly Kick Sauber)
            "132211": "cadillac",   # Cadillac (11th team, 2026)
        }
        _DISPLAY_NAMES: dict[str, str] = {
            "132212": "Audi",
            "132211": "Cadillac",
        }
        try:
            f1_meta = self.store.load_league_meta("f1")
            changed = False

            # Register car on existing ESPN teams
            for team in f1_meta.teams.values():
                slug = _slug_for_team(team.display_name)
                if not slug:
                    continue
                dest = logos_dir / f"{slug}_car.webp"
                team.remote_urls["car"] = _CAR_URL_TEMPLATE.format(cdn=_F1_CDN_BASE, slug=slug)
                if dest.exists():
                    team.logos["car"] = f"f1/{slug}_car.webp"
                    if "car" not in team.available_variants:
                        team.available_variants.append("car")
                    changed = True

            # Create stub entries for constructors ESPN knows but whose logos need local resolution
            for espn_id, slug in _ESPNID_STUB.items():
                dest = logos_dir / f"{slug}_car.webp"
                if not dest.exists():
                    continue
                entry = f1_meta.teams.get(espn_id)
                if entry is None:
                    entry = TeamLogoInfo(
                        id=espn_id,
                        abbreviation="",
                        display_name=_DISPLAY_NAMES[espn_id],
                    )
                    f1_meta.teams[espn_id] = entry
                entry.logos["car"] = f"f1/{slug}_car.webp"
                entry.remote_urls["car"] = _CAR_URL_TEMPLATE.format(cdn=_F1_CDN_BASE, slug=slug)
                if "car" not in entry.available_variants:
                    entry.available_variants.append("car")
                changed = True

            # Remove any stale slug-keyed stubs left from a prior run
            for stale_key in ("audi", "cadillac"):
                if stale_key in f1_meta.teams:
                    del f1_meta.teams[stale_key]
                    changed = True

            if changed:
                self.store.save_league_meta(f1_meta)
        except Exception:
            pass

        return {"ok": True, "teams_synced": synced}

    # -----------------------------------------------------------------------
    # Sync: circuit maps
    # -----------------------------------------------------------------------

    def sync_circuit_maps(self, year: int = 2026) -> dict:
        circuits_dir = self.paths.logos / "f1" / "circuits"
        circuits_dir.mkdir(parents=True, exist_ok=True)

        circuit_meta_path = self.paths.team_meta / "f1-circuits.json"
        try:
            existing: dict = json.loads(circuit_meta_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

        meetings = self._meeting_circuits(year)
        synced = 0

        for m in meetings:
            country = m["country"]
            location = m["location"]
            circuit_short = m.get("circuit_short", "")
            map_name = _circuit_map_name(country, location)

            # CDN candidates: Circuit.ShortName first, then country-derived, then location slug
            candidates: list[str] = []
            if circuit_short:
                candidates.append(circuit_short.replace(" ", "_"))
            if map_name not in candidates:
                candidates.append(map_name)
            location_slug = location.replace(" ", "_").title()
            if location_slug not in candidates:
                candidates.append(location_slug)

            circuit_name = circuit_short or location
            used_name = map_name
            dest = circuits_dir / f"{map_name}_Circuit.png"

            # Reuse existing file under any candidate name
            if not dest.exists():
                for candidate in candidates:
                    alt = circuits_dir / f"{candidate}_Circuit.png"
                    if alt.exists():
                        dest = alt
                        used_name = candidate
                        break

            # Download if still missing (always retry circuits with empty path sentinel)
            prev_path = (existing.get(map_name) or {}).get("path", None)
            if not dest.exists() or prev_path == "":
                for candidate in candidates:
                    url = _CIRCUIT_URL_TEMPLATE.format(cdn=_F1_CDN_BASE, name=candidate)
                    data = _download_bytes(url)
                    if data:
                        used_name = candidate
                        dest = circuits_dir / f"{used_name}_Circuit.png"
                        dest.write_bytes(data)
                        break

            if dest.exists():
                existing[map_name] = {
                    "path": f"f1/circuits/{used_name}_Circuit.png",
                    "location": location,
                    "country": country,
                    "circuit_name": circuit_name,
                }
                synced += 1
            else:
                print(f"[f1-cache] No circuit map for {country} / {circuit_name} — tried: {candidates}")
                existing[map_name] = {
                    "path": "",
                    "location": location,
                    "country": country,
                    "circuit_name": circuit_name,
                }

        existing["_ts"] = datetime.now(timezone.utc).isoformat()
        circuit_meta_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        return {"ok": True, "circuits_synced": synced}

    # -----------------------------------------------------------------------
    # Full sync
    # -----------------------------------------------------------------------

    def sync_all(self, year: int = 2026) -> dict:
        drivers = self.sync_drivers(year)
        cars = self.sync_team_cars()
        circuits = self.sync_circuit_maps(year)
        return {
            "ok": drivers["ok"],
            "drivers": drivers,
            "team_cars": cars,
            "circuits": circuits,
        }

    def close(self) -> None:
        self._http.close()
