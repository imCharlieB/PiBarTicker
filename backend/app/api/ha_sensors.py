import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..core.paths import get_runtime_paths

router = APIRouter(prefix="/api/v1/ha", tags=["home-assistant"])

_SENSOR_FILE = get_runtime_paths().runtime_cache / "ha_sensors.json"


def _load() -> dict[str, dict]:
    try:
        if _SENSOR_FILE.exists():
            return json.loads(_SENSOR_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save(sensors: dict[str, dict]) -> None:
    try:
        _SENSOR_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SENSOR_FILE.write_text(json.dumps(sensors, indent=2), encoding="utf-8")
    except Exception:
        pass


_sensors: dict[str, dict] = _load()


class SensorPush(BaseModel):
    entity_id: str
    state: str
    unit: str = ""
    friendly_name: str = ""
    domain: str = ""
    attributes: dict = Field(default_factory=dict)


@router.get("/sensors")
def get_sensors() -> list[dict]:
    return list(_sensors.values())


@router.post("/sensors")
def push_sensor(body: SensorPush) -> dict:
    payload = body.model_dump()
    if not payload["domain"]:
        payload["domain"] = body.entity_id.split(".")[0]
    _sensors[body.entity_id] = payload
    _save(_sensors)
    return payload
