import logging
import os
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import config_store

router = APIRouter(prefix="/api/v1/display", tags=["display"])

_log = logging.getLogger(__name__)
_display_on: bool = True
_cached_output: str | None = None


def _wayland_env() -> dict:
    env = os.environ.copy()
    xdg = env.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    env["XDG_RUNTIME_DIR"] = xdg
    if not env.get("WAYLAND_DISPLAY"):
        for name in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(xdg, name)):
                env["WAYLAND_DISPLAY"] = name
                break
    elif not os.path.exists(os.path.join(xdg, env["WAYLAND_DISPLAY"])):
        for name in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(xdg, name)):
                env["WAYLAND_DISPLAY"] = name
                break
    return env


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
    global _display_on, _cached_output

    has_wlopm = shutil.which("wlopm") is not None
    has_wlr_randr = shutil.which("wlr-randr") is not None

    if not has_wlopm and not has_wlr_randr:
        raise HTTPException(status_code=503, detail="Neither wlopm nor wlr-randr is available")

    env = _wayland_env()
    output = _detect_output(env) or _cached_output
    if not output:
        raise HTTPException(
            status_code=503,
            detail=f"No Wayland output detected (WAYLAND_DISPLAY={env.get('WAYLAND_DISPLAY')}, XDG_RUNTIME_DIR={env.get('XDG_RUNTIME_DIR')})",
        )
    _cached_output = output

    try:
        if has_wlopm:
            flag = "--on" if body.on else "--off"
            subprocess.run(["wlopm", flag, output], check=True, timeout=10, env=env)
        else:
            if body.on:
                # Mirror what launch-kiosk.sh does on startup: set --custom-mode WxH
                # (no --on flag, no @refresh — setting a mode implicitly enables the output)
                cfg = config_store.load()
                w, h = cfg.monitor.width, cfg.monitor.height
                subprocess.run(
                    ["wlr-randr", "--output", output, "--custom-mode", f"{w}x{h}"],
                    check=True, timeout=10, env=env,
                )
            else:
                subprocess.run(
                    ["wlr-randr", "--output", output, "--off"],
                    check=True, timeout=10, env=env,
                )
    except subprocess.CalledProcessError as exc:
        if not body.on:
            raise HTTPException(status_code=500, detail=f"Display off failed: {exc}")
        # Turn-on command failed — still mark as on so the kiosk loop unblocks
        # and Chromium restarts (its reconnecting to the compositor re-enables the output)
        _log.warning("Display turn-on command failed (kiosk will restart anyway): %s", exc)

    _display_on = body.on
    return {"on": _display_on}
