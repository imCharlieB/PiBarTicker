from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.espn_normalizer import (
    _extract_competitors,
    _is_athlete_competition,
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

def _make_competition(away_id: str, home_id: str) -> dict:
    return {
        "competitors": [
            {"homeAway": "away", "team": {"id": away_id}},
            {"homeAway": "home", "team": {"id": home_id}},
        ]
    }


def test_extract_competitors_identifies_home_and_away():
    home, away = _extract_competitors(_make_competition("10", "20"))
    assert home["team"]["id"] == "20"
    assert away["team"]["id"] == "10"


def test_extract_competitors_empty_competition():
    home, away = _extract_competitors({})
    assert home is None
    assert away is None


def test_extract_competitors_no_competitors_key():
    home, away = _extract_competitors({"competitors": []})
    assert home is None
    assert away is None


def test_extract_competitors_fallback_order_when_no_homeaway():
    # Individual sports (MMA, etc.) don't have homeAway — fall back to order in list
    competition = {
        "competitors": [
            {"id": "1", "type": "athlete", "athlete": {"displayName": "Fighter A"}},
            {"id": "2", "type": "athlete", "athlete": {"displayName": "Fighter B"}},
        ]
    }
    home, away = _extract_competitors(competition)
    assert home["id"] == "1"
    assert away["id"] == "2"


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


def test_team_model_ufc_athlete_preferred_over_org_team():
    # UFC: ESPN attaches team.displayName = "UFC" (org) for every fighter,
    # but competitor.type = "athlete" → athlete name must win over the org name.
    competitor = {
        "id": "3134682",
        "type": "athlete",
        "homeAway": "home",
        "athlete": {
            "id": "3134682",
            "displayName": "Jon Jones",
            "shortName": "J. Jones",
        },
        "team": {
            "id": "8",
            "displayName": "UFC",
            "abbreviation": "UFC",
        },
        "records": [{"summary": "27-1-0"}],
    }
    result = _team_model(competitor)
    assert result["name"] == "Jon Jones", f"expected fighter name, got {result['name']!r}"
    assert result["abbreviation"] == "J. Jones"
    assert result["record"] == "27-1-0"


def test_team_model_athlete_fallback_mma():
    # MMA / individual sport: no team sub-object; id at competitor level, name in athlete
    competitor = {
        "id": "4881916",
        "type": "athlete",
        "winner": True,
        "athlete": {
            "displayName": "Darragh Kelly",
            "shortName": "D. Kelly",
            "flag": {"href": "https://a.espncdn.com/i/teamlogos/countries/500/irl.png", "alt": "Ireland"},
        },
        "records": [{"summary": "9-1-0"}],
    }
    result = _team_model(competitor)
    assert result["id"] == "4881916"
    assert result["name"] == "Darragh Kelly"
    assert result["abbreviation"] == "D. Kelly"
    assert result["record"] == "9-1-0"
    assert result["winner"] is True
    assert "irl.png" in result["logo"]


def test_team_model_athlete_with_logos_prefers_logo_over_flag():
    competitor = {
        "id": "99",
        "type": "athlete",
        "athlete": {
            "displayName": "Player",
            "logos": [{"href": "https://example.com/headshot.png"}],
            "flag": {"href": "https://example.com/flag.png"},
        },
    }
    result = _team_model(competitor)
    assert result["logo"] == "https://example.com/headshot.png"


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


def test_map_live_state_soccer():
    result = _map_live_state(
        sport="soccer",
        status_type={"state": "in", "detail": "45'"},
        status={"displayClock": "45:00", "period": 1},
        competition={},
    )
    assert result is not None
    assert result["sport"] == "soccer"
    assert result["half"] == 1
    assert result["clock"] == "45:00"


def test_map_live_state_unknown_sport_generic():
    result = _map_live_state(
        sport="mma",
        status_type={"state": "in", "detail": "Round 2"},
        status={"displayClock": "3:45", "period": 2},
        competition={},
    )
    assert result is not None
    assert result["sport"] == "mma"
    assert result["period"] == 2
    assert result["clock"] == "3:45"


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


# ---------------------------------------------------------------------------
# _is_athlete_competition
# ---------------------------------------------------------------------------

def test_is_athlete_competition_team_sport():
    competition = {
        "competitors": [
            {"homeAway": "home", "team": {"id": "1", "displayName": "Bills"}},
            {"homeAway": "away", "team": {"id": "2", "displayName": "Patriots"}},
        ]
    }
    assert _is_athlete_competition(competition) is False


def test_is_athlete_competition_mma_type_field():
    competition = {
        "competitors": [
            {"id": "111", "type": "athlete", "athlete": {"displayName": "Fighter A"}},
            {"id": "222", "type": "athlete", "athlete": {"displayName": "Fighter B"}},
        ]
    }
    assert _is_athlete_competition(competition) is True


def test_is_athlete_competition_no_team_id_with_competitor_id():
    # ESPN pattern where type is absent but competitor carries the id
    competition = {
        "competitors": [
            {"id": "333", "athlete": {"displayName": "Boxer A"}},
        ]
    }
    assert _is_athlete_competition(competition) is True


def test_is_athlete_competition_empty():
    assert _is_athlete_competition({}) is False
    assert _is_athlete_competition({"competitors": []}) is False


# ---------------------------------------------------------------------------
# normalize_scoreboard_events — multi-competition expansion (MMA fight card)
# ---------------------------------------------------------------------------

_MMA = EspnLeagueRegistryEntry("bellator", "mma", "bellator")


def _make_mma_competition(
    comp_id: str,
    fighter_a_id: str,
    fighter_a_name: str,
    fighter_b_id: str,
    fighter_b_name: str,
    state: str = "pre",
    weight_class: str = "Lightweight",
) -> dict:
    return {
        "id": comp_id,
        "date": "2026-06-21T22:00:00Z",
        "type": {"abbreviation": weight_class},
        "status": {
            "type": {"state": state, "completed": False, "detail": "", "shortDetail": ""},
            "displayClock": "0:00",
            "period": 0,
        },
        "competitors": [
            {"id": fighter_a_id, "type": "athlete", "athlete": {"displayName": fighter_a_name}, "score": "0"},
            {"id": fighter_b_id, "type": "athlete", "athlete": {"displayName": fighter_b_name}, "score": "0"},
        ],
    }


def _make_mma_event(comps: list[dict]) -> dict:
    return {
        "id": "9001",
        "date": "2026-06-21T22:00:00Z",
        "shortName": "Bellator 300",
        "status": {
            "type": {"state": "pre", "completed": False, "detail": "", "shortDetail": ""},
            "displayClock": "0:00",
            "period": 0,
        },
        "competitions": comps,
    }


def test_normalize_mma_fight_card_expands_to_multiple_games():
    comp_a = _make_mma_competition("c1", "101", "Fighter Alpha", "102", "Fighter Beta", weight_class="Main Event")
    comp_b = _make_mma_competition("c2", "201", "Fighter Gamma", "202", "Fighter Delta", weight_class="Lightweight")
    event = _make_mma_event([comp_a, comp_b])
    games = normalize_scoreboard_events(entry=_MMA, events=[event])
    assert len(games) == 2


def test_normalize_mma_fight_card_titles_are_per_fight():
    comp_a = _make_mma_competition("c1", "101", "Fighter Alpha", "102", "Fighter Beta")
    comp_b = _make_mma_competition("c2", "201", "Fighter Gamma", "202", "Fighter Delta")
    event = _make_mma_event([comp_a, comp_b])
    games = normalize_scoreboard_events(entry=_MMA, events=[event])
    titles = {g["title"] for g in games}
    assert "Fighter Alpha vs Fighter Beta" in titles
    assert "Fighter Gamma vs Fighter Delta" in titles


def test_normalize_mma_session_label_is_weight_class():
    comp = _make_mma_competition("c1", "101", "Fighter Alpha", "102", "Fighter Beta", weight_class="Featherweight")
    event = _make_mma_event([comp])
    games = normalize_scoreboard_events(entry=_MMA, events=[event])
    assert games[0]["sessionLabel"] == "Featherweight"


def test_normalize_mma_competitors_in_teams():
    comp = _make_mma_competition("c1", "101", "Fighter Alpha", "102", "Fighter Beta")
    event = _make_mma_event([comp])
    games = normalize_scoreboard_events(entry=_MMA, events=[event])
    g = games[0]
    home = g["teams"]["home"]
    away = g["teams"]["away"]
    assert home is not None
    assert away is not None
    names = {home["name"], away["name"]}
    assert "Fighter Alpha" in names
    assert "Fighter Beta" in names


def test_normalize_single_competition_event_not_expanded():
    # A single-competition event (even if athlete type) should NOT be expanded
    comp = _make_mma_competition("c1", "101", "A", "102", "B")
    event = _make_mma_event([comp])
    # Remove one competition so only one remains → not multi
    event["competitions"] = [event["competitions"][0]]
    games = normalize_scoreboard_events(entry=_MMA, events=[event])
    assert len(games) == 1
