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
        "wlopm_available": shutil.which("wlopm") is not None,
        "wayland_display": env.get("WAYLAND_DISPLAY"),
        "xdg_runtime_dir": env.get("XDG_RUNTIME_DIR"),
        "wlr_randr_rc": wlr_rc,
        "wlr_randr_stdout": wlr_stdout,
        "wlr_randr_stderr": wlr_stderr,
    }


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on, _cached_outputs

    env = _wayland_env()

    # Refresh and persist output names while display is on
    live = _detect_outputs(env)
    if live:
        _cached_outputs = live
        _save_cached_outputs(live)

    outputs = live or _cached_outputs
    if not outputs:
        raise HTTPException(
            status_code=503,
            detail=f"No outputs detected and no cached names (WAYLAND_DISPLAY={env.get('WAYLAND_DISPLAY')})",
        )

    has_wlopm = shutil.which("wlopm") is not None
    has_wlr_randr = shutil.which("wlr-randr") is not None

    if not has_wlopm and not has_wlr_randr:
        raise HTTPException(status_code=503, detail="Neither wlopm nor wlr-randr available")

    if not body.on:
        # Kill Chromium first so the compositor has no active client.
        # Without this, the compositor re-enables the output almost immediately.
        subprocess.run(
            ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
            timeout=5,
        )

    errors = []
    for output in outputs:
        try:
            if has_wlopm:
                # wlopm = pure DPMS on/off — output stays registered in compositor,
                # just the panel powers down. No mode management, always reversible.
                flag = "--on" if body.on else "--off"
                subprocess.run(
                    ["wlopm", flag, output],
                    check=True, timeout=10, env=env,
                    capture_output=True,
                )
            else:
                flag = "--on" if body.on else "--off"
                r = subprocess.run(
                    ["wlr-randr", "--output", output, flag],
                    timeout=10, env=env,
                    capture_output=True,
                )
                if r.returncode != 0:
                    _log.warning("wlr-randr %s stderr: %s", flag, r.stderr.decode())
        except subprocess.CalledProcessError as exc:
            errors.append(f"{output}: {exc}")
        except Exception as exc:
            errors.append(f"{output}: {exc}")

    if errors and not body.on:
        raise HTTPException(status_code=500, detail=f"Display off failed: {'; '.join(errors)}")
    if errors:
        _log.warning("Display turn-on had errors (kiosk will restart anyway): %s", errors)

    _display_on = body.on
    return {"on": _display_on}
