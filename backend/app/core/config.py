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


class HomeAssistantConfig(AppBaseModel):
    url: str = ""
    token: str = ""


class HttpConfig(AppBaseModel):
    enabled: bool = False
    port: int = 8080


class KioskConfig(AppBaseModel):
    autoStart: Literal["disabled", "autostart"] = "autostart"
    chromiumFlags: list[str] = Field(
        default_factory=lambda: [
            "--kiosk",
            "--noerrdialogs",
            "--disable-infobars",
            "--force-device-scale-factor=1",
            "--enable-gpu-rasterization",
            "--ignore-gpu-blocklist",
            "--disable-smooth-scrolling",
            "--overscroll-history-navigation=0",
            "--disable-translate",
            "--disable-features=TranslateUI",
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
    scrollSpeed: int = 110  # px/s — how fast cards scroll across the display
    cardGap: int = 50       # px — gap between game cards
    leagues: list[LeagueConfig] = Field(default_factory=list)


class HASensorConfig(AppBaseModel):
    entityId: str
    label: str = ""
    unit: str = ""
    position: Literal["none", "ticker", "top-left", "top-right", "bottom-left", "bottom-right"] = "ticker"


class HomeAssistantBoardConfig(AppBaseModel):
    id: str = "ha-bar"
    type: Literal["home-assistant"] = "home-assistant"
    name: str = "Home Assistant"
    enabled: bool = True
    haSensors: list[HASensorConfig] = Field(default_factory=list)


BoardConfig = Annotated[
    SportsBoardConfig | HomeAssistantBoardConfig,
    Field(discriminator="type"),
]


class AppConfig(AppBaseModel):
    monitor: MonitorConfig = Field(default_factory=MonitorConfig)
    homeAssistant: HomeAssistantConfig = Field(default_factory=HomeAssistantConfig)
    http: HttpConfig = Field(default_factory=HttpConfig)
    kiosk: KioskConfig = Field(default_factory=KioskConfig)
    boards: list[BoardConfig] = Field(default_factory=list)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)


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
            changed = False
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

            if changed:
                self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")

            return AppConfig.model_validate(data)

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
