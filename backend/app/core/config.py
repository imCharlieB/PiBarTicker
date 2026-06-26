from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .paths import get_runtime_paths


class AppBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MonitorConfig(AppBaseModel):
    mode: Literal["single", "dual"] = "single"
    width: int = 1920
    height: int = 380
    swapOutputs: bool = False


class KioskConfig(AppBaseModel):
    autoStart: Literal["disabled", "autostart"] = "autostart"
    chromiumFlags: list[str] = Field(
        default_factory=lambda: [
            "--noerrdialogs",
            "--disable-infobars",
            "--force-device-scale-factor=1",
            "--enable-gpu-rasterization",
            "--enable-zero-copy",
            "--disable-smooth-scrolling",
            "--overscroll-history-navigation=0",
            "--disable-translate",
            "--disable-features=TranslateUI",
            "--enable-features=OverlayScrollbar",
            "--disable-webgpu",
            "--disable-session-crashed-bubble",
            "--check-for-update-interval=31536000",
        ]
    )


class TeamThemeConfig(AppBaseModel):
    enabled: bool = False
    league: str = "nfl"
    team: str = "ARI"


class ThemeConfig(AppBaseModel):
    mode: Literal["dark", "light", "team"] = "dark"
    background: str = ""
    accent: str = ""
    teamTheme: TeamThemeConfig = Field(default_factory=TeamThemeConfig)

    # Ticker background watermark (faint logo behind the games)
    tickerWatermarkEnabled: bool = True
    tickerWatermarkUseTeam: bool = True  # when enabled + team theme active, auto-use the team's logo

    clockFormat: Literal["12h", "24h"] = "12h"


class LeagueConfig(AppBaseModel):
    id: str
    name: str
    url: str
    logo: str = ""
    enabled: bool = True
    showTV: bool = True
    showNews: bool = False
    showInTicker: bool = True
    liveGameMode: bool = False
    density: Literal["min", "bal", "max"] = "bal"
    colorMode: Literal["full", "accent", "neutral"] = "full"
    gameFilter: Literal["all", "live", "today", "upcoming", "this-week"] = "all"
    useWeekFilter: bool = False
    fallbackWhenEmpty: bool = False
    includedTeams: list[str] = Field(default_factory=list)
    includedGroups: list[str] = Field(default_factory=list)
    cardStyle: str = "standard"
    entryLimit: int | None = None  # None = show all; used by racing to cap driver list
    rankingsFilter: int | None = None  # None = no filter; for college leagues, show only games with a top-N ranked team


class SportsBoardConfig(AppBaseModel):
    id: str = "live-sports"
    type: Literal["sports"] = "sports"
    name: str = "Live Scores"
    enabled: bool = True
    rotateSeconds: int = 45
    scroll: bool = True
    refreshSeconds: int = 45
    skipIfEmpty: bool = False
    scrollSpeed: int = 110   # px/s — how fast cards scroll across the display
    cardGap: int = 50        # px — gap between game cards
    watermarkCount: int = 2  # how many watermark copies to tile across the display (1, 2, or 4)
    leagues: list[LeagueConfig] = Field(default_factory=list)


class HAEntityConfig(AppBaseModel):
    entityId: str
    label: str = ""
    unit: str = ""
    position: Literal["none", "ticker", "top-left", "top-right", "bottom-left", "bottom-right"] = "ticker"
    cardId: str = ""


class HACardConfig(AppBaseModel):
    id: str
    title: str
    sub: str = ""
    variant: Literal["home", "weather", "printer"] = "home"
    enabled: bool = True
    hourlySensorId: str = ""
    dailySensorId: str = ""


class HomeAssistantBoardConfig(AppBaseModel):
    id: str = "ha-bar"
    type: Literal["home-assistant"] = "home-assistant"
    name: str = "Home Assistant"
    enabled: bool = True
    slotIndex: int = -1  # position in ticker rotation: 0=before first league, -1=end
    haSensors: list[HAEntityConfig] = Field(default_factory=list)
    haCards: list[HACardConfig] = Field(default_factory=list)


BoardConfig = Annotated[
    SportsBoardConfig | HomeAssistantBoardConfig,
    Field(discriminator="type"),
]


class PanelConfig(AppBaseModel):
    id: str
    type: Literal["ha"] = "ha"  # "weather" and "news" added in Phase 3/4
    position: Literal["bottom", "top", "left", "right"] = "bottom"
    size: int = 20  # percent of screen height (top/bottom) or width (left/right)
    enabled: bool = True


class LayoutConfig(AppBaseModel):
    mode: Literal["unified-scroll", "grid"] = "unified-scroll"
    panels: list[PanelConfig] = Field(default_factory=list)


class AppConfig(AppBaseModel):
    monitor: MonitorConfig = Field(default_factory=MonitorConfig)
    kiosk: KioskConfig = Field(default_factory=KioskConfig)
    boards: list[BoardConfig] = Field(default_factory=list)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    layout: LayoutConfig = Field(default_factory=LayoutConfig)


def default_config() -> AppConfig:
    return AppConfig(
        boards=[
            SportsBoardConfig(
                leagues=[
                    LeagueConfig(
                        id="nfl",
                        name="NFL",
                        url="https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
                        useWeekFilter=False,
                        gameFilter="all",
                        fallbackWhenEmpty=False,
                    ),
                    LeagueConfig(
                        id="mlb",
                        name="MLB",
                        url="https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
                        useWeekFilter=False,
                        gameFilter="all",
                        fallbackWhenEmpty=False,
                    ),
                    LeagueConfig(
                        id="nba",
                        name="NBA",
                        url="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
                        useWeekFilter=False,
                        gameFilter="all",
                        fallbackWhenEmpty=False,
                    ),
                    LeagueConfig(
                        id="nhl",
                        name="NHL",
                        url="https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
                        useWeekFilter=False,
                        gameFilter="all",
                        fallbackWhenEmpty=False,
                    ),
                ]
            ),
            HomeAssistantBoardConfig(),
        ]
    )


def config_file_path() -> Path:
    return get_runtime_paths().config_file


class ConfigStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = Lock()

    def load(self) -> AppConfig:
        with self._lock:
            if not self._path.exists():
                config = default_config()
                self._write_unlocked(config)
                return config

            raw_text = self._path.read_text(encoding="utf-8")
            data = json.loads(raw_text)

            # Migration: remove deprecated top-level config blocks.
            changed = False
            for _deprecated_key in ("homeAssistant", "http"):
                if _deprecated_key in data:
                    data.pop(_deprecated_key)
                    changed = True

            # Migration: strip rotateSeconds from home-assistant board (removed field).
            _boards = data.get("boards")
            if isinstance(_boards, list):
                for _board in _boards:
                    if isinstance(_board, dict) and _board.get("type") == "home-assistant":
                        if "rotateSeconds" in _board:
                            _board.pop("rotateSeconds")
                            changed = True

            # One-time hygiene: strip fields removed from LeagueConfig so strict
            # extra="forbid" validation passes on old config.json files.
            _LEGACY_LEAGUE_KEYS = {
                "teamStyles",
                "showOdds",
                "useTeamCardColors",
                "showLiveState",
                "showStatRecords",
                "showStatClock",
                "showStatSituation",
                "showStatVenue",
                "showStatOdds",
            }
            boards = data.get("boards")
            if isinstance(boards, list):
                for board in boards:
                    leagues = board.get("leagues") if isinstance(board, dict) else None
                    if isinstance(leagues, list):
                        for league in leagues:
                            if isinstance(league, dict):
                                for key in _LEGACY_LEAGUE_KEYS:
                                    if key in league:
                                        league.pop(key)
                                        changed = True

            # Migrate haSensors from list[str] to list[HASensorConfig]
            boards = data.get("boards")
            if isinstance(boards, list):
                for board in boards:
                    if isinstance(board, dict) and board.get("type") == "home-assistant":
                        sensors = board.get("haSensors")
                        if isinstance(sensors, list) and any(isinstance(s, str) for s in sensors):
                            board["haSensors"] = [
                                {"entityId": s, "label": "", "unit": "", "position": "ticker"}
                                if isinstance(s, str) else s
                                for s in sensors
                            ]
                            changed = True

            # Migration: strip known-bad Chromium flags and normalize --enable-features.
            _kiosk_data = data.get("kiosk")
            if isinstance(_kiosk_data, dict):
                _flags = _kiosk_data.get("chromiumFlags")
                if isinstance(_flags, list):
                    _BAD = {
                        "--no-decommit-pooled-pages",
                        "--kiosk",
                        "--ozone-platform=wayland",
                        "--ozone-platform=x11",
                        "--use-gl=egl",
                        "--start-maximized",
                        "--ignore-gpu-blocklist",
                    }
                    _WAYLAND_FEATURES = {"WaylandWindowDecorations", "VaapiVideoDecoder"}
                    _cleaned = []
                    for _f in _flags:
                        _s = str(_f).strip()
                        if _s in _BAD:
                            changed = True
                            continue
                        if _s.startswith("--enable-features="):
                            _parts = [p for p in _s[len("--enable-features="):].split(",") if p not in _WAYLAND_FEATURES]
                            _norm = f"--enable-features={','.join(_parts)}" if _parts else None
                            if _norm != _s:
                                changed = True
                                if _norm:
                                    _cleaned.append(_norm)
                                continue
                        _cleaned.append(_s)
                    if changed:
                        _kiosk_data["chromiumFlags"] = _cleaned

            # Migration: strip old layout fields (tickerPosition, tickerSize, gridRows, gridCols)
            # replaced by panels list in LayoutConfig.
            _layout_data = data.get("layout")
            _LEGACY_LAYOUT_KEYS = {"tickerPosition", "tickerSize", "gridRows", "gridCols", "panels"}
            if isinstance(_layout_data, dict):
                for _key in list(_LEGACY_LAYOUT_KEYS):
                    if _key in _layout_data and _key not in {"panels"}:
                        _layout_data.pop(_key)
                        changed = True
                # Also clear panels that have old PanelConfig shape (gridArea field)
                if isinstance(_layout_data.get("panels"), list):
                    _clean_panels = [
                        p for p in _layout_data["panels"]
                        if isinstance(p, dict) and "gridArea" not in p
                    ]
                    if len(_clean_panels) != len(_layout_data["panels"]):
                        _layout_data["panels"] = _clean_panels
                        changed = True

            if changed:
                self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")

            try:
                return AppConfig.model_validate(data)
            except Exception:
                import logging
                logging.getLogger(__name__).warning(
                    "config.json failed validation — resetting to defaults. "
                    "Previous config backed up to config.json.bak"
                )
                bak = self._path.with_suffix(".json.bak")
                try:
                    bak.write_text(json.dumps(data, indent=2), encoding="utf-8")
                except Exception:
                    pass
                config = default_config()
                self._write_unlocked(config)
                return config

    def save(self, config: AppConfig) -> AppConfig:
        with self._lock:
            self._write_unlocked(config)
            return config

    def reset(self) -> AppConfig:
        with self._lock:
            config = default_config()
            self._write_unlocked(config)
            return config

    def _write_unlocked(self, config: AppConfig) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(config.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )


config_store = ConfigStore(config_file_path())
