from app.core.groups_util import _division_label, build_division_standings


def _entry(team_id, seed=None, streak="W1"):
    stats = [{"name": "streak", "displayValue": streak}]
    if seed is not None:
        stats.append({"name": "playoffSeed", "displayValue": str(seed)})
    return {"team": {"id": team_id}, "stats": stats}


def test_division_place_seed_streak():
    children = [
        {"name": "American Football Conference", "children": [
            {"name": "AFC East", "standings": {"entries": [_entry("2", 3, "L1"), _entry("15", 9, "W2")]}},
        ]},
    ]
    out = build_division_standings(children)
    assert out["2"] == {"division": "AFC East", "divisionLabel": "AFC East", "conference": "American Football Conference",
                        "place": 1, "seed": 3, "streak": "L1"}
    assert out["15"]["place"] == 2 and out["15"]["streak"] == "W2"


def test_missing_seed_is_none():
    out = build_division_standings([{"name": "Atlantic", "standings": {"entries": [_entry("1")]}}])
    assert out["1"]["seed"] is None


def test_division_label_shortening():
    assert _division_label("American League East") == "AL East"
    assert _division_label("National League West") == "NL West"
    assert _division_label("Atlantic Division") == "Atlantic"
    assert _division_label("AFC East") == "AFC East"


def test_bad_input_is_empty():
    assert build_division_standings([]) == {}
    assert build_division_standings(None) == {}


def test_pick_headline_poll_prefers_cfp_then_ap():
    from app.core.groups_util import pick_headline_poll
    ap = {"name": "AP Top 25", "shortName": "AP Poll", "ranks": [{"current": 1, "team": {"id": "10"}}, {"current": 2, "team": {"id": "11"}}]}
    coaches = {"name": "AFCA Coaches Poll", "shortName": "AFCA Coaches Poll", "ranks": [{"current": 1, "team": {"id": "11"}}]}
    cfp = {"name": "College Football Playoff Rankings", "shortName": "CFP", "ranks": [{"current": 1, "team": {"id": "12"}}]}
    assert pick_headline_poll([ap, coaches]) == ({"10": 1, "11": 2}, "AP")
    assert pick_headline_poll([ap, coaches, cfp]) == ({"12": 1}, "CFP")
    assert pick_headline_poll([coaches]) == ({"11": 1}, "COACHES")
    assert pick_headline_poll([]) == ({}, "")


def test_pick_headline_poll_ignores_unranked_and_deep_ranks():
    from app.core.groups_util import pick_headline_poll
    ap = {"name": "AP Top 25", "ranks": [{"current": 30, "team": {"id": "1"}}, {"current": 99, "team": {"id": "2"}}]}
    assert pick_headline_poll([ap]) == ({}, "")
