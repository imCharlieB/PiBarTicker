import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/display", tags=["display"])

_display_on: bool = True  # assumed on at startup


def _wlr_randr_available() -> bool:
    return shutil.which("wlr-randr") is not None


def _detect_output() -> str | None:
    try:
        result = subprocess.run(["wlr-randr"], capture_output=True, text=True, timeout=5)
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
    global _display_on
    if not _wlr_randr_available():
        raise HTTPException(status_code=503, detail="wlr-randr not available")
    output = _detect_output()
    if not output:
        raise HTTPException(status_code=503, detail="No Wayland output detected")
    flag = "--on" if body.on else "--off"
    try:
        subprocess.run(["wlr-randr", "--output", output, flag], check=True, timeout=10)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"wlr-randr failed: {exc}")
    _display_on = body.on
    return {"on": _display_on}
