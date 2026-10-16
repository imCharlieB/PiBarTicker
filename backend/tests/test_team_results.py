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


# ---- stored polls ----
def _poll(label, updated):
    return {"label": label, "week": 6, "updated": updated, "ranks": {"61": 2}}


def _at(text):
    from datetime import datetime
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def test_poll_label_and_parse_keep_only_showable_polls():
    from app.core.poll_store import parse_polls
    rankings = [
        {"name": "AP Top 25", "shortName": "AP Poll", "headline": "2026 NCAA Football Rankings - AP Poll Week 6", "lastUpdated": "2026-10-04T21:10Z",
         "ranks": [{"current": 1, "team": {"id": "10"}}, {"current": 2, "team": {"id": "61"}}, {"current": 30, "team": {"id": "99"}}]},
        {"name": "FCS Coaches Poll", "shortName": "FCS Coaches Poll", "ranks": [{"current": 1, "team": {"id": "5"}}]},
        {"name": "AFCA Coaches Poll", "shortName": "AFCA Coaches Poll", "headline": "x Week 6", "date": "2026-10-04T07:00Z", "ranks": [{"current": 1, "team": {"id": "10"}}]},
    ]
    polls = parse_polls(rankings)
    assert [p["label"] for p in polls] == ["AP", "COACHES"]          
    ap = polls[0]
    assert ap["week"] == 6 and ap["updated"] == "2026-10-04T21:10Z" and ap["ranks"] == {"10": 1, "61": 2}   # rank 30 is outside the top 25


def test_polls_are_only_due_about_a_week_after_the_last_update():
    from app.core.poll_store import polls_due
    stored = {"polls": [_poll("AP", "2026-10-04T21:10Z"), _poll("COACHES", "2026-10-04T20:08Z")], "checkedAt": "2026-10-05T12:00:00+00:00"}
    assert polls_due(None, _at("2026-10-05T00:00Z")) is True                     # nothing stored
    assert polls_due(stored, _at("2026-10-07T00:00Z")) is False                  # mid-week: no call at all
    assert polls_due(stored, _at("2026-10-11T12:00Z")) is False                  # Sunday morning, still > 2h before a week
    assert polls_due(stored, _at("2026-10-11T20:00Z")) is True                   # a week (minus 2h) after the last update: look
    stored["checkedAt"] = "2026-10-11T20:00:00+00:00"
    assert polls_due(stored, _at("2026-10-11T20:20Z")) is False                  # just asked, nothing newer: wait
    assert polls_due(stored, _at("2026-10-11T20:31Z")) is True                   # 30 min later ask again until it updates


def test_cfp_is_looked_for_in_november_until_it_appears():
    from app.core.poll_store import headline_from_stored, polls_due
    stored = {"polls": [_poll("AP", "2026-11-01T21:10Z"), _poll("COACHES", "2026-11-01T20:08Z")], "checkedAt": "2026-11-02T00:00:00+00:00"}
    assert polls_due(stored, _at("2026-11-02T01:00Z")) is False                  # asked an hour ago
    assert polls_due(stored, _at("2026-11-02T07:00Z")) is True                   # 7h later: watch for the first CFP release
    with_cfp = {"polls": [_poll("AP", "2026-11-01T21:10Z"), _poll("COACHES", "2026-11-01T20:08Z"), _poll("CFP", "2026-11-04T22:00Z")], "checkedAt": "2026-11-05T00:00:00+00:00"}
    assert polls_due(with_cfp, _at("2026-11-06T00:00Z")) is False                # CFP stored: back to the weekly rhythm
    assert headline_from_stored(with_cfp["polls"])[1] == "CFP"
    assert headline_from_stored(stored["polls"])[1] == "AP"
    assert headline_from_stored([]) == ({}, "")


# ---- stored racing points ----
def _race(gid, state="post", session=""):
    return {"id": gid, "state": state, "sessionLabel": session}


def test_only_finished_races_are_watched():
    from app.core.points_store import finished_race_ids
    games = [_race("1", "post", "Race"), _race("2", "post", "Qual"), _race("3", "post", "FP1"), _race("4", "pre", "Race"),
             _race("5-order", "post", ""), _race("6", "post", "SR"), _race("7", "post", "")]
    assert finished_race_ids(games) == {"1", "6", "7"}


def test_points_are_pulled_once_then_only_after_a_new_race_finishes():
    from app.core.points_store import counted_after_pull, points_due
    games = [_race("401", "post", "Race")]
    assert points_due(None, games, _at("2026-10-11T15:00Z")) is True
    counted = counted_after_pull(None, {"p": 1}, games)
    stored = {"checkedAt": "2026-10-11T15:00:00+00:00", "counted": sorted(counted), "data": {"p": 1}}
    assert points_due(stored, games, _at("2026-10-12T15:00Z")) is False                      # race already counted: no call at all
    games2 = games + [_race("402", "post", "Race")]
    assert points_due(stored, games2, _at("2026-10-18T15:20Z")) is True                      # a new race finished
    stored["checkedAt"] = "2026-10-18T15:20:00+00:00"
    assert points_due(stored, games2, _at("2026-10-18T15:40Z")) is False                     # just asked: wait
    assert points_due(stored, games2, _at("2026-10-18T15:51Z")) is True
    assert counted_after_pull(stored, {"p": 1}, games2) == {"401"}                           # source unchanged -> not caught up, ask again
    assert counted_after_pull(stored, {"p": 2}, games2) == {"401", "402"}                    # points moved -> race is reflected


def test_poll_choice_is_honoured_and_falls_back():
    from app.core.poll_store import headline_from_stored
    polls = [
        {"label": "AP", "ranks": {"1": 1}},
        {"label": "COACHES", "ranks": {"2": 1}},
    ]
    assert headline_from_stored(polls)[1] == "AP"                    # auto: AP (no CFP stored)
    assert headline_from_stored(polls, "COACHES") == ({"2": 1}, "COACHES")
    assert headline_from_stored(polls, "AP")[1] == "AP"
    assert headline_from_stored(polls, "CFP")[1] == "AP"             # chosen poll not stored yet -> the default order
    assert headline_from_stored(polls, "bogus")[1] == "AP"
    with_cfp = polls + [{"label": "CFP", "ranks": {"3": 1}}]
    assert headline_from_stored(with_cfp)[1] == "CFP"                # auto: CFP wins once it is published
    assert headline_from_stored(with_cfp, "AP")[1] == "AP"           # but the user can still ask for AP


def test_a_poll_missing_from_a_fresh_pull_keeps_its_stored_copy():
    from app.core.poll_store import merge_polls
    stored = [{"label": "AP", "week": 6, "ranks": {"1": 1}}, {"label": "COACHES", "week": 6, "ranks": {"2": 1}}]
    fresh = [{"label": "COACHES", "week": 7, "ranks": {"2": 2}}]            # ESPN listed only the Coaches poll this time
    merged = {p["label"]: p for p in merge_polls(fresh, stored)}
    assert merged["COACHES"]["week"] == 7                                  # the newer one wins
    assert merged["AP"]["week"] == 6                                       # AP does not disappear
    assert [p["label"] for p in merge_polls(fresh, None)] == ["COACHES"]


def test_missing_ap_or_coaches_is_rechecked_soon_not_in_a_week():
    from app.core.poll_store import polls_due
    only_coaches = {"polls": [_poll("COACHES", "2026-10-11T19:58Z")], "checkedAt": "2026-10-11T20:00:00+00:00"}
    assert polls_due(only_coaches, _at("2026-10-11T20:10Z")) is False       # just asked
    assert polls_due(only_coaches, _at("2026-10-11T20:40Z")) is True        # AP is missing: ask again after 30 minutes
    both = {"polls": [_poll("AP", "2026-10-11T21:07Z"), _poll("COACHES", "2026-10-11T19:58Z")], "checkedAt": "2026-10-11T22:00:00+00:00"}
    assert polls_due(both, _at("2026-10-14T00:00Z")) is False               # both stored and fresh: no calls for days


def test_postseason_standings_are_not_pulled_again_for_every_finished_playoff_game():
    from app.core.team_results import needs_standings_refresh

    snap = {"teams": {"1": {}}, "counted": ["g1"]}
    finished_unreflected = [_game("g1", "post"), _game("g2", "post")]
    assert needs_standings_refresh(snap, finished_unreflected) is True                # regular season: g2 is new, ask ESPN
    assert needs_standings_refresh(snap, finished_unreflected, frozen=True) is False  # playoffs: standings never change, keep the stored copy
    assert needs_standings_refresh(None, finished_unreflected, frozen=True) is True   # but nothing stored yet: pull once
