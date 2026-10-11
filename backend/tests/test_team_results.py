from app.api.espn.teams import _map_standings_stats
from app.core.groups_util import apply_seed_line, college_standings_snapshot, completed_event_ids
from app.core.team_results import needs_lookup, resolve_streak


def _event(eid, date, winner, completed=True, me="9"):
    return {"id": eid, "date": date, "competitions": [{"status": {"type": {"completed": completed}},
            "competitors": [{"team": {"id": me}, "winner": winner}, {"team": {"id": "1"}, "winner": None if winner is None else not winner}]}]}


def test_college_snapshot_keeps_every_team_and_blanks_dash_streaks():
    stats = lambda streak, overall: [{"name": "streak", "displayValue": streak}, {"name": "overall", "displayValue": overall}]
    children = [{"name": "SEC", "children": [{"name": "East", "standings": {"entries": [
        {"team": {"id": "61"}, "stats": stats("W6", "6-0")}, {"team": {"id": "2"}, "stats": stats("-", "4-1")},
        {"team": {"id": "3"}, "stats": stats("L1", "3-2")}, {"team": {"id": "4"}, "stats": stats("", "2-3")}]}}]}]
    assert college_standings_snapshot(children) == {
        "61": {"streak": "W6", "overall": "6-0"}, "2": {"streak": "", "overall": "4-1"},
        "3": {"streak": "L1", "overall": "3-2"}, "4": {"streak": "", "overall": "2-3"}}
    assert college_standings_snapshot([]) == {} and college_standings_snapshot(None) == {}


def test_apply_seed_line_is_per_request_and_does_not_mutate():
    teams = {"1": {"seed": 2, "place": 1}, "2": {"seed": 9, "place": 2}, "3": {"seed": None}, "4": {"seed": 1, "showSeed": True}}
    on = apply_seed_line(teams, 7)
    assert on["1"]["showSeed"] is True and "showSeed" not in on["2"] and "showSeed" not in on["3"] and on["4"]["showSeed"] is True
    off = apply_seed_line(teams, None)
    assert all("showSeed" not in v for v in off.values()) and teams["4"]["showSeed"] is True


def test_completed_event_ids():
    evs = [_event("a", "2026-09-01", True), _event("b", "2026-09-08", None, completed=False)]
    assert completed_event_ids(evs) == {"a"}


def test_needs_lookup_only_when_a_new_finished_game_appears():
    stored = {"streak": "W2", "done": ["a", "b"]}
    assert needs_lookup(None, "c", "post") is True               # never seen this team
    assert needs_lookup(stored, "c", "pre") is False             # game not started
    assert needs_lookup(stored, "c", "in") is False              # game in progress
    assert needs_lookup(stored, "b", "post") is False            # finished and already counted
    assert needs_lookup(stored, "c", "post") is True             # finished and NOT counted yet
    assert needs_lookup({"streak": "", "done": ["a"]}, "a", "post") is True  # nothing usable stored


def test_resolve_streak_fetches_once_and_stores_done_ids():
    calls = []
    evs = [_event("a", "2026-09-01", True), _event("b", "2026-09-08", True)]
    def fetch(): calls.append(1); return evs
    streak, entry = resolve_streak(None, "9", "b", "post", fetch)
    assert streak == "W2" and entry == {"streak": "W2", "done": ["a", "b"]} and len(calls) == 1
    streak2, entry2 = resolve_streak(entry, "9", "b", "post", fetch)      # same finished game again: no new call
    assert streak2 == "W2" and entry2 is None and len(calls) == 1


def test_resolve_streak_falls_back_to_stored_when_lookup_fails():
    def boom(): raise RuntimeError("espn down")
    streak, entry = resolve_streak({"streak": "L3", "done": ["a"]}, "9", "z", "post", boom)
    assert streak == "L3" and entry is None
    assert resolve_streak(None, "9", "z", "post", boom) == ("", None)


def test_resolve_streak_self_heals_when_espn_has_not_marked_the_game_final_yet():
    early = [_event("a", "2026-09-01", True), _event("b", "2026-09-08", None, completed=False)]
    streak, entry = resolve_streak(None, "9", "b", "post", lambda: early)
    assert streak == "W1" and entry["done"] == ["a"]                      # "b" not counted yet
    final = early[:1] + [_event("b", "2026-09-08", True)]
    streak2, entry2 = resolve_streak(entry, "9", "b", "post", lambda: final)  # next rotation: b finished, not in done -> look again
    assert streak2 == "W2" and entry2["done"] == ["a", "b"]


def test_team_page_stats_map_college_names_and_compute_win_percent():
    stats = [{"name": "overall", "displayValue": "3-2"}, {"name": "Away", "displayValue": "0-1"}, {"name": "vs. Conf.", "displayValue": "1-2"},
             {"name": "vs Division", "displayValue": "0-0"}, {"name": "streak", "displayValue": "L1"}, {"name": "Home", "displayValue": "2-1"}]
    m = _map_standings_stats(stats)
    assert m["awayRecord"] == "0-1" and m["conferenceRecord"] == "1-2" and m["divisionRecord"] == "0-0" and m["homeRecord"] == "2-1"
    assert m["winPercent"] == ".600" and m["streak"] == "L1"
    pro = _map_standings_stats([{"name": "overall", "displayValue": "3-1"}, {"name": "winPercent", "displayValue": ".750"}, {"name": "Road", "displayValue": "1-0"}])
    assert pro["winPercent"] == ".750" and pro["awayRecord"] == "1-0"     # a real value from the feed is never overwritten


def _game(gid, state, away="1", home="2"):
    return {"id": gid, "state": state, "teams": {"away": {"id": away}, "home": {"id": home}}}


def test_standings_refresh_only_when_a_finished_game_is_not_counted():
    from app.core.team_results import needs_standings_refresh
    snap = {"teams": {"1": {}}, "counted": ["g1"]}
    assert needs_standings_refresh(None, []) is True                              # nothing stored yet
    assert needs_standings_refresh(snap, [_game("g2", "pre"), _game("g3", "in")]) is False   # nothing finished: use the stored copy
    assert needs_standings_refresh(snap, [_game("g1", "post")]) is False          # finished and already reflected
    assert needs_standings_refresh(snap, [_game("g1", "post"), _game("g2", "post")]) is True  # g2 finished, not reflected


def test_a_finished_game_counts_only_once_the_standings_actually_changed():
    from app.core.team_results import reflected_game_ids
    old = {"teams": {"1": {"overall": "3-2", "streak": "L1"}, "2": {"overall": "4-1", "streak": "W2"}}, "counted": []}
    games = [_game("g9", "post")]
    lagging = {"1": {"overall": "3-2", "streak": "L1"}, "2": {"overall": "4-1", "streak": "W2"}}      # ESPN has not caught up
    assert reflected_game_ids(old, lagging, games) == set()                       # not counted -> asked again next rotation
    caught_up = {"1": {"overall": "3-3", "streak": "L2"}, "2": {"overall": "5-1", "streak": "W3"}}
    assert reflected_game_ids(old, caught_up, games) == {"g9"}
    assert reflected_game_ids(None, lagging, games) == {"g9"}                     # first snapshot: nothing to compare with
    assert reflected_game_ids({"teams": old["teams"], "counted": ["g1"]}, caught_up, [_game("g1", "post")]) == {"g1"}


def test_standings_stats_by_team_keeps_group_and_mapped_stats():
    from app.api.espn.teams import standings_stats_by_team
    children = [{"name": "NFC", "abbreviation": "NFC", "children": [{"name": "NFC West", "abbreviation": "WEST", "standings": {"entries": [
        {"team": {"id": "22"}, "stats": [{"name": "overall", "displayValue": "1-3"}, {"name": "streak", "displayValue": "L3"}, {"name": "Home", "displayValue": "0-1"}]}]}}]}]
    got = standings_stats_by_team(children)
    assert got["22"]["group"] == {"name": "NFC West", "abbreviation": "WEST"}
    assert got["22"]["stats"]["overall"] == "1-3" and got["22"]["stats"]["streak"] == "L3" and got["22"]["stats"]["homeRecord"] == "0-1"
    assert got["22"]["stats"]["winPercent"] == ".250"
