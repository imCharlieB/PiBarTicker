import logging
import subprocess

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/kiosk", tags=["kiosk"])

_log = logging.getLogger(__name__)


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
