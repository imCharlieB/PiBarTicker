import json
import logging
import os
import re
import subprocess

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.config import config_store
from ..core.paths import get_runtime_paths

router = APIRouter(prefix="/api/v1/display", tags=["display"])

_log = logging.getLogger(__name__)

_OUTPUT_CACHE_FILE = get_runtime_paths().runtime_cache / "display_output.json"
_POWER_STATE_FILE = get_runtime_paths().runtime_cache / "display_power.json"


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


def _load_power_state() -> bool:
    try:
        if _POWER_STATE_FILE.exists():
            data = json.loads(_POWER_STATE_FILE.read_text())
            if isinstance(data, dict):
                return bool(data.get("on", True))
    except Exception:
        pass
    return True


def _save_power_state(on: bool) -> None:
    try:
        _POWER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _POWER_STATE_FILE.write_text(json.dumps({"on": on}))
    except Exception:
        pass


_cached_outputs: list[str] = _load_cached_outputs()
_display_on: bool = _load_power_state()


def _x11_env() -> dict:
    env = os.environ.copy()
    if not env.get("DISPLAY"):
        env["DISPLAY"] = ":0"
    return env


def _detect_outputs(env: dict) -> list[str]:
    try:
        result = subprocess.run(
            ["xrandr"], capture_output=True, text=True, timeout=5, env=env
        )
        return [
            line.split()[0]
            for line in result.stdout.splitlines()
            if " connected" in line
        ]
    except Exception:
        pass
    return []


def _xrandr_power(on: bool, env: dict) -> None:
    global _cached_outputs

    if on:
        outputs = _cached_outputs or _detect_outputs(env)
    else:
        outputs = _detect_outputs(env)
        if outputs:
            _cached_outputs = outputs
            _save_cached_outputs(outputs)

    if not outputs:
        _log.warning("No X11 outputs detected; cannot control display power")
        return

    try:
        cfg = config_store.load()
        mode = f"{cfg.monitor.width}x{cfg.monitor.height}"
        swap = cfg.monitor.swapOutputs and len(outputs) >= 2
        w = cfg.monitor.width
    except Exception:
        mode = ""
        swap = False
        w = 1920

    _log.warning("display %s outputs=%s mode=%s DISPLAY=%s", "ON" if on else "OFF", outputs, mode, env.get("DISPLAY"))

    if swap:
        outputs = [outputs[1], outputs[0]] + list(outputs[2:])

    if on:
        for i, output in enumerate(outputs):
            if mode:
                cmd = ["xrandr", "--output", output, "--mode", mode, "--pos", f"{i * w}x0"]
            else:
                cmd = ["xrandr", "--output", output, "--auto"]
            r = subprocess.run(cmd, timeout=10, env=env, capture_output=True)
            if r.returncode == 0:
                _log.warning("xrandr %s OK", " ".join(cmd[1:]))
            else:
                _log.warning("xrandr %s rc=%d: %s", " ".join(cmd[1:]), r.returncode, r.stderr.decode(errors="replace"))
    else:
        for output in outputs:
            cmd = ["xrandr", "--output", output, "--off"]
            r = subprocess.run(cmd, timeout=10, env=env, capture_output=True)
            if r.returncode != 0:
                _log.warning("xrandr %s rc=%d: %s", " ".join(cmd[1:]), r.returncode, r.stderr.decode(errors="replace"))


def _parse_xrandr_resolution(stdout: str) -> tuple[int, int] | None:
    m = re.search(r"current\s+(\d+)\s*x\s*(\d+)", stdout)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"^\s+(\d+)x(\d+)\s+[\d.]+\*", stdout, re.MULTILINE)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


class DisplayPowerRequest(BaseModel):
    on: bool


def _parse_active_outputs(stdout: str) -> tuple[list[str], int | None, int | None]:
    """Return (active_output_names, first_width, first_height).

    An output is "active" only if its xrandr header line includes a geometry
    like 1920x380+0+0, meaning it is actually driving pixels. Outputs that
    are electrically connected but have no mode set have no geometry on their
    header line and are excluded.
    """
    active_outputs: list[str] = []
    width: int | None = None
    height: int | None = None
    for line in stdout.splitlines():
        if " connected" not in line:
            continue
        m = re.search(r"\b(\d+)x(\d+)\+\d+\+\d+", line)
        if m:
            active_outputs.append(line.split()[0])
            if width is None:
                width = int(m.group(1))
                height = int(m.group(2))
    return active_outputs, width, height


def _connected_output_names(stdout: str) -> list[str]:
    return [
        line.split()[0]
        for line in stdout.splitlines()
        if " connected" in line
    ]


@router.get("/resolution")
def get_display_resolution() -> dict:
    env = _x11_env()
    try:
        result = subprocess.run(
            ["xrandr"], capture_output=True, text=True, timeout=5, env=env
        )
        if result.returncode != 0:
            return {"detected": False, "width": None, "height": None, "outputs": []}

        active_outputs, width, height = _parse_active_outputs(result.stdout)

        if active_outputs and width is not None:
            return {"detected": True, "width": width, "height": height, "outputs": active_outputs}

        # No output is actively driving a mode — the monitor may not support the
        # currently configured resolution. Run xrandr --auto on each connected
        # output so the display can negotiate its preferred resolution, then
        # re-read to find out what it settled on.
        connected = _connected_output_names(result.stdout)
        if not connected:
            return {"detected": False, "width": None, "height": None, "outputs": []}

        _log.warning("No active xrandr geometry found; running --auto on %s", connected)
        for name in connected:
            subprocess.run(
                ["xrandr", "--output", name, "--auto"],
                timeout=10, env=env, capture_output=True,
            )

        result2 = subprocess.run(
            ["xrandr"], capture_output=True, text=True, timeout=5, env=env
        )
        if result2.returncode == 0:
            active_outputs, width, height = _parse_active_outputs(result2.stdout)
            if active_outputs and width is not None:
                return {"detected": True, "width": width, "height": height, "outputs": active_outputs}

        return {"detected": False, "width": None, "height": None, "outputs": []}
    except Exception:
        return {"detected": False, "width": None, "height": None, "outputs": []}


@router.get("/power")
def get_display_power() -> dict:
    return {"on": _display_on}


@router.get("/diagnose")
def diagnose_display() -> dict:
    env = _x11_env()
    detected = _detect_outputs(env)
    try:
        raw = subprocess.run(["xrandr"], capture_output=True, text=True, timeout=5, env=env)
        xrandr_stdout = raw.stdout
        xrandr_stderr = raw.stderr
        xrandr_rc = raw.returncode
    except Exception as e:
        xrandr_stdout, xrandr_stderr, xrandr_rc = "", str(e), -1
    return {
        "display_on": _display_on,
        "cached_outputs": _cached_outputs,
        "detected_outputs": detected,
        "display": env.get("DISPLAY"),
        "xrandr_rc": xrandr_rc,
        "xrandr_stdout": xrandr_stdout,
        "xrandr_stderr": xrandr_stderr,
    }


@router.post("/power")
def set_display_power(body: DisplayPowerRequest) -> dict:
    global _display_on
    _display_on = body.on
    _save_power_state(body.on)
    env = _x11_env()
    _xrandr_power(body.on, env)
    _log.info("Display %s", "ON" if body.on else "OFF")
    return {"on": _display_on}
