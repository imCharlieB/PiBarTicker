"""Bowl season / playoffs: calendar window, placeholder games, ESPN's game name, schedule merge."""

from datetime import datetime, timezone

from app.api.espn.scoreboard import _has_unknown_team, _scoreboard_season_type
from app.core.espn_normalizer import normalize_scoreboard_events
from app.core.espn_registry import resolve_registry_entry
from app.core.espn_scoreboard import current_week_index, resolve_calendar_weeks
from app.core.groups_util import merge_schedule_events


def _calendar():
    # shaped like ESPN's college football calendar: the playoff is a pseudo week (999) that overlaps the real "Bowls" week
    return {"leagues": [{"calendar": [
        {"value": "2", "label": "Regular Season", "entries": [
            {"value": "15", "startDate": "2025-12-01T08:00Z", "endDate": "2025-12-08T07:59Z"},
            {"value": "16", "startDate": "2025-12-08T08:00Z", "endDate": "2025-12-13T07:59Z"},
        ]},
        {"value": "3", "label": "Postseason", "entries": [
            {"value": "1", "label": "Bowls", "startDate": "2025-12-13T08:00Z", "endDate": "2026-01-21T07:59Z"},
            {"value": "999", "label": "CFP", "startDate": "2025-12-19T08:00Z", "endDate": "2026-01-20T07:59Z"},
        ]},
    ]}]}


def test_the_playoff_pseudo_week_does_not_hide_the_other_bowls():
    weeks = resolve_calendar_weeks(_calendar())
    assert [w.week for w in weeks] == [15, 16, 1]
    for day in ("2025-12-14", "2025-12-20", "2025-12-31", "2026-01-01", "2026-01-12", "2026-01-20"):
        now = datetime.fromisoformat(day + "T18:00:00+00:00")
        picked = weeks[current_week_index(weeks, now)]
        assert (picked.seasontype, picked.week) == (3, 1), day  # the week that holds every bowl AND every playoff game


def test_current_week_index_before_the_season_and_without_a_calendar():
    weeks = resolve_calendar_weeks(_calendar())
    assert current_week_index(weeks, datetime(2025, 6, 1, tzinfo=timezone.utc)) == 0
    assert current_week_index([], datetime(2025, 6, 1, tzinfo=timezone.utc)) is None


def test_placeholder_games_are_recognised():
    tbd = {"competitions": [{"competitors": [{"team": {"id": "-1", "abbreviation": "TBD"}}, {"team": {"id": "-2", "abbreviation": "TBD"}}]}]}
    real = {"competitions": [{"competitors": [{"team": {"id": "84", "abbreviation": "IU"}}, {"team": {"id": "333", "abbreviation": "ALA"}}]}]}
    half = {"competitions": [{"competitors": [{"team": {"id": "84", "abbreviation": "IU"}}, {"team": {"id": "-2", "abbreviation": "TBD"}}]}]}
    assert _has_unknown_team(tbd) and _has_unknown_team(half)
    assert not _has_unknown_team(real)
    assert not _has_unknown_team({"competitions": [{"competitors": []}]})  # the calendar's "next upcoming" stand-in has no competitors


def test_the_game_name_from_espn_is_kept():
    entry = resolve_registry_entry("college-football", None)
    event = {
        "id": "1", "date": "2026-01-01T21:00Z", "shortName": "ALA VS IU",
        "status": {"type": {"state": "pre", "completed": False}},
        "competitions": [{
            "id": "1", "date": "2026-01-01T21:00Z", "status": {"type": {"state": "pre", "completed": False}},
            "notes": [{"type": "event", "headline": "College Football Playoff Quarterfinal at the Rose Bowl Presented by Prudential"}],
            "competitors": [
                {"homeAway": "home", "team": {"id": "84", "abbreviation": "IU", "displayName": "Indiana Hoosiers"}},
                {"homeAway": "away", "team": {"id": "333", "abbreviation": "ALA", "displayName": "Alabama Crimson Tide"}},
            ],
        }],
    }
    game = normalize_scoreboard_events(entry=entry, events=[event])[0]
    assert game["eventNote"] == "College Football Playoff Quarterfinal at the Rose Bowl Presented by Prudential"
    event["competitions"][0]["notes"] = []
    assert normalize_scoreboard_events(entry=entry, events=[event])[0]["eventNote"] == ""


def test_season_type_is_found_even_when_the_answer_has_no_top_level_season():
    assert _scoreboard_season_type({"season": {"type": 3}}) == 3
    assert _scoreboard_season_type({"leagues": [{"season": {"type": 3}}]}) == 3
    assert _scoreboard_season_type({"events": [{"season": {"type": 3}}]}) == 3
    assert _scoreboard_season_type({}) is None


def test_postseason_schedule_games_are_added_once():
    regular = [{"id": "1"}, {"id": "2"}]
    post = [{"id": "2"}, {"id": "3"}]
    assert [e["id"] for e in merge_schedule_events(regular, post)] == ["1", "2", "3"]
    assert merge_schedule_events([], post) == post
