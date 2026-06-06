from __future__ import annotations

from fastapi import APIRouter

from . import discover, scoreboard, teams

router = APIRouter(prefix="/api/v1/espn", tags=["espn"])
router.include_router(scoreboard.router)
router.include_router(teams.router)
router.include_router(discover.router)
