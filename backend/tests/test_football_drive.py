from app.core.football_drive import drive_start_from_summary, win_probability_from_summary


def _summary(yard_line, team_id="84", plays=True):
    play = {"start": {"yardLine": yard_line}}
    return {"drives": {"current": {"team": {"id": team_id}, "plays": [play, {"start": {"yardLine": 40}}] if plays else []}}}


def test_drive_start_uses_the_first_play_of_the_current_drive():
    assert drive_start_from_summary(_summary(72)) == {"yardLine": 72, "teamId": "84"}


def test_no_current_drive_or_no_plays_is_none():
    assert drive_start_from_summary({}) is None
    assert drive_start_from_summary({"drives": {"previous": []}}) is None
    assert drive_start_from_summary(_summary(72, plays=False)) is None
    assert drive_start_from_summary(None) is None


def test_missing_yard_line_is_none():
    assert drive_start_from_summary({"drives": {"current": {"team": {"id": "1"}, "plays": [{"start": {}}]}}}) is None


def test_win_probability_uses_the_last_play():
    summary = {"winprobability": [{"homeWinPercentage": 0.5}, {"homeWinPercentage": 0.2779}]}
    assert win_probability_from_summary(summary) == {"home": 28, "away": 72}


def test_win_probability_missing_or_bad_is_none():
    assert win_probability_from_summary({}) is None
    assert win_probability_from_summary({"winprobability": []}) is None
    assert win_probability_from_summary({"winprobability": [{"homeWinPercentage": "x"}]}) is None
    assert win_probability_from_summary({"winprobability": [{"tiePercentage": 0.0}]}) is None


def test_win_probability_is_clamped_and_adds_to_100():
    assert win_probability_from_summary({"winprobability": [{"homeWinPercentage": 1.0}]}) == {"home": 100, "away": 0}
    assert win_probability_from_summary({"winprobability": [{"homeWinPercentage": 0.0}]}) == {"home": 0, "away": 100}
