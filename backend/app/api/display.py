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


def _load_cached_output() -> str | None:
    try:
        if _OUTPUT_CACHE_FILE.exists():
            return json.loads(_OUTPUT_CACHE_FILE.read_text())
    except Exception:
        pass
    return None


def _save_cached_output(name: str) -> None:
    try:
        _OUTPUT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _OUTPUT_CACHE_FILE.write_text(json.dumps(name))
    except Exception:
        pass


_cached_output: str | None = _load_cached_output()


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


@router.get("/diagnose")
def diagnose_display() -> dict:
    env = _wayland_env()
    detected = _detect_output(env)
    try:
        raw = subprocess.run(["wlr-randr"], capture_output=True, text=True, timeout=5, env=env)
        wlr_stdout = raw.stdout
        wlr_stderr = raw.stderr
        wlr_rc = raw.returncode
    except Exception as e:
        wlr_stdout, wlr_stderr, wlr_rc = "", str(e), -1
    return {
        "display_on": _display_on,
        "cached_output": _cached_output,
        "detected_output": detected,
        "wayland_display": env.get("WAYLAND_DISPLAY"),
        "xdg_runtime_dir": env.get("XDG_RUNTIME_DIR"),
        "wlr_randr_rc": wlr_rc,
        "wlr_randr_stdout": wlr_stdout,
        "wlr_randr_stderr": wlr_stderr,
    }


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on, _cached_output

    if not shutil.which("wlr-randr"):
        raise HTTPException(status_code=503, detail="wlr-randr not available")

    env = _wayland_env()
    output = _detect_output(env) or _cached_output
    if not output:
        raise HTTPException(
            status_code=503,
            detail=f"No output detected and no cached output name (WAYLAND_DISPLAY={env.get('WAYLAND_DISPLAY')})",
        )

    # Always save the output name — persists across backend restarts
    if output != _cached_output:
        _cached_output = output
        _save_cached_output(output)

    try:
        flag = "--on" if body.on else "--off"
        subprocess.run(
            ["wlr-randr", "--output", output, flag],
            check=True, timeout=10, env=env,
        )
    except subprocess.CalledProcessError as exc:
        if not body.on:
            raise HTTPException(status_code=500, detail=f"Display off failed: {exc}")
        _log.warning("Display turn-on failed (kiosk will still restart): %s", exc)

    _display_on = body.on
    return {"on": _display_on}
