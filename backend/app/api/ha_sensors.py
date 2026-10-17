import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..core.paths import get_runtime_paths
from .ha_images import remove_cover

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
    # set when the entity belongs to a Home Assistant device (e.g. a Bambu Lab printer or AMS): lets the display group a device's sensors
    device_id: str = ""
    device_name: str = ""
    device_model: str = ""
    key: str = ""  # the integration's own entity key (e.g. print_progress, tray_1)


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


@router.delete("/sensors/{entity_id:path}")
def delete_sensor(entity_id: str) -> dict:
    _sensors.pop(entity_id, None)
    _save(_sensors)
    remove_cover(entity_id)
    return {"deleted": entity_id}
