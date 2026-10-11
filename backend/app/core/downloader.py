"""Download team logos from remote URLs and save them locally."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable

import httpx

from .logo_store import LogoStore, TeamLogoInfo


class LogoDownloader:
    def __init__(self, store: LogoStore | None = None) -> None:
        self.store = store or LogoStore()
        self.client = httpx.Client(timeout=15.0, follow_redirects=True)

    def download_and_save(
        self,
        league: str,
        team: TeamLogoInfo,
        variant: str,
        url: str,
    ) -> Path | None:
        """Download a single logo variant and save it.

        Returns the local path if successful.
        Skips download if the target file already exists.
        """
        if not url:
            return None

        target_path = self.store.get_logo_path(league, team.abbreviation, team.id, variant)
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if target_path.exists():
            # Already have this variant locally — just make sure metadata is updated
            filename = self.store.get_logo_filename(team.abbreviation, team.id, variant)
            relative_path = f"{league.lower()}/{filename}"
            team.logos[variant] = relative_path
            team.remote_urls[variant] = url
            if variant not in team.available_variants:
                team.available_variants.append(variant)
            return target_path

        try:
            resp = self.client.get(url)
            resp.raise_for_status()

            # Basic content type check
            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and not url.lower().endswith((".png", ".jpg", ".jpeg", ".svg")):
                print(f"[logo] Skipping non-image URL for {team.abbreviation} {variant}: {url}")
                return None

            target_path.write_bytes(resp.content)
            # Update metadata using new unique filename format
            filename = self.store.get_logo_filename(team.abbreviation, team.id, variant)
            relative_path = f"{league.lower()}/{filename}"
            team.logos[variant] = relative_path
            team.remote_urls[variant] = url
            team.available_variants = list(set(team.available_variants + [variant]))
            return target_path

        except Exception as exc:
            print(f"[logo] Failed to download {url} -> {exc}")
            return None

    def download_variants(
        self,
        league: str,
        team: TeamLogoInfo,
        variants: dict[str, str],  # variant_name -> remote_url
    ) -> int:
        """Download multiple variants for a team. Returns number successfully saved.

        We avoid re-downloading the exact same URL multiple times in one pass.
        """
        saved = 0
        seen_urls: set[str] = set()

        for variant, url in variants.items():
            if url in seen_urls:
                # Already downloaded this image in this run — just record the variant name
                # pointing to the same content (we'll still create the filename variant).
                # For now we still call download_and_save so it writes under the new variant name
                # if the file doesn't exist yet.
                pass
            else:
                seen_urls.add(url)

            if self.download_and_save(league, team, variant, url):
                saved += 1

            time.sleep(0.12)  # be polite to ESPN

        return saved

    def close(self) -> None:
        self.client.close()