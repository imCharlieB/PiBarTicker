import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

_alerts: dict[str, dict] = {}


def _prune() -> None:
    now = time.time()
    expired = [k for k, v in _alerts.items() if v["expires_at"] is not None and v["expires_at"] < now]
    for k in expired:
        del _alerts[k]


class AlertRequest(BaseModel):
    message: str
    level: Literal["info", "warning", "critical"] = "info"
    ttl: int = 30  # seconds; 0 = never expires
    key: str = ""  # named key; if set, replaces any existing alert with the same key


@router.get("")
def get_alerts() -> list[dict]:
    _prune()
    return list(_alerts.values())


@router.post("", status_code=201)
def create_alert(body: AlertRequest) -> dict:
    _prune()
    alert_id = body.key.strip() or str(uuid.uuid4())
    alert = {
        "id": alert_id,
        "message": body.message,
        "level": body.level,
        "created_at": time.time(),
        "expires_at": (time.time() + body.ttl) if body.ttl > 0 else None,
    }
    _alerts[alert_id] = alert
    return alert


@router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: str) -> None:
    _alerts.pop(alert_id, None)
