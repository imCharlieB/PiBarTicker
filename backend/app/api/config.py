from fastapi import APIRouter

from ..core.config import AppConfig, config_store


router = APIRouter(prefix="/api/v1/config", tags=["config"])


@router.get("", response_model=AppConfig)
def get_config() -> AppConfig:
    return config_store.load()


@router.put("", response_model=AppConfig)
def update_config(config: AppConfig) -> AppConfig:
    return config_store.save(config)


@router.post("/reset", response_model=AppConfig)
def reset_config() -> AppConfig:
    return config_store.reset()
