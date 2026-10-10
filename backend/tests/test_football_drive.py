from app.core.football_drive import drive_start_from_summary


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
