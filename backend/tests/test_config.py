from __future__ import annotations

import json
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest
from pydantic import ValidationError

from app.core.config import (
    AppConfig,
    ConfigStore,
    LeagueConfig,
    MonitorConfig,
    SportsBoardConfig,
    ThemeConfig,
    default_config,
)


# ---------------------------------------------------------------------------
# Model validation
# ---------------------------------------------------------------------------

def test_default_config_is_valid():
    config = default_config()
    assert isinstance(config, AppConfig)


def test_default_config_has_boards():
    config = default_config()
    assert len(config.boards) >= 1


def test_appconfig_round_trip():
    config = default_config()
    data = config.model_dump(mode="json")
    reloaded = AppConfig.model_validate(data)
    assert reloaded == config


def test_league_config_extra_field_raises():
    with pytest.raises(ValidationError):
        LeagueConfig(
            id="nfl",
            name="NFL",
            url="https://example.com",
            unknown_extra_field="oops",
        )


def test_monitor_config_defaults():
    m = MonitorConfig()
    assert m.mode == "single"
    assert m.width == 1920
    assert m.height == 380


def test_league_config_defaults():
    league = LeagueConfig(id="nfl", name="NFL", url="https://example.com")
    assert league.enabled is True
    assert league.liveGameMode is False
    assert league.gameFilter == "all"
    assert league.includedTeams == []
    assert league.cardStyle == "standard"


def test_theme_config_defaults():
    theme = ThemeConfig()
    assert theme.mode == "dark"
    assert theme.tickerWatermarkEnabled is True


def test_sports_board_config_includes_leagues():
    board = SportsBoardConfig(
        leagues=[
            LeagueConfig(id="nfl", name="NFL", url="https://example.com"),
        ]
    )
    assert len(board.leagues) == 1
    assert board.leagues[0].id == "nfl"


# ---------------------------------------------------------------------------
# ConfigStore
# ---------------------------------------------------------------------------

def test_config_store_creates_default_when_missing(tmp_path: Path):
    path = tmp_path / "config.json"
    store = ConfigStore(path)
    config = store.load()
    assert isinstance(config, AppConfig)
    assert path.exists()


def test_config_store_written_file_is_valid_json(tmp_path: Path):
    path = tmp_path / "config.json"
    ConfigStore(path).load()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "boards" in data
    assert "monitor" in data


def test_config_store_save_and_load_round_trip(tmp_path: Path):
    path = tmp_path / "config.json"
    store = ConfigStore(path)
    original = default_config()
    store.save(original)
    loaded = store.load()
    assert loaded.monitor.width == original.monitor.width
    assert loaded.theme.mode == original.theme.mode


def test_config_store_reset_returns_default(tmp_path: Path):
    path = tmp_path / "config.json"
    store = ConfigStore(path)
    config = store.reset()
    assert isinstance(config, AppConfig)
    assert path.exists()


def test_config_store_strips_legacy_team_styles(tmp_path: Path):
    path = tmp_path / "config.json"
    config = default_config()
    data = config.model_dump(mode="json")

    # Inject the legacy field into the first league of the first sports board
    for board in data.get("boards", []):
        if board.get("type") == "sports" and board.get("leagues"):
            board["leagues"][0]["teamStyles"] = {"some-team": {"color": "#fff"}}
            break

    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    store = ConfigStore(path)
    loaded = store.load()

    assert isinstance(loaded, AppConfig)

    # Verify teamStyles was stripped from the saved file
    cleaned = json.loads(path.read_text(encoding="utf-8"))
    for board in cleaned.get("boards", []):
        for league in board.get("leagues", []):
            assert "teamStyles" not in league


def test_config_store_load_is_idempotent(tmp_path: Path):
    path = tmp_path / "config.json"
    store = ConfigStore(path)
    first = store.load()
    second = store.load()
    assert first == second
