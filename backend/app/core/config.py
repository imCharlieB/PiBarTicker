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


class LeagueConfig(AppBaseModel):
    id: str
    name: str
    url: str
    logo: str = ""
    enabled: bool = True
    showTV: bool = True
    showOdds: bool = False
    showNews: bool = False
    showInTicker: bool = True
    liveGameMode: bool = False
    useTeamCardColors: bool = False
    showLiveState: bool = False
    showStatRecords: bool = True
    showStatClock: bool = True
    showStatSituation: bool = True
    showStatVenue: bool = False
    showStatOdds: bool = False
    gameFilter: Literal["all", "live", "today", "upcoming", "this-week"] = "all"
    useWeekFilter: bool = False
    fallbackWhenEmpty: bool = False
    includedTeams: list[str] = Field(default_factory=list)
    includedGroups: list[str] = Field(default_factory=list)
    teamStyles: dict[str, dict[str, str]] = Field(default_factory=dict)


class SportsBoardConfig(AppBaseModel):
    id: str = "live-sports"
    type: Literal["sports"] = "sports"
    name: str = "Live Scores"
    enabled: bool = True
    rotateSeconds: int = 45
    scroll: bool = True
    refreshSeconds: int = 45
    skipIfEmpty: bool = False
    leagues: list[LeagueConfig] = Field(default_factory=list)


class HomeAssistantBoardConfig(AppBaseModel):
    id: str = "ha-bar"
    type: Literal["home-assistant"] = "home-assistant"
    name: str = "Home Assistant"
    enabled: bool = True
    haSensors: list[str] = Field(default_factory=list)


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

            return AppConfig.model_validate_json(self._path.read_text(encoding="utf-8"))

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
