import os
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/display", tags=["display"])

_display_on: bool = True  # assumed on at startup


def _wayland_env() -> dict:
    """Return an env dict with correct WAYLAND_DISPLAY and XDG_RUNTIME_DIR.

    Auto-detects wayland-0 vs wayland-1 so the service unit doesn't need to
    hardcode the socket name (it varies across Pi OS versions).
    """
    env = os.environ.copy()
    xdg = env.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    env["XDG_RUNTIME_DIR"] = xdg
    if not env.get("WAYLAND_DISPLAY"):
        for name in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(xdg, name)):
                env["WAYLAND_DISPLAY"] = name
                break
    # If the env var is set but the socket doesn't exist under that name, try the other
    elif not os.path.exists(os.path.join(xdg, env["WAYLAND_DISPLAY"])):
        for name in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(xdg, name)):
                env["WAYLAND_DISPLAY"] = name
                break
    return env


def _wlr_randr_available() -> bool:
    return shutil.which("wlr-randr") is not None


def _detect_output(env: dict) -> str | None:
    try:
        result = subprocess.run(
            ["wlr-randr"], capture_output=True, text=True, timeout=5, env=env
        )
        for line in result.stdout.splitlines():
            if line and not line[0].isspace():
                return line.split()[0]
    except Exception:
        pass
    return None


class DisplayPowerRequest(BaseModel):
    on: bool


@router.get("/power")
def get_display_power() -> dict:
    return {"on": _display_on}


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on
    if not _wlr_randr_available():
        raise HTTPException(status_code=503, detail="wlr-randr not available")
    env = _wayland_env()
    output = _detect_output(env)
    if not output:
        raise HTTPException(
            status_code=503,
            detail=f"No Wayland output detected (WAYLAND_DISPLAY={env.get('WAYLAND_DISPLAY')}, XDG_RUNTIME_DIR={env.get('XDG_RUNTIME_DIR')})",
        )
    flag = "--on" if body.on else "--off"
    try:
        subprocess.run(
            ["wlr-randr", "--output", output, flag], check=True, timeout=10, env=env
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"wlr-randr failed: {exc}")
    _display_on = body.on
    return {"on": _display_on}
