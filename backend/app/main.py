from pathlib import Path
import mimetypes

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.alerts import router as alerts_router
from .api.config import router as config_router
from .api.display import router as display_router
from .api.espn import router as espn_router
from .api.ha_sensors import router as ha_sensors_router
from .api.kiosk import router as kiosk_router
from .api.logos.router import router as logos_router
from .api.news import router as news_router
from .core.config import config_store
from .core.paths import bootstrap_runtime_dirs, get_runtime_paths


app = FastAPI(
    title="PiBarTicker API",
    version="0.1.0",
    summary="Pi-first sports ticker backend",
)

app.include_router(config_router)
app.include_router(display_router)
app.include_router(alerts_router)
app.include_router(ha_sensors_router)
app.include_router(espn_router)
app.include_router(kiosk_router)
app.include_router(logos_router)
app.include_router(news_router)

# Ensure module scripts are served with a JS MIME type on Windows hosts.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

_repo_root = Path(__file__).resolve().parents[2]
_frontend_dist = _repo_root / "frontend" / "dist"
_frontend_index = _frontend_dist / "index.html"

app.mount(
    "/assets",
    StaticFiles(directory=str(_frontend_dist / "assets"), check_dir=False),
    name="frontend-assets",
)

# Serve locally cached logos
_logos_dir = get_runtime_paths().logos
app.mount(
    "/logos",
    StaticFiles(directory=str(_logos_dir), check_dir=False),
    name="team-logos",
)

def _serve_frontend_index() -> FileResponse:
    if not _frontend_index.exists():
        raise RuntimeError("Frontend build not found. Run 'npm run build' in frontend/.")
    return FileResponse(_frontend_index)


@app.on_event("startup")
def startup() -> None:
    bootstrap_runtime_dirs()
    config_store.load()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pibarticker-backend"}


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return _serve_frontend_index()


@app.get("/setup", include_in_schema=False)
@app.get("/setup/{full_path:path}", include_in_schema=False)
def setup_shell(full_path: str = "") -> FileResponse:
    _ = full_path
    return _serve_frontend_index()


# SPA fallback + serve root-level static assets (favicon.svg, pibarticker-logo.svg, etc.)
# This must come after all API routes.
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    # If the exact file exists in dist (e.g. favicon.svg, logo, etc.), serve it
    candidate = _frontend_dist / full_path
    if candidate.is_file():
        return FileResponse(candidate)

    # Otherwise serve the SPA shell
    return _serve_frontend_index()


@app.get("/api/v1/app-shell")
def app_shell() -> dict[str, object]:
    config = config_store.load()
    runtime_paths = get_runtime_paths()

    return {
        "name": "PiBarTicker",
        "phase": "phase-1",
        "surfaces": ["kiosk", "setup"],
        "modules": {
            "backend": ["config", "leagues", "logos", "scheduler"],
            "frontend": ["kiosk-display", "setup-ui"],
        },
        "configPath": str(runtime_paths.config_file),
        "runtimeCachePath": str(runtime_paths.runtime_cache),
        "teamMetaPath": str(runtime_paths.team_meta),
        "logosPath": str(runtime_paths.logos),
        "boardCount": len(config.boards),
    }
