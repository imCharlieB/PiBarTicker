import logging
import subprocess
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/kiosk", tags=["kiosk"])

_log = logging.getLogger(__name__)

_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "dist"


def _build_hash() -> str:
    assets = list(_frontend_dist.glob("assets/index-*.js"))
    if assets:
        stem = assets[0].stem  # e.g. "index-B6vbyD6H"
        parts = stem.split("-", 1)
        return parts[1] if len(parts) == 2 else stem
    return "unknown"


@router.get("/build-hash")
def build_hash() -> dict:
    """Return the current frontend build hash so clients can detect new deploys."""
    return {"hash": _build_hash()}


@router.post("/restart")
def restart_kiosk() -> dict:
    """Kill the Chromium kiosk process so launch-kiosk.sh restarts it with fresh config."""
    killed = False
    for name in ("chromium-browser", "chromium"):
        try:
            r = subprocess.run(["pkill", "-f", name], timeout=5)
            if r.returncode == 0:
                killed = True
                _log.info("Sent SIGTERM to %s processes", name)
        except Exception as exc:
            _log.warning("pkill %s failed: %s", name, exc)
    return {"restarted": killed}
