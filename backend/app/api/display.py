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


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on, _cached_outputs

    env = _wayland_env()

    if not body.on:
        # Kill Chromium first so the compositor has no active client.
        subprocess.run(
            ["pkill", "-f", "user-data-dir=/tmp/pibarticker-kiosk"],
            timeout=5,
        )

    # ddcutil talks directly to the monitor over HDMI DDC/CI, bypassing the
    # Wayland compositor and any idle daemon. Try it first — it works even after
    # the compositor has put the output to sleep.
    if _ddcutil_power(body.on):
        _log.info("Display %s via ddcutil", "on" if body.on else "off")
        _display_on = body.on
        return {"on": _display_on}

    # Fallback: wlopm / wlr-randr via Wayland compositor
    _log.info("ddcutil unavailable or failed, falling back to wlopm/wlr-randr")

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

    errors = []
    for output in outputs:
        try:
            if has_wlopm:
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
