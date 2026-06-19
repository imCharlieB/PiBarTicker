import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.config import config_store
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
    """Try to control power via ddcutil (usually fails on this monitor)."""
    if shutil.which("ddcutil") is None:
        return False

    strategies = [
        ["--bus", "14", "--noverify", "setvcp", "0xD6", str(value)],
        ["--bus", "14", "--noverify", "--maxtries", "15", "setvcp", "0xD6", str(value)],
        ["setvcp", "0xD6", str(value)],
    ]

    for use_sudo in [True, False]:
        for extra_args in strategies:
            cmd = (["sudo"] if use_sudo else []) + ["ddcutil"] + extra_args
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=12)
                if r.returncode == 0:
                    return True
            except Exception:
                pass
    return False


def _wlopm(on: bool, env: dict) -> None:
    global _cached_outputs

    if on:
        # Use cache from OFF time — outputs may not be detectable when powered off.
        outputs = _cached_outputs or _detect_outputs(env)
    else:
        # Detect while all outputs are live, cache for the wake call.
        outputs = _detect_outputs(env)
        if outputs:
            _cached_outputs = outputs
            _save_cached_outputs(outputs)

    if not outputs:
        _log.warning("No Wayland outputs detected; cannot control display power")
        return

    try:
        cfg = config_store.load()
        mode = f"{cfg.monitor.width}x{cfg.monitor.height}"
        w = cfg.monitor.width
    except Exception:
        mode = ""
        w = 1920

    # Build a single atomic off command covering all outputs.
    off_args: list[str] = []
    for output in outputs:
        off_args += ["--output", output, "--off"]

    if on:
        # Disable first so the re-enable triggers a full DRM modeset — this
        # wakes displays regardless of whether they were off via our API or
        # sleeping on their own power-management timer.
        # wlopm is avoided entirely: once wlopm powers an output off, the
        # output vanishes from the power-manager protocol so wlopm --on cannot
        # find it and wlr-randr --on is rejected by the compositor. The only
        # escape from that deadlock is a full compositor restart.
        r = subprocess.run(["wlr-randr"] + off_args, timeout=10, env=env, capture_output=True)
        if r.returncode != 0:
            _log.warning("wlr-randr off(cycle) rc=%d: %s", r.returncode, r.stderr.decode(errors="replace"))

        time.sleep(0.5)

        on_args: list[str] = []
        for i, output in enumerate(outputs):
            on_args += ["--output", output, "--on"]
            if mode:
                on_args += ["--mode", mode, "--pos", f"{i * w},0"]
        r = subprocess.run(["wlr-randr"] + on_args, timeout=10, env=env, capture_output=True)
        if r.returncode != 0:
            _log.warning("wlr-randr on rc=%d: %s", r.returncode, r.stderr.decode(errors="replace"))
    else:
        r = subprocess.run(["wlr-randr"] + off_args, timeout=10, env=env, capture_output=True)
        if r.returncode != 0:
            _log.warning("wlr-randr off rc=%d: %s", r.returncode, r.stderr.decode(errors="replace"))

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
    _display_on = body.on
    env = _wayland_env()
    _wlopm(body.on, env)
    _log.info("Display %s", "ON" if body.on else "OFF")
    return {"on": _display_on}