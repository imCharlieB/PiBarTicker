"""IndyCar driver sync — ESPN has no IndyCar roster or reliable headshots, indycar.com does.

Scrapes https://www.indycar.com/Drivers (server-rendered driver cards) for every driver's name, car
number, team, engine and country, and downloads the transparent driver art, team logo and engine logo.

Output:
  team-meta/irl-drivers.json   surname -> TeamLogoInfo (logos: cutout/full/team/engine, remote_urls: number, team, ...)
  logos/irl/                   downloaded image files
"""

from __future__ import annotations

import html
import re
import unicodedata
from datetime import datetime, timezone

import httpx

from ..paths import get_runtime_paths
from .logo_store import LeagueTeamMeta, LogoStore, TeamLogoInfo

_BASE = "https://www.indycar.com"
_UA = {"User-Agent": "Mozilla/5.0 (PiBarTicker)"}
_LEAGUE = "irl-drivers"

_CARD_RE = re.compile(r'<a href="/Drivers/([A-Za-z0-9\-]+)" class="driver-card">(.*?)</a>', re.S)
_SRC_RE = re.compile(r'src="([^"]+)"')
_FIRST_RE = re.compile(r'driver-card-identity-first-name"[^>]*>\s*([^<]+?)\s*<', re.S)
_LAST_RE = re.compile(r'driver-card-identity-last-name"[^>]*>\s*([^<]+?)\s*<', re.S)
_NUM_RE = re.compile(r"/Endplates/[^/]+/(\d+)[-_]")


def _norm(value: str) -> str:
    return unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()


def _pretty(stem: str) -> str:
    """'ChipGanassiRacing' -> 'Chip Ganassi Racing', 'ArrowMcLaren' -> 'Arrow McLaren', 'HMD-Foyt' -> 'HMD Foyt'."""
    stem = stem.replace("-", " ").replace("_", " ")
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", stem).strip()
    spaced = spaced.replace("Mc ", "Mc").replace("AJFoyt", "AJ Foyt")
    return re.sub(r"\s+", " ", spaced)


class IndycarCacheService:
    def __init__(self) -> None:
        self._http = httpx.Client(timeout=30.0, follow_redirects=True, headers=_UA)
        self._store = LogoStore()
        self._dir = get_runtime_paths().logos / "irl"
        self._dir.mkdir(parents=True, exist_ok=True)

    def _fetch(self, remote: str, dest_name: str) -> str:
        """Download remote (site-relative or absolute) to logos/irl/dest_name; '' on failure."""
        url = remote if remote.startswith("http") else _BASE + (remote if remote.startswith("/") else "/" + remote)
        url = url.replace("/~/media/", "/-/media/").split("?")[0]
        dest = self._dir / dest_name
        try:
            resp = self._http.get(url)
            if resp.status_code != 200 or not resp.content:
                return ""
            dest.write_bytes(resp.content)
            return f"irl/{dest_name}"
        except Exception:
            return ""

    def sync_drivers(self) -> dict:
        page = self._http.get(f"{_BASE}/Drivers")
        page.raise_for_status()
        cards = _CARD_RE.findall(page.text)
        if not cards:
            return {"ok": False, "drivers_synced": 0, "error": "no driver cards found on indycar.com/Drivers"}

        meta = LeagueTeamMeta(league=_LEAGUE)
        failed: list[str] = []
        shared: dict[str, str] = {}  # remote -> local, so a team/engine logo is fetched once

        for slug, body in cards:
            srcs = _SRC_RE.findall(body)
            fm, lm = _FIRST_RE.search(body), _LAST_RE.search(body)
            first = html.unescape(fm.group(1)).strip() if fm else ""
            last = html.unescape(lm.group(1)).strip() if lm else ""
            if not last:  # fall back to the slug ("Alex-Palou" -> Alex Palou)
                bits = slug.split("-")
                first, last = bits[0], " ".join(bits[1:]) or bits[0]
            display = f"{first} {last}".strip()
            key = re.sub(r"[^a-z0-9]", "", _norm(last))

            flag = next((s for s in srcs if "/Flags/" in s), "")
            plate = next((s for s in srcs if "/Endplates/" in s), "")
            team = next((s for s in srcs if "/IndyCar/Team/" in s), "")
            engine = next((s for s in srcs if re.search(r"/Logos/(honda|chevrolet)\.png", s, re.I)), "")
            cutout = next((s for s in srcs if "/Driver-List/" in s), "")

            logos: dict[str, str] = {}
            if cutout:
                got = self._fetch(cutout, f"{slug}_cutout.png")
                if got:
                    logos["headshot"] = got
                    logos["cutout"] = got
                full = self._fetch(cutout.replace("/Driver-List/", "/FullBody/"), f"{slug}_full.png")
                if full:
                    logos["render"] = full
            for tag, remote, fname in (("team", team, "team"), ("engine", engine, "engine")):
                if not remote:
                    continue
                if remote not in shared:
                    shared[remote] = self._fetch(remote, f"{fname}_{remote.split('/')[-1]}")
                if shared[remote]:
                    logos[tag] = shared[remote]
            if "headshot" not in logos:
                failed.append(display)

            number = (_NUM_RE.search(plate) or [None, ""])[1] if plate else ""
            meta.teams[key] = TeamLogoInfo(
                id=slug,
                abbreviation=(last[:3] or slug[:3]).upper(),
                display_name=display,
                logos=logos,
                remote_urls={
                    "car_number": number,
                    "team_name": _pretty(team.split("/")[-1].rsplit(".", 1)[0]) if team else "",
                    "engine": _pretty(engine.split("/")[-1].rsplit(".", 1)[0]) if engine else "",
                    "country": _pretty(flag.split("/")[-1].rsplit(".", 1)[0]) if flag else "",
                    "profile": f"{_BASE}/Drivers/{slug}",
                },
                available_variants=sorted(logos),
            )

        meta.ts = datetime.now(timezone.utc).isoformat()
        self._store.save_league_meta(meta)
        return {"ok": True, "drivers_synced": len(meta.teams), "without_photo": failed}

    def sync_all(self) -> dict:
        return {"ok": True, "drivers": self.sync_drivers()}

    def close(self) -> None:
        self._http.close()
