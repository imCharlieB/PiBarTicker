from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api import espn


def _event(*, away: dict, home: dict, state: str = "pre", completed: bool = False, date: datetime | None = None) -> dict:
    event_date = (date or datetime.now().astimezone()).isoformat()
    return {
        "date": event_date,
        "status": {
            "type": {
                "state": state,
                "completed": completed,
            }
        },
        "competitions": [
            {
                "competitors": [
                    {"team": away},
                    {"team": home},
                ]
            }
        ],
    }


def test_group_filter_allows_nfc_south_matchups() -> None:
    standings_children = [
        {
            "id": "nfc",
            "name": "NFC",
            "children": [
                {
                    "id": "south",
                    "name": "NFC South",
                    "standings": {
                        "entries": [
                            {"team": {"id": "27"}},  # Tampa Bay Buccaneers
                            {"team": {"id": "1"}},   # Atlanta Falcons
                        ]
                    },
                },
                {
                    "id": "east",
                    "name": "NFC East",
                    "standings": {
                        "entries": [
                            {"team": {"id": "6"}},   # Dallas Cowboys
                            {"team": {"id": "21"}},  # Philadelphia Eagles
                        ]
                    },
                },
            ],
        }
    ]

    memberships = espn._build_team_group_memberships(standings_children)
    included_groups = {"nfc:south"}

    south_vs_east = _event(
        away={"id": "27", "abbreviation": "TB", "slug": "tampa-bay-buccaneers"},
        home={"id": "6", "abbreviation": "DAL", "slug": "dallas-cowboys"},
    )
    east_vs_east = _event(
        away={"id": "6", "abbreviation": "DAL", "slug": "dallas-cowboys"},
        home={"id": "21", "abbreviation": "PHI", "slug": "philadelphia-eagles"},
    )

    assert espn._event_matches_group_filter(south_vs_east, included_groups, memberships)
    assert not espn._event_matches_group_filter(east_vs_east, included_groups, memberships)


def test_team_filter_supports_id_abbreviation_and_slug() -> None:
    event = _event(
        away={"id": "110", "abbreviation": "NYY", "slug": "new-york-yankees", "displayName": "New York Yankees"},
        home={"id": "111", "abbreviation": "BOS", "slug": "boston-red-sox", "displayName": "Boston Red Sox"},
    )

    assert espn._event_matches_team_filter(event, {"110"})
    assert espn._event_matches_team_filter(event, {"nyy"})
    assert espn._event_matches_team_filter(event, {"new-york-yankees"})
    assert not espn._event_matches_team_filter(event, {"sea"})


def test_today_filter_uses_local_date_semantics_for_non_baseball() -> None:
    now_local = datetime.now().astimezone()
    today_event = _event(
        away={"id": "114", "abbreviation": "CLE"},
        home={"id": "116", "abbreviation": "DET"},
        date=now_local,
    )
    yesterday_event = _event(
        away={"id": "114", "abbreviation": "CLE"},
        home={"id": "116", "abbreviation": "DET"},
        date=now_local - timedelta(days=1),
    )

    assert espn._event_matches_game_filter(
        today_event,
        "today",
        sport="football",
        week_filter_applied=False,
    )
    assert not espn._event_matches_game_filter(
        yesterday_event,
        "today",
        sport="football",
        week_filter_applied=False,
    )


def test_baseball_today_filter_keeps_espn_slate() -> None:
    yesterday_event = _event(
        away={"id": "114", "abbreviation": "CLE"},
        home={"id": "116", "abbreviation": "DET"},
        date=datetime(2026, 5, 24, 16, 15),
    )

    assert espn._event_matches_game_filter(
        yesterday_event,
        "today",
        sport="baseball",
        week_filter_applied=False,
    )
