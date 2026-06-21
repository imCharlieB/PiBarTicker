#!/usr/bin/env python3
"""
Download TV network logos into logos/networks/ (served by the backend at
/logos/networks/) so the ticker can use them without a CDN dependency at
runtime.

Sources:
  - Most logos: github.com/tv-logo/tv-logos via jsDelivr CDN
  - Netflix, Prime Video, Apple TV+: Wikimedia Commons (requires User-Agent)

Usage:
    python scripts/download_tv_logos.py

Run from the repo root. Safe to re-run — skips files that already exist
unless you pass --force.
"""
import argparse
import sys
import urllib.request
from pathlib import Path

CDN = 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/united-states'
WM  = 'https://upload.wikimedia.org'
WM_HEADERS = {'User-Agent': 'PiBarTicker/1.0 (logo-download-script)'}

# (local filename, full URL)
LOGOS = [
    ('espn.png',         f'{CDN}/espn-us.png'),
    ('espn2.png',        f'{CDN}/espn-2-us.png'),
    ('espnu.png',        f'{CDN}/espn-u-us.png'),
    ('espnplus.png',     f'{CDN}/espn-plus-us.png'),
    ('abc.png',          f'{CDN}/abc-us.png'),
    ('fox.png',          f'{CDN}/fox-us.png'),
    ('fs1.png',          f'{CDN}/fox-sports-1-us.png'),
    ('fs2.png',          f'{CDN}/fox-sports-2-us.png'),
    ('nbc.png',          f'{CDN}/nbc-us.png'),
    ('nbcsports.png',    f'{CDN}/nbc-sports-us.png'),
    ('nflnetwork.png',   f'{CDN}/nfl-network-us.png'),
    ('mlbnetwork.png',   f'{CDN}/mlb-network-us.png'),
    ('nbatv.png',        f'{CDN}/nba-tv-us.png'),
    ('nhlnetwork.png',   f'{CDN}/nhl-network-us.png'),
    ('tnt.png',          f'{CDN}/tnt-us.png'),
    ('tbs.png',          f'{CDN}/tbs-us.png'),
    ('cbssn.png',        f'{CDN}/cbs-sports-network-us.png'),
    ('cbs.png',          f'{CDN}/cbs-logo-white-us.png'),
    ('secn.png',         f'{CDN}/sec-network-us.png'),
    ('accn.png',         f'{CDN}/acc-network-us.png'),
    ('btn.png',          f'{CDN}/big-ten-network-us.png'),
    ('usa.png',          f'{CDN}/usa-us.png'),
    ('cw.png',           f'{CDN}/cw-us.png'),
    ('altitude.png',     f'{CDN}/altitude-sports-us.png'),
    ('ballysports.png',  f'{CDN}/bally-sports-us.png'),
    ('peacock.png',      f'{CDN}/nbc-peacock-flat-us.png'),
    ('longhorn.png',     f'{CDN}/longhorn-network-us.png'),
    ('pac12.png',        f'{CDN}/pac-12-network-us.png'),
    ('dazn.png',         f'{CDN}/dazn-us.png'),
    ('paramount.png',    f'{CDN}/paramount-plus-us.png'),
    ('tennis.png',       f'{CDN}/tennis-channel-us.png'),
    ('olympic.png',      f'{CDN}/olympic-channel-us.png'),
    ('hbomax.png',       f'{CDN}/hbo-max-us.png'),
    ('max.png',          f'{CDN}/max-us.png'),
    # Canadian networks
    ('sportsnet.png',    'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/canada/sportsnet-ca.png'),
    # Wikimedia Commons — requires User-Agent header
    ('netflix.svg',      f'{WM}/wikipedia/commons/0/08/Netflix_2015_logo.svg'),
    ('primevideo.svg',   f'{WM}/wikipedia/commons/9/90/Prime_Video_logo_%282024%29.svg'),
    ('appletv.svg',      f'{WM}/wikipedia/en/a/ae/Apple_TV_%28logo%29.svg'),
]

def fetch(url, dest):
    headers = WM_HEADERS if 'wikimedia.org' in url else {}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as r, open(dest, 'wb') as f:
        f.write(r.read())

def main():
    parser = argparse.ArgumentParser(description='Download TV network logos')
    parser.add_argument('--force', action='store_true', help='Re-download even if file exists')
    args = parser.parse_args()

    out_dir = Path(__file__).parent.parent / 'logos' / 'networks'
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = skipped = failed = 0
    for local_name, url in LOGOS:
        dest = out_dir / local_name
        if dest.exists() and not args.force:
            print(f'  skip  {local_name}')
            skipped += 1
            continue
        try:
            fetch(url, dest)
            print(f'  ok    {local_name}  ({dest.stat().st_size // 1024}KB)')
            ok += 1
        except Exception as e:
            print(f'  FAIL  {local_name}: {e}', file=sys.stderr)
            failed += 1

    print(f'\n{ok} downloaded, {skipped} skipped, {failed} failed')
    if failed:
        sys.exit(1)

if __name__ == '__main__':
    main()
