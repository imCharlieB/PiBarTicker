"""Product pictures for Home Assistant devices (a Bambu Lab printer, its AMS units) shown on the printer card.

The pictures are NOT stored in the repository (they are the manufacturer's / retailer's photos): the first time one is asked for, the Pi
downloads it once and keeps it in the runtime cache, so after that it works offline.
"""
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..core.paths import get_runtime_paths

router = APIRouter(prefix="/api/v1/ha", tags=["home-assistant"])

# image key -> source picture (set by the user: H2D from a retailer, the AMS pictures from the Bambu Lab store)
DEVICE_IMAGES: dict[str, str] = {
    "h2d": "https://www.gigaparts.com/media/catalog/product/cache/002dc70ccef261c78c46589b619436fc/h/2/h2d-2.webp",
    "ams": "https://store.bblcdn.com/s7/default/8b7b879210ac48108605504b02d578eb/ams-1.jpg",
    "ams_ht": "https://store.bblcdn.com/s1/default/3a2d0a7289d740258b9de72f3729c8b1/AMS_HT.jpg",
}

_MEDIA = {".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png"}


def image_key_for_model(model: str) -> str | None:
    """Which picture a Home Assistant device model gets (None = no picture known for it)."""
    m = (model or "").lower()
    if "ams" in m and "ht" in m:
        return "ams_ht"
    if "ams" in m:
        return "ams"
    if "h2d" in m:
        return "h2d"
    return None


def _cache_dir():
    d = get_runtime_paths().runtime_cache / "ha-images"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cached_file(key: str):
    for ext in _MEDIA:
        f = _cache_dir() / f"{key}{ext}"
        if f.exists():
            return f
    return None


@router.get("/device-image/{key}")
def device_image(key: str):
    url = DEVICE_IMAGES.get(key)
    if not url:
        raise HTTPException(status_code=404, detail="unknown picture")
    f = _cached_file(key)
    if f is None:
        try:
            r = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail=f"picture not available: {exc}") from exc
        ext = ".webp" if url.endswith(".webp") else ".png" if url.endswith(".png") else ".jpg"
        f = _cache_dir() / f"{key}{ext}"
        f.write_bytes(r.content)
    return FileResponse(f, media_type=_MEDIA[f.suffix], headers={"Cache-Control": "public, max-age=604800"})
