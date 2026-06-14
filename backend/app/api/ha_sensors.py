from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/ha", tags=["home-assistant"])

_sensors: dict[str, dict] = {}  # entity_id -> sensor payload


class SensorPush(BaseModel):
    entity_id: str
    state: str
    unit: str = ""
    friendly_name: str = ""


@router.get("/sensors")
def get_sensors() -> list[dict]:
    return list(_sensors.values())


@router.post("/sensors")
def push_sensor(body: SensorPush) -> dict:
    payload = body.model_dump()
    _sensors[body.entity_id] = payload
    return payload
