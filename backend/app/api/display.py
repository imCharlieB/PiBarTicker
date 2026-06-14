import json
import logging
import os
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
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


def _ddcutil_power(on: bool) -> bool:
    """Control display via DDC/CI (VCP feature D6). Returns True on success.

    This talks directly to the monitor hardware over HDMI, bypassing the
    Wayland compositor and any idle daemon — so it works even after the
    compositor has put the output to sleep.
    """
    if not shutil.which("ddcutil"):
        return False
    try:
        value = "1" if on else "4"  # D6: 1=on, 4=off/standby
        r = subprocess.run(
            ["ddcutil", "setvcp", "0xD6", value],
            capture_output=True, timeout=15,
        )
        if r.returncode == 0:
            return True
        # Retry with sudo in case user isn't in i2c group yet
        r2 = subprocess.run(
            ["sudo", "ddcutil", "setvcp", "0xD6", value],
            capture_output=True, timeout=15,
        )
        return r2.returncode == 0
    except Exception:
        return False


def _ddcutil_available() -> bool:
    if not shutil.which("ddcutil"):
        return False
    try:
        r = subprocess.run(
            ["ddcutil", "getvcp", "0xD6", "--brief"],
            capture_output=True, timeout=10,
        )
        if r.returncode == 0:
            return True
        r2 = subprocess.run(
            ["sudo", "ddcutil", "getvcp", "0xD6", "--brief"],
            capture_output=True, timeout=10,
        )
        return r2.returncode == 0
    except Exception:
        return False


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
    return {
        "display_on": _display_on,
        "cached_outputs": _cached_outputs,
        "detected_outputs": detected,
        "ddcutil_available": shutil.which("ddcutil") is not None,
        "ddcutil_d6_supported": _ddcutil_available(),
        "wlopm_available": shutil.which("wlopm") is not None,
        "wayland_display": env.get("WAYLAND_DISPLAY"),
        "xdg_runtime_dir": env.get("XDG_RUNTIME_DIR"),
        "wlr_randr_rc": wlr_rc,
        "wlr_randr_stdout": wlr_stdout,
        "wlr_randr_stderr": wlr_stderr,
    }


def _wlopm_outputs(on: bool, env: dict) -> list[str]:
    """Run wlopm --on/--off on all known outputs. Returns list of errors."""
    global _cached_outputs

    live = _detect_outputs(env)
    if live:
        _cached_outputs = live
        _save_cached_outputs(live)

    outputs = live or _cached_outputs
    if not outputs or not shutil.which("wlopm"):
        return []

    flag = "--on" if on else "--off"
    errors = []
    for output in outputs:
        try:
            subprocess.run(
                ["wlopm", flag, output],
                check=True, timeout=10, env=env, capture_output=True,
            )
        except Exception as exc:
            errors.append(f"{output}: {exc}")
    return errors


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on, _cached_outputs

    env = _wayland_env()

    if not body.on:
        # Kill Chromium so the compositor has no active client, then wlopm --off
        # drops the HDMI signal. The monitor enters deep sleep on its own once the
        # signal is gone. lxqt-powermanagement is permanently disabled via config
        # (install_pi.sh), so nothing will race wlopm --on at wake time.
        subprocess.run(
            ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
            timeout=5,
        )
        errors = _wlopm_outputs(False, env)
        if errors:
            _log.warning("wlopm --off errors: %s", errors)
        else:
            _log.info("Display off via wlopm")
        _display_on = False
        return {"on": _display_on}

    # Turning ON: wlopm --on re-enables the GPU output and drives the HDMI signal.
    # The monitor auto-wakes when it detects the signal. lxqt is disabled so nothing
    # races wlopm and re-asserts DPMS-off. Chromium relaunches via the kiosk loop.
    errors = _wlopm_outputs(True, env)
    if errors:
        _log.warning("wlopm --on errors: %s", errors)
    else:
        _log.info("Display on via wlopm")

    _display_on = True
    return {"on": _display_on}
