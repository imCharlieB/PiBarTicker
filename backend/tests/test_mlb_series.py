from datetime import datetime
from app.core.mlb_series import match_series, parse_schedule, round_of, schedule_url, status_text


def _game(away, home, date, status, game_type="R"):
    return {"gameDate": date, "gameType": game_type, "seriesStatus": status,
            "teams": {"away": {"team": {"name": away}}, "home": {"team": {"name": home}}}}


def _payload(*games):
    return {"dates": [{"games": list(games)}]}


ALDS = {"gameNumber": 4, "totalGames": 5, "isTied": True, "isOver": False, "wins": 2, "losses": 2, "result": "Series tied 2-2",
        "shortName": "ALDS", "abbreviation": "ALDS"}
REG = {"gameNumber": 3, "totalGames": 3, "isTied": False, "isOver": True, "wins": 3, "losses": 0, "result": "PIT wins 3-0",
       "shortName": "Season", "abbreviation": "RS"}


def test_status_text_variants():
    assert status_text("Series tied 2-2", 2, 2) == "TIED 2–2"
    assert status_text("PIT wins 3-0", 3, 0) == "PIT WIN 3–0"
    assert status_text("NYY leads series 2-1", 2, 1) == "NYY LEAD 2–1"
    assert status_text("Series tied 0-0", 0, 0) == ""  # first game: nothing to show yet
    assert status_text("Something new", 1, 0) == "SOMETHING NEW"


def test_round_detection():
    assert round_of({"seriesStatus": {"abbreviation": "ALDS"}, "gameType": "D"}) == "ALDS"
    assert round_of({"seriesStatus": {"abbreviation": "WS"}, "gameType": "W"}) == "WS"
    assert round_of({"seriesStatus": {"abbreviation": "RS"}, "gameType": "W"}) == "WS"
    assert round_of({"seriesStatus": {"abbreviation": "X"}, "gameType": "F"}) == "WC"
    assert round_of({"seriesStatus": {"abbreviation": "RS"}, "gameType": "R"}) == ""


def test_parse_and_match():
    lookup = parse_schedule(_payload(
        _game("Cleveland Guardians", "Chicago White Sox", "2026-10-08T20:08:00Z", ALDS, "D"),
        _game("Kansas City Royals", "Pittsburgh Pirates", "2026-09-20T17:35:00Z", REG),
    ))
    s = match_series(lookup, "Cleveland Guardians", "Chicago White Sox", "2026-10-08T20:00:00Z")
    assert s == {"kind": "playoff", "round": "ALDS", "gameNumber": 4, "totalGames": 5, "statusText": "TIED 2–2", "completed": False}
    reg = match_series(lookup, "Kansas City Royals", "Pittsburgh Pirates", "2026-09-20T17:40:00Z")
    assert reg["kind"] == "season" and reg["round"] == "" and reg["statusText"] == "PIT WIN 3–0" and reg["completed"] is True


def test_match_picks_closest_doubleheader_game_and_rejects_far_ones():
    g1 = _game("A Team", "B Team", "2026-09-01T17:00:00Z", {**REG, "gameNumber": 1, "wins": 0, "losses": 0})
    g2 = _game("A Team", "B Team", "2026-09-01T23:00:00Z", {**REG, "gameNumber": 2, "wins": 1, "losses": 0, "result": "A wins 1-0"})
    lookup = parse_schedule(_payload(g1, g2))
    assert match_series(lookup, "A Team", "B Team", "2026-09-01T22:50:00Z")["gameNumber"] == 2
    assert match_series(lookup, "A Team", "B Team", "2026-09-05T22:50:00Z") is None
    assert match_series(lookup, "Other", "B Team", "2026-09-01T17:00:00Z") is None


def test_schedule_url_has_a_day_of_slack():
    url = schedule_url(["2026-10-08T20:08:00+00:00", "2026-10-09T01:00:00Z"])
    assert "startDate=2026-10-07" in url and "endDate=2026-10-10" in url and "seriesStatus" in url
    assert schedule_url(["bad"]) is None


# ---- stored series: asked again only when something changed ----
def _lk(start="2026-10-12T00:00:00+00:00", text="TIED 1–1"):
    return [{"away": "a", "home": "b", "awayName": "A", "homeName": "B", "start": datetime.fromisoformat(start),
             "series": {"statusText": text, "gameNumber": 2, "totalGames": 5, "round": "NLDS", "kind": "playoff", "completed": False}}]


def test_series_pulled_once_then_only_when_the_board_or_a_finished_game_changes():
    from datetime import timezone as tz
    from app.core.mlb_series import counted_after_pull, series_due, series_range
    now = datetime(2026, 10, 12, 12, 0, tzinfo=tz.utc)
    rng = series_range(["2026-10-12T20:00:00Z"])
    games = [{"id": "1", "state": "pre"}]
    assert series_due(None, games, rng, now) is True                                           # nothing stored
    stored = {"lookup": _lk(), "range": list(rng), "counted": [], "checkedAt": now.isoformat()}
    assert series_due(stored, games, rng, now) is False                                        # covered, nothing finished
    assert series_due(stored, games, series_range(["2026-10-15T20:00:00Z"]), now) is True      # board shows days we do not have
    done = [{"id": "1", "state": "post"}]
    later = datetime(2026, 10, 12, 13, 0, tzinfo=tz.utc)
    assert series_due(stored, done, rng, later) is True                                        # a finished game is not reflected yet
    assert series_due(stored, done, rng, datetime(2026, 10, 12, 12, 10, tzinfo=tz.utc)) is False   # asked 10 min ago: wait
    assert counted_after_pull(stored, _lk(), done) == set()                                    # source unchanged: not reflected, ask again later
    assert counted_after_pull(stored, _lk(text="NYY LEAD 2–1"), done) == {"1"}                 # series text moved: counted


def test_series_lookup_survives_being_stored():
    from app.core.mlb_series import _parsed, _serial
    assert _parsed(_serial(_lk()))[0]["start"] == _lk()[0]["start"]
