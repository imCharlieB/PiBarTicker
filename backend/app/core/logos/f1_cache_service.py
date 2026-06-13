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

import json
import ssl
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

            # Download headshot
            if headshot_url:
                info.remote_urls["headshot"] = headshot_url
                dest_filename = self.store.get_logo_filename(tla, surname, "headshot")
                dest = logos_dir / dest_filename
                if not dest.exists():
                    data = _download_bytes(headshot_url)
                    if data:
                        dest.write_bytes(data)
                relative = f"f1/{dest_filename}"
                info.logos["headshot"] = relative
                if "headshot" not in info.available_variants:
                    info.available_variants.append("headshot")

            meta.teams[surname] = info
            saved += 1

        self.store.save_league_meta(meta)
        return {"ok": True, "drivers_synced": saved, "session_path": path}

    # -----------------------------------------------------------------------
    # Sync: team car images
    # -----------------------------------------------------------------------

    def sync_team_cars(self) -> dict:
        f1_meta = self.store.load_league_meta("f1")
        logos_dir = self.paths.logos / "f1"
        logos_dir.mkdir(parents=True, exist_ok=True)

        synced = 0
        for team_id, team in f1_meta.teams.items():
            slug = _slug_for_team(team.display_name)
            if not slug:
                continue

            car_url = _CAR_URL_TEMPLATE.format(cdn=_F1_CDN_BASE, slug=slug)
            dest = logos_dir / f"{slug}_car.webp"

            team.remote_urls["car"] = car_url
            if not dest.exists():
                data = _download_bytes(car_url)
                if data:
                    dest.write_bytes(data)

            if dest.exists():
                team.logos["car"] = f"f1/{slug}_car.webp"
                if "car" not in team.available_variants:
                    team.available_variants.append("car")
                synced += 1

        self.store.save_league_meta(f1_meta)
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

            # Download if still missing
            if not dest.exists():
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
