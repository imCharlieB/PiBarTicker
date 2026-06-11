from fastapi import APIRouter

from ..core.config import AppConfig, config_store


router = APIRouter(prefix="/api/v1/config", tags=["config"])

_config_version = 0


@router.get("", response_model=AppConfig)
def get_config() -> AppConfig:
    return config_store.load()


@router.get("/version")
def get_config_version() -> dict:
    return {"version": _config_version}


@router.put("", response_model=AppConfig)
def update_config(config: AppConfig) -> AppConfig:
    global _config_version
    _config_version += 1
    return config_store.save(config)


@router.post("/reset", response_model=AppConfig)
def reset_config() -> AppConfig:
    global _config_version
    _config_version += 1
    return config_store.reset()
