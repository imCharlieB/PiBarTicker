from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.espn_normalizer import (
    _extract_competitors,
    _map_live_state,
    _parse_event_datetime,
    _racing_entries,
    _safe_int,
    _team_model,
    normalize_scoreboard_events,
)
from app.core.espn_registry import EspnLeagueRegistryEntry


# ---------------------------------------------------------------------------
# _safe_int
# ---------------------------------------------------------------------------

def test_safe_int_integer():
    assert _safe_int(3) == 3


def test_safe_int_string():
    assert _safe_int("7") == 7


def test_safe_int_whitespace_string():
    assert _safe_int(" 2 ") == 2


def test_safe_int_none():
    assert _safe_int(None) is None


def test_safe_int_empty_string():
    assert _safe_int("") is None


def test_safe_int_non_numeric():
    assert _safe_int("abc") is None


# ---------------------------------------------------------------------------
# _parse_event_datetime
# ---------------------------------------------------------------------------

def test_parse_event_datetime_z_suffix():
    dt = _parse_event_datetime("2026-06-01T18:00:00Z")
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.tzinfo == timezone.utc


def test_parse_event_datetime_offset():
    dt = _parse_event_datetime("2026-06-01T18:00:00+00:00")
    assert dt is not None


def test_parse_event_datetime_none():
    assert _parse_event_datetime(None) is None


def test_parse_event_datetime_empty():
    assert _parse_event_datetime("") is None


def test_parse_event_datetime_invalid():
    assert _parse_event_datetime("not-a-date") is None


# ---------------------------------------------------------------------------
# _extract_competitors
# ---------------------------------------------------------------------------

def _make_event(away_id: str, home_id: str) -> dict:
    return {
        "competitions": [
            {
                "competitors": [
                    {"homeAway": "away", "team": {"id": away_id}},
                    {"homeAway": "home", "team": {"id": home_id}},
                ]
            }
        ]
    }


def test_extract_competitors_identifies_home_and_away():
    home, away = _extract_competitors(_make_event("10", "20"))
    assert home["team"]["id"] == "20"
    assert away["team"]["id"] == "10"


def test_extract_competitors_empty_event():
    home, away = _extract_competitors({})
    assert home is None
    assert away is None


def test_extract_competitors_no_competitions():
    home, away = _extract_competitors({"competitions": []})
    assert home is None
    assert away is None


# ---------------------------------------------------------------------------
# _team_model
# ---------------------------------------------------------------------------

def test_team_model_full():
    competitor = {
        "homeAway": "home",
        "score": "7",
        "winner": True,
        "team": {
            "id": "1",
            "displayName": "Patriots",
            "abbreviation": "NE",
            "slug": "new-england-patriots",
            "logos": [{"href": "https://example.com/logo.png"}],
        },
        "records": [{"summary": "12-5"}],
    }
    result = _team_model(competitor)
    assert result["id"] == "1"
    assert result["name"] == "Patriots"
    assert result["logo"] == "https://example.com/logo.png"
    assert result["record"] == "12-5"
    assert result["winner"] is True
    assert result["score"] == "7"


def test_team_model_none_input():
    assert _team_model(None) is None


def test_team_model_missing_logos_and_records():
    competitor = {"homeAway": "away", "team": {"id": "2", "displayName": "Bills"}}
    result = _team_model(competitor)
    assert result["logo"] == ""
    assert result["record"] == ""


# ---------------------------------------------------------------------------
# _racing_entries
# ---------------------------------------------------------------------------

def test_racing_entries_basic():
    competition = {
        "competitors": [
            {
                "id": "33",
                "order": 1,
                "winner": True,
                "score": "1",
                "athlete": {
                    "displayName": "Max Verstappen",
                    "shortName": "M. Verstappen",
                    "flag": {"href": "https://example.com/flag.png", "alt": "NED"},
                },
                "statistics": [
                    {"abbreviation": "LAP", "displayValue": "57"},
                    {"abbreviation": "POS", "displayValue": "1"},
                ],
            }
        ]
    }
    entries = _racing_entries(competition)
    assert len(entries) == 1
    e = entries[0]
    assert e["name"] == "Max Verstappen"
    assert e["position"] == 1
    assert e["winner"] is True
    assert e["stats"][0]["label"] == "LAP"
    assert e["stats"][0]["value"] == "57"


def test_racing_entries_empty_competition():
    assert _racing_entries({}) == []


def test_racing_entries_skips_nameless():
    competition = {
        "competitors": [
            {"id": "99", "order": 1, "athlete": {}, "statistics": []},
        ]
    }
    assert _racing_entries(competition) == []


def test_racing_entries_stats_capped_at_four():
    competition = {
        "competitors": [
            {
                "id": "1",
                "order": 1,
                "athlete": {"displayName": "Driver One"},
                "statistics": [
                    {"abbreviation": f"S{i}", "displayValue": str(i)} for i in range(6)
                ],
            }
        ]
    }
    entries = _racing_entries(competition)
    assert len(entries[0]["stats"]) == 4


# ---------------------------------------------------------------------------
# _map_live_state — sport-specific
# ---------------------------------------------------------------------------

def test_map_live_state_not_in_returns_none():
    result = _map_live_state(
        sport="football",
        status_type={"state": "post", "detail": "Final"},
        status={"displayClock": "0:00", "period": 4},
        competition={},
    )
    assert result is None


def test_map_live_state_football():
    result = _map_live_state(
        sport="football",
        status_type={"state": "in", "detail": "Q2 5:30"},
        status={"displayClock": "5:30", "period": 2},
        competition={"situation": {"downDistanceText": "2nd & 10"}},
    )
    assert result is not None
    assert result["sport"] == "football"
    assert result["quarter"] == 2
    assert result["clock"] == "5:30"
    assert result["downDistanceText"] == "2nd & 10"


def test_map_live_state_baseball():
    result = _map_live_state(
        sport="baseball",
        status_type={"state": "in", "detail": "T3"},
        status={"displayClock": "0:00", "period": 3},
        competition={
            "situation": {
                "outs": 2,
                "balls": 1,
                "strikes": 2,
                "onFirst": True,
                "onSecond": False,
                "onThird": False,
            }
        },
    )
    assert result is not None
    assert result["sport"] == "baseball"
    assert result["inning"] == 3
    assert result["outs"] == 2
    assert result["balls"] == 1
    assert result["strikes"] == 2
    assert result["onFirst"] is True
    assert result["onSecond"] is False


def test_map_live_state_basketball():
    result = _map_live_state(
        sport="basketball",
        status_type={"state": "in", "detail": "Q3 2:15"},
        status={"displayClock": "2:15", "period": 3},
        competition={},
    )
    assert result is not None
    assert result["sport"] == "basketball"
    assert result["quarter"] == 3
    assert result["clock"] == "2:15"


def test_map_live_state_hockey():
    result = _map_live_state(
        sport="hockey",
        status_type={"state": "in", "detail": "3rd 4:00"},
        status={"displayClock": "4:00", "period": 3},
        competition={},
    )
    assert result is not None
    assert result["sport"] == "hockey"
    assert result["period"] == 3
    assert result["clock"] == "4:00"


def test_map_live_state_unknown_sport_generic():
    result = _map_live_state(
        sport="soccer",
        status_type={"state": "in", "detail": "45'"},
        status={"displayClock": "45:00", "period": 1},
        competition={},
    )
    assert result is not None
    assert result["sport"] == "soccer"
    assert result["period"] == 1


# ---------------------------------------------------------------------------
# normalize_scoreboard_events
# ---------------------------------------------------------------------------

_NFL = EspnLeagueRegistryEntry("nfl", "football", "nfl")
_MLB = EspnLeagueRegistryEntry("mlb", "baseball", "mlb")
_F1 = EspnLeagueRegistryEntry("f1", "racing", "f1")


def _make_scoreboard_event(
    event_id: str = "401",
    state: str = "pre",
    completed: bool = False,
    situation: dict | None = None,
    clock: str = "0:00",
    period: int = 0,
    detail: str = "",
) -> dict:
    competition: dict = {
        "competitors": [
            {
                "homeAway": "home",
                "score": "0",
                "team": {"id": "2", "displayName": "Bills", "abbreviation": "BUF"},
            },
            {
                "homeAway": "away",
                "score": "0",
                "team": {"id": "17", "displayName": "Patriots", "abbreviation": "NE"},
            },
        ],
        "venue": {
            "fullName": "Highmark Stadium",
            "address": {"city": "Orchard Park", "state": "NY"},
        },
        "broadcasts": [],
        "odds": [],
    }
    if situation is not None:
        competition["situation"] = situation

    return {
        "id": event_id,
        "date": "2026-09-10T20:20:00Z",
        "shortName": "NE @ BUF",
        "status": {
            "type": {
                "state": state,
                "completed": completed,
                "detail": detail,
                "shortDetail": detail,
            },
            "displayClock": clock,
            "period": period,
        },
        "competitions": [competition],
    }


def test_normalize_pre_game():
    games = normalize_scoreboard_events(entry=_NFL, events=[_make_scoreboard_event()])
    assert len(games) == 1
    g = games[0]
    assert g["id"] == "401"
    assert g["sport"] == "football"
    assert g["state"] == "pre"
    assert g["isLive"] is False
    assert g["isCompleted"] is False
    assert g["liveState"] is None
    assert g["teams"]["home"]["abbreviation"] == "BUF"
    assert g["teams"]["away"]["abbreviation"] == "NE"


def test_normalize_live_football():
    event = _make_scoreboard_event(
        state="in",
        clock="5:30",
        period=2,
        detail="Q2 5:30",
        situation={"downDistanceText": "1st & 10"},
    )
    games = normalize_scoreboard_events(entry=_NFL, events=[event])
    g = games[0]
    assert g["isLive"] is True
    assert g["liveState"] is not None
    assert g["liveState"]["sport"] == "football"
    assert g["liveState"]["quarter"] == 2


def test_normalize_completed_game():
    event = _make_scoreboard_event(state="post", completed=True)
    games = normalize_scoreboard_events(entry=_NFL, events=[event])
    g = games[0]
    assert g["isCompleted"] is True
    assert g["isLive"] is False


def test_normalize_empty_events():
    games = normalize_scoreboard_events(entry=_NFL, events=[])
    assert games == []


def test_normalize_racing_has_empty_entries_when_no_competitors():
    event = _make_scoreboard_event()
    # Racing events get racingEntries populated; our event has standard team competitors, not athletes
    games = normalize_scoreboard_events(entry=_F1, events=[event])
    g = games[0]
    assert "racingEntries" in g
    # No athlete entries in the test event → empty list
    assert isinstance(g["racingEntries"], list)


def test_normalize_startsInMinutes_is_int_or_none():
    event = _make_scoreboard_event()
    now = datetime(2026, 9, 10, 20, 0, 0, tzinfo=timezone.utc)
    games = normalize_scoreboard_events(entry=_NFL, events=[event], now_utc=now)
    assert games[0]["startsInMinutes"] == 20  # 20 minutes until 20:20
