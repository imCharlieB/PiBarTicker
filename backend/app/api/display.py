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

_paths = get_runtime_paths()
_OUTPUT_CACHE_FILE = _paths.runtime_cache / "display_output.json"
_MODES_CACHE_FILE = _paths.runtime_cache / "display_modes.json"


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


def _load_cached_modes() -> dict[str, str]:
    try:
        if _MODES_CACHE_FILE.exists():
            data = json.loads(_MODES_CACHE_FILE.read_text())
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _save_cached_modes(modes: dict[str, str]) -> None:
    try:
        _MODES_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _MODES_CACHE_FILE.write_text(json.dumps(modes))
    except Exception:
        pass


_cached_outputs: list[str] = _load_cached_outputs()
_cached_modes: dict[str, str] = _load_cached_modes()  # output -> "WxH@hz"


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


def _parse_wlr_randr(stdout: str) -> tuple[list[str], dict[str, str]]:
    """
    Parse wlr-randr stdout.
    Returns (output_names, preferred_modes) where preferred_modes maps
    output name -> "WxH@hz" string for the mode tagged (preferred).
    """
    outputs: list[str] = []
    modes: dict[str, str] = {}
    current = None
    for line in stdout.splitlines():
        if line and not line[0].isspace():
            current = line.split()[0]
            outputs.append(current)
        elif current and "(preferred)" in line and " Hz" in line:
            # "    1920x380 px, 57.933998 Hz (preferred)"
            parts = line.split()
            try:
                res = parts[0]           # "1920x380"
                hz = f"{float(parts[2]):.3f}"  # "57.934"
                modes[current] = f"{res}@{hz}"
            except (ValueError, IndexError):
                pass
    return outputs, modes


def _query_wlr_randr(env: dict) -> tuple[list[str], dict[str, str]]:
    try:
        r = subprocess.run(
            ["wlr-randr"], capture_output=True, text=True, timeout=5, env=env
        )
        return _parse_wlr_randr(r.stdout)
    except Exception:
        pass
    return [], {}


class DisplayPowerRequest(BaseModel):
    on: bool


@router.get("/power")
def get_display_power() -> dict:
    return {"on": _display_on}


def _wlopm_off(outputs: list[str], env: dict) -> None:
    for output in outputs:
        try:
            subprocess.run(
                ["wlopm", "--off", output],
                timeout=10, env=env, capture_output=True,
            )
        except Exception:
            pass


def _wlr_randr_on(outputs: list[str], modes: dict[str, str], env: dict) -> None:
    """Re-apply the preferred mode for each output to restore HDMI signal.

    On Pi 5, wlopm --on after wlopm --off does not trigger signal re-negotiation.
    Re-applying the mode via wlr-randr forces the compositor to re-enable the
    CRTC with a full modeset, which wakes the monitor.
    """
    for output in outputs:
        mode = modes.get(output)
        if not mode:
            continue
        try:
            subprocess.run(
                ["wlr-randr", "--output", output, "--mode", mode],
                timeout=10, env=env, capture_output=True,
            )
        except Exception:
            pass


@router.get("/diagnose")
def diagnose_display() -> dict:
    env = _wayland_env()
    try:
        r = subprocess.run(["wlr-randr"], capture_output=True, text=True, timeout=5, env=env)
        detected, detected_modes = _parse_wlr_randr(r.stdout)
        wlr_stdout, wlr_stderr, wlr_rc = r.stdout, r.stderr, r.returncode
    except Exception as e:
        detected, detected_modes = [], {}
        wlr_stdout, wlr_stderr, wlr_rc = "", str(e), -1
    return {
        "display_on": _display_on,
        "pi_version": _pi_version(),
        "cached_outputs": _cached_outputs,
        "cached_modes": _cached_modes,
        "detected_outputs": detected,
        "detected_modes": detected_modes,
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
    global _display_on, _cached_outputs, _cached_modes

    env = _wayland_env()

    if not body.on:
        # Snapshot outputs and preferred modes while display is on so we have
        # them available for turn-on (wlr-randr may return less info when off).
        live_outputs, live_modes = _query_wlr_randr(env)
        if live_outputs:
            _cached_outputs = live_outputs
            _save_cached_outputs(live_outputs)
        if live_modes:
            _cached_modes = live_modes
            _save_cached_modes(live_modes)

        _display_on = False
        subprocess.run(
            ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
            timeout=5,
        )
        _wlopm_off(_cached_outputs, env)
        _log.info("Display off via wlopm; cached modes: %s", _cached_modes)
        return {"on": _display_on}

    # Turn on: re-apply the preferred mode via wlr-randr.
    # On Pi 5, wlopm --on alone does not re-negotiate the HDMI signal after
    # wlopm --off. Re-applying the mode forces a full modeset which wakes the
    # monitor. The kiosk script then relaunches Chromium.
    _display_on = True
    outputs = _cached_outputs
    modes = _cached_modes
    if not modes:
        # Fallback: try to detect live (works if display came back some other way)
        outputs, modes = _query_wlr_randr(env)
    _wlr_randr_on(outputs, modes, env)
    _log.info("Display on via wlr-randr mode reapplication: %s", modes)
    return {"on": _display_on}
