#!/usr/bin/env python3
"""
Download real driver photos from nascar.com into logos/nascar/{cup,xfinity,trucks}/
and update team-meta/nascar-*.json to point at them.

Why this exists (not folded into the normal "Sync Teams & Logos" button):
nascar.com sits behind Cloudflare bot management that actively JS-challenges
requests ("Just a moment..." interstitial) -- confirmed 2026-10-02 that this
is NOT just a header check. Python's httpx/urllib (what the real backend
uses, including on the Pi) can never pass it; even curl passes only
intermittently once a session starts making repeated requests. A real
browser (Playwright/Chromium) solves the challenge like any visitor would.
This has to run on a dev machine with a real browser, not the Pi -- the
Pi only ever gets these files via git, same as the series logos/playoff
badges (see .gitignore exceptions for logos/nascar/*_headshot.*).

Source pages, per series:
  https://www.nascar.com/drivers/nascar-cup-series/
  https://www.nascar.com/drivers/nascar-oreilly-auto-parts-series/   (Xfinity)
  https://www.nascar.com/drivers/nascar-craftsman-truck-series/      (Trucks)

Each driver's photo is identified by matching <img alt="{Driver Name}"> (or
"{Driver Name} Driver Page") against our cached driver roster
(team-meta/nascar-*.json) -- not by guessing the image filename, which
varies a lot (_resized.png, -1.png, -Headshot.png, hand-typed names, etc).

Cup drivers additionally get their individual driver page
(nascar.com/drivers/{slug}/) checked for a second, usually better photo --
confirmed 2026-10-02 this exists and differs from the roster-page photo for
Cup, but is the same image for at least one Truck driver checked. Skipped
for Xfinity/Trucks to keep runtime down unless --full-individual is passed.

Usage:
    python scripts/sync_nascar_photos.py
    python scripts/sync_nascar_photos.py --series cup        # just one series
    python scripts/sync_nascar_photos.py --force             # re-download existing files too
    python scripts/sync_nascar_photos.py --full-individual   # also check individual pages for Xfinity/Trucks

Run from the repo root. Needs `pip install playwright` + `playwright install
chromium` once (not part of backend/requirements.txt -- dev-machine only,
never installed on the Pi).

After running, review what changed and commit the new/updated files in
logos/nascar/*/ and team-meta/nascar-*.json -- the Pi only picks these up
through a normal git-based update, there is no live sync for this.
"""
import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Needs playwright: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).parent.parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
CLOUDFLARE_WAIT_SECONDS = 6  # time to let the "Just a moment..." challenge resolve

# Manufacturer logos -- shared across all three series, one file each, found on the roster
# pages alongside the driver photos (same host, same Cloudflare situation).
MANUFACTURER_LOGOS = {
    "chevrolet": "https://www.nascar.com/wp-content/uploads/sites/7/2025/03/04/Chevrolet_2025-330x140.png",
    "toyota": "https://www.nascar.com/wp-content/uploads/sites/7/2020/04/06/Toyota-180x180.png",
    "ford": "https://www.nascar.com/wp-content/uploads/sites/7/2026/06/10/Ford_Racing_Oval-330x124.png",
    "ram": "https://www.nascar.com/wp-content/uploads/sites/7/2026/01/12/Ram-330x115.png",
}

# (series key, roster page slug, team-meta file, logos subfolder)
SERIES = {
    "cup":     ("nascar-cup-series",              "nascar-cup.json",     "cup"),
    "xfinity": ("nascar-oreilly-auto-parts-series", "nascar-xfinity.json", "xfinity"),
    "trucks":  ("nascar-craftsman-truck-series",  "nascar-trucks.json",  "trucks"),
}


def normalize_name(s: str) -> str:
    """'Kyle Larson' / 'AJ Allmendinger' -> comparable lowercase form, accents stripped."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s.lower())


def driver_slug(name: str) -> str:
    """'AJ Allmendinger' -> 'aj-allmendinger', for the individual driver page URL."""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def load_meta(meta_path: Path) -> dict:
    """Full team-meta file contents ({league, ts, teams: {surname: driver}})."""
    if not meta_path.exists():
        return {}
    return json.loads(meta_path.read_text(encoding="utf-8"))


def find_roster_photos(page, url: str) -> dict[str, str]:
    """Visit a roster listing page, return {normalized_full_name: photo_url}."""
    page.goto(url, timeout=30000)
    time.sleep(CLOUDFLARE_WAIT_SECONDS)
    imgs = page.eval_on_selector_all(
        "img",
        "els => els.map(e => ({src: e.getAttribute('src'), dataSrc: e.getAttribute('data-src'), alt: e.getAttribute('alt')}))",
    )
    out: dict[str, str] = {}
    for img in imgs:
        alt = (img.get("alt") or "").strip()
        src = img.get("dataSrc") or img.get("src") or ""
        if not alt or "wp-content/uploads" not in src:
            continue
        name = re.sub(r"\s*Driver Page\s*$", "", alt, flags=re.IGNORECASE).strip()
        if not name or "logo" in name.lower() or "manufacturer" in name.lower() or "broadcaster" in name.lower():
            continue
        key = normalize_name(name)
        if key and key not in out:
            out[key] = src if src.startswith("http") else f"https://www.nascar.com{src}"
    return out


def find_individual_photo(page, name: str) -> str | None:
    """Visit a driver's own page, return their (usually better) photo URL if found."""
    slug = driver_slug(name)
    try:
        page.goto(f"https://www.nascar.com/drivers/{slug}/", timeout=30000)
    except Exception:
        return None
    time.sleep(CLOUDFLARE_WAIT_SECONDS)
    imgs = page.eval_on_selector_all(
        "img",
        "els => els.map(e => ({src: e.getAttribute('src'), alt: e.getAttribute('alt')}))",
    )
    target = normalize_name(name)
    for img in imgs:
        alt = (img.get("alt") or "").strip()
        src = img.get("src") or ""
        if normalize_name(alt) == target and "wp-content/uploads" in src:
            return src
    return None


def main():
    parser = argparse.ArgumentParser(description="Sync real driver photos from nascar.com")
    parser.add_argument("--series", choices=list(SERIES), help="Only this series (default: all three)")
    parser.add_argument("--force", action="store_true", help="Re-download even if a photo file already exists")
    parser.add_argument("--full-individual", action="store_true", help="Also check individual pages for Xfinity/Trucks, not just Cup")
    parser.add_argument("--skip-manufacturers", action="store_true", help="Don't fetch the Ford/Chevy/Toyota/Ram logos")
    parser.add_argument("--manufacturers-only", action="store_true", help="Just the 4 manufacturer logos, skip all driver photos")
    args = parser.parse_args()

    series_list = [] if args.manufacturers_only else ([args.series] if args.series else list(SERIES))
    downloaded = skipped = failed = unmatched = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA)

        for series_key in series_list:
            roster_slug, meta_filename, subfolder = SERIES[series_key]
            out_dir = ROOT / "logos" / "nascar" / subfolder
            out_dir.mkdir(parents=True, exist_ok=True)
            meta_path = ROOT / "team-meta" / meta_filename
            meta = load_meta(meta_path)
            roster = meta.get("teams") or {}
            if not roster:
                print(f"[{series_key}] no cached roster at {meta_path} -- run the normal Setup page sync first", file=sys.stderr)
                continue

            print(f"\n=== {series_key}: fetching roster page ===")
            try:
                roster_photos = find_roster_photos(page, f"https://www.nascar.com/drivers/{roster_slug}/")
            except Exception as e:
                print(f"[{series_key}] roster page fetch failed: {e}", file=sys.stderr)
                continue
            print(f"[{series_key}] found {len(roster_photos)} roster photos")

            check_individual = series_key == "cup" or args.full_individual

            for surname_key, driver in roster.items():
                display_name = driver.get("display_name") or surname_key
                driver_id = (driver.get("remote_urls") or {}).get("nascar_driver_id", "")
                dest = out_dir / f"{surname_key}_{driver_id}_photo.png"

                if dest.exists() and not args.force:
                    skipped += 1
                    continue

                name_key = normalize_name(display_name)
                photo_url = roster_photos.get(name_key)

                if check_individual:
                    better = find_individual_photo(page, display_name)
                    if better:
                        photo_url = better

                if not photo_url:
                    print(f"  no photo match: {display_name}")
                    unmatched += 1
                    continue

                try:
                    # context.request.get() -- a bare API call, not a real navigation -- got a
                    # flat 403 from every single image even though page.goto() for the same host
                    # worked fine moments earlier (confirmed 2026-10-02: 23/23 downloads failed
                    # this way in testing). Cloudflare is scoring the *image* request
                    # differently from the page request even with shared cookies. Navigating to
                    # the image URL as a real top-level load, same as the page visits that did
                    # work, avoids that distinction entirely.
                    resp = page.goto(photo_url, timeout=20000)
                    if resp is None or not resp.ok:
                        raise RuntimeError(f"HTTP {resp.status if resp else '?'}")
                    dest.write_bytes(resp.body())
                    print(f"  ok    {display_name} -> {dest.name} ({dest.stat().st_size // 1024}KB)")
                    downloaded += 1
                    # Point team-meta at the new local file -- same relative-path convention
                    # the rest of the logo system already uses.
                    driver.setdefault("logos", {})["headshot"] = f"nascar/{subfolder}/{dest.name}"
                    if "headshot" not in driver.get("available_variants", []):
                        driver.setdefault("available_variants", []).append("headshot")
                except Exception as e:
                    print(f"  FAIL  {display_name}: {e}", file=sys.stderr)
                    failed += 1

            meta["teams"] = roster
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        if not args.skip_manufacturers:
            print("\n=== manufacturer logos ===")
            man_dir = ROOT / "logos" / "nascar" / "manufacturers"
            man_dir.mkdir(parents=True, exist_ok=True)
            for name, url in MANUFACTURER_LOGOS.items():
                dest = man_dir / f"{name}.png"
                if dest.exists() and not args.force:
                    print(f"  skip  {name}")
                    skipped += 1
                    continue
                try:
                    resp = page.goto(url, timeout=20000)
                    if resp is None or not resp.ok:
                        raise RuntimeError(f"HTTP {resp.status if resp else '?'}")
                    dest.write_bytes(resp.body())
                    print(f"  ok    {name} ({dest.stat().st_size // 1024}KB)")
                    downloaded += 1
                except Exception as e:
                    print(f"  FAIL  {name}: {e}", file=sys.stderr)
                    failed += 1

        browser.close()

    print(f"\n{downloaded} downloaded, {skipped} skipped (already cached), {unmatched} unmatched, {failed} failed")
    print("Review logos/nascar/*/  +  team-meta/nascar-*.json, then commit what you want to keep.")
    print("The Pi only gets these through a normal git-based update -- there's no live sync for this.")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
