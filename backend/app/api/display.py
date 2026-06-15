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
    """Return Pi major version (4, 5, …) or 0 if not running on a Raspberry Pi."""
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


class DisplayPowerRequest(BaseModel):
    on: bool


@router.get("/power")
def get_display_power() -> dict:
    return {"on": _display_on}


def _vcgencmd_power(state: int) -> bool:
    """
    Control HDMI at VideoCore firmware level — no Wayland session required.
    state: 1 = on, 0 = off.

    Fires on all known display IDs so whichever port is active gets the signal:
      (no ID) = default / primary output
      2       = HDMI0 (first port, Pi 4/5)
      7       = HDMI1 (second port, Pi 4/5) — HDMI-A-2 in Wayland naming

    Returns True if vcgencmd was found and called.
    """
    if shutil.which("vcgencmd") is None:
        return False
    s = str(state)
    for cmd in (
        ["vcgencmd", "display_power", s],
        ["vcgencmd", "display_power", s, "2"],
        ["vcgencmd", "display_power", s, "7"],
    ):
        try:
            subprocess.run(cmd, timeout=5, capture_output=True)
        except Exception:
            return False
    return True


def _wlopm(on: bool, env: dict) -> None:
    """Fallback for non-Pi: run wlopm --on/--off on all detected outputs."""
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


@router.get("/diagnose")
def diagnose_display() -> dict:
    env = _wayland_env()
    detected = _detect_outputs(env)
    pi_ver = _pi_version()
    try:
        raw = subprocess.run(["wlr-randr"], capture_output=True, text=True, timeout=5, env=env)
        wlr_stdout = raw.stdout
        wlr_stderr = raw.stderr
        wlr_rc = raw.returncode
    except Exception as e:
        wlr_stdout, wlr_stderr, wlr_rc = "", str(e), -1
    return {
        "display_on": _display_on,
        "pi_version": pi_ver,
        "cached_outputs": _cached_outputs,
        "detected_outputs": detected,
        "ddcutil_available": shutil.which("ddcutil") is not None,
        "vcgencmd_available": shutil.which("vcgencmd") is not None,
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
    pi_ver = _pi_version()

    if not body.on:
        _display_on = False

        if _vcgencmd_power(0):
            # Pi: cut HDMI signal at firmware level. The compositor keeps running
            # so Chromium stays alive — signal returns instantly on turn-on with
            # no kiosk restart needed.
            _log.info("Display off via vcgencmd (Pi %s)", pi_ver or "?")
        else:
            # Non-Pi fallback: kill Chromium then drop signal via compositor.
            subprocess.run(
                ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
                timeout=5,
            )
            _wlopm(False, _wayland_env())
            _log.info("Display off via wlopm (non-Pi)")

        return {"on": _display_on}

    _display_on = True

    if _vcgencmd_power(1):
        # Pi: firmware re-initializes HDMI and sends HPD pulse — monitor wakes
        # and immediately shows the running Chromium compositor output.
        _log.info("Display on via vcgencmd (Pi %s)", pi_ver or "?")
    else:
        # Non-Pi: kiosk script handles wlopm --on from the graphical session.
        _log.info("vcgencmd not available (Pi %s) — kiosk script handles wlopm --on", pi_ver or "?")

    return {"on": _display_on}
