from app.core.soccer_live import ball_position, last_page, latest_ball_position, team_id_from_ref


def test_position_is_flipped_for_the_home_team():
    # x runs from the acting team's own goal (0) to the opponent's goal (100); the pitch has the away goal on the left, the home goal on the right
    assert ball_position(92.3, "away") == 92   # away team attacking the home goal on the right
    assert ball_position(92.3, "home") == 8    # home team attacking the away goal on the left
    assert ball_position(50, "home") == 50
    assert ball_position(0, "away") == 0 and ball_position(100, "away") == 100
    assert ball_position(130, "away") == 100   # clamped
    assert ball_position(None, "away") is None
    assert ball_position(40, "") is None


def test_team_id_from_a_core_api_reference():
    assert team_id_from_ref("http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/teams/357?lang=en&region=us") == "357"
    assert team_id_from_ref("") == ""


def test_the_newest_plays_are_on_the_last_page():
    assert last_page(1401, 25) == 57
    assert last_page(1400, 25) == 56
    assert last_page(0, 25) == 1


def test_latest_ball_position_uses_the_newest_play_with_a_position():
    sides = {"357": "away", "359": "home"}
    ref = lambda tid: {"$ref": f"http://x/teams/{tid}?lang=en"}
    plays = [
        {"fieldPositionX": 30.0, "team": ref("357")},
        {"fieldPositionX": 20.0, "team": ref("359")},            # home team, 20 from its own goal -> 80 across the pitch
        {"type": {"text": "Assists Shot"}, "team": ref("359")},  # no position: skipped
    ]
    assert latest_ball_position(plays, sides) == 80
    assert latest_ball_position([], sides) is None
    assert latest_ball_position([{"fieldPositionX": 10, "team": ref("999")}], sides) is None  # team not in this match
