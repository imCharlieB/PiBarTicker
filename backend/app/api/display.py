import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.paths import get_runtime_paths

router = APIRouter(prefix="/api/v1/display", tags=["display"])

_log = logging.getLogger(__name__)
_display_on: bool = True

_OUTPUT_CACHE_FILE = get_runtime_paths().runtime_cache / "display_output.json"


def _load_cached_outputs() -> list[str]:
    try:
        if _OUTPUT_CACHE_FILE.exists():
            data = json.loads(_OUTPUT_CACHE_FILE.read_text())
            if isinstance(data, list):
                return data
            if isinstance(data, str):
                return [data]
    except Exception:
        pass
    return []


def _save_cached_outputs(names: list[str]) -> None:
    try:
        _OUTPUT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _OUTPUT_CACHE_FILE.write_text(json.dumps(names))
    except Exception:
        pass


_cached_outputs: list[str] = _load_cached_outputs()


def _pi_version() -> int:
    try:
        model = Path("/proc/device-tree/model").read_bytes().rstrip(b"\x00").decode()
        for ver in (5, 4, 3, 2, 1):
            if f"Raspberry Pi {ver}" in model:
                return ver
    except Exception:
        pass
    return 0


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


def _detect_outputs(env: dict) -> list[str]:
    try:
        result = subprocess.run(
            ["wlr-randr"], capture_output=True, text=True, timeout=5, env=env
        )
        return [
            line.split()[0]
            for line in result.stdout.splitlines()
            if line and not line[0].isspace()
        ]
    except Exception:
        pass
    return []


def _ddcutil_d6(value: int) -> bool:
    """
    Send VCP D6 command via ddcutil.
    value=1 (on), value=4 (standby/off).

    DDC operates over the HDMI cable while the signal stays live — HPD never
    drops, so DDC is always reachable. This avoids the Pi 5 issue where
    wlopm --off drops HPD and makes the monitor unreachable via software.

    Returns True if the command ran without error.
    """
    if shutil.which("ddcutil") is None:
        return False
    try:
        r = subprocess.run(
            ["ddcutil", "setvcp", "0xD6", str(value)],
            timeout=10, capture_output=True,
        )
        return r.returncode == 0
    except Exception:
        return False


def _wlopm(on: bool, env: dict) -> None:
    """Fallback display control when ddcutil is not available."""
    global _cached_outputs
    live = _detect_outputs(env)
    if live:
        _cached_outputs = live
        _save_cached_outputs(live)
    outputs = live or _cached_outputs
    flag = "--on" if on else "--off"
    for output in outputs:
        try:
            subprocess.run(
                ["wlopm", flag, output],
                timeout=10, env=env, capture_output=True,
            )
        except Exception:
            pass


class DisplayPowerRequest(BaseModel):
    on: bool


@router.get("/power")
def get_display_power() -> dict:
    return {"on": _display_on}


@router.get("/diagnose")
def diagnose_display() -> dict:
    env = _wayland_env()
    detected = _detect_outputs(env)
    try:
        raw = subprocess.run(["wlr-randr"], capture_output=True, text=True, timeout=5, env=env)
        wlr_stdout = raw.stdout
        wlr_stderr = raw.stderr
        wlr_rc = raw.returncode
    except Exception as e:
        wlr_stdout, wlr_stderr, wlr_rc = "", str(e), -1
    ddcutil_d6 = False
    if shutil.which("ddcutil") is not None:
        try:
            r = subprocess.run(
                ["ddcutil", "capabilities"], capture_output=True, text=True, timeout=15,
            )
            ddcutil_d6 = "Feature: D6" in r.stdout
        except Exception:
            pass
    return {
        "display_on": _display_on,
        "pi_version": _pi_version(),
        "cached_outputs": _cached_outputs,
        "detected_outputs": detected,
        "ddcutil_available": shutil.which("ddcutil") is not None,
        "ddcutil_d6_supported": ddcutil_d6,
        "wlopm_available": shutil.which("wlopm") is not None,
        "wayland_display": env.get("WAYLAND_DISPLAY"),
        "xdg_runtime_dir": env.get("XDG_RUNTIME_DIR"),
        "wlr_randr_rc": wlr_rc,
        "wlr_randr_stdout": wlr_stdout,
        "wlr_randr_stderr": wlr_stderr,
    }


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on

    ddcutil_ok = shutil.which("ddcutil") is not None
    env = _wayland_env()

    if not body.on:
        # Kill Chromium first so there is no active video content when D6=4
        # is sent — active content causes the monitor to auto-wake from standby.
        # With only the static compositor wallpaper remaining, D6=4 sticks.
        _display_on = False
        subprocess.run(
            ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
            timeout=5,
        )
        if ddcutil_ok:
            # D6=4: panel standby via DDC. HDMI signal stays live so HPD never
            # drops — DDC remains reachable for the wake command.
            _ddcutil_d6(4)
            _log.info("Display off via ddcutil D6=4")
        else:
            # No ddcutil: fall back to wlopm (note: on Pi 5 this drops HPD and
            # prevents reliable software wake — ddcutil is strongly preferred).
            _wlopm(False, env)
            _log.info("Display off via wlopm (ddcutil not available)")
        return {"on": _display_on}

    # Turn on: wake the panel via DDC. Because HDMI signal was kept alive
    # (never dropped by wlopm), DDC is still reachable regardless of how long
    # the display has been off. The kiosk script restarts Chromium once
    # display_explicitly_off returns false.
    _display_on = True
    if ddcutil_ok:
        _ddcutil_d6(1)
        _log.info("Display on via ddcutil D6=1")
    else:
        _log.info("ddcutil not available — kiosk script handles wlopm --on")
    return {"on": _display_on}
