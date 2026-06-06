from __future__ import annotations

from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.logos.logo_store import LeagueTeamMeta, LogoStore, TeamLogoInfo


def _store() -> LogoStore:
    return LogoStore()


def _team(logos: dict[str, str], preferred_variant: str | None = None) -> TeamLogoInfo:
    return TeamLogoInfo(
        id="1",
        abbreviation="NE",
        display_name="Patriots",
        logos=logos,
        preferred_variant=preferred_variant,
    )


# ---------------------------------------------------------------------------
# get_logo_filename
# ---------------------------------------------------------------------------

def test_get_logo_filename_basic():
    assert _store().get_logo_filename("BAL", "1", "dark") == "BAL-1_dark.png"


def test_get_logo_filename_uppercases_abbreviation():
    assert _store().get_logo_filename("bal", "22", "default") == "BAL-22_default.png"


def test_get_logo_filename_lowercases_variant():
    assert _store().get_logo_filename("NYY", "110", "DARK") == "NYY-110_dark.png"


def test_get_logo_filename_strips_slashes_from_abbr():
    filename = _store().get_logo_filename("A/B", "1", "dark")
    assert "/" not in filename
    assert "\\" not in filename


def test_get_logo_filename_strips_slashes_from_id():
    filename = _store().get_logo_filename("NE", "1/2", "dark")
    assert "/" not in filename


def test_get_logo_filename_variant_spaces_become_underscores():
    assert _store().get_logo_filename("KC", "5", "full default") == "KC-5_full_default.png"


# ---------------------------------------------------------------------------
# get_best_logo_path
# ---------------------------------------------------------------------------

def test_get_best_logo_path_no_logos_returns_none():
    team = _team({})
    assert _store().get_best_logo_path("nfl", team) is None


def test_get_best_logo_path_preferred_variant_wins():
    team = _team(
        {"dark": "logos/nfl/NE-1_dark.png", "default": "logos/nfl/NE-1_default.png"},
        preferred_variant="dark",
    )
    assert _store().get_best_logo_path("nfl", team) == "logos/nfl/NE-1_dark.png"


def test_get_best_logo_path_preferred_variant_missing_falls_through():
    # preferred_variant set but not in logos dict → fall through to next rule
    team = _team({"default": "logos/nfl/NE-1_default.png"}, preferred_variant="dark")
    result = _store().get_best_logo_path("nfl", team)
    assert result == "logos/nfl/NE-1_default.png"


def test_get_best_logo_path_dark_theme_selects_dark():
    team = _team({"default": "logos/nfl/NE-1_default.png", "dark": "logos/nfl/NE-1_dark.png"})
    assert _store().get_best_logo_path("nfl", team, theme_mode="dark") == "logos/nfl/NE-1_dark.png"


def test_get_best_logo_path_team_theme_selects_dark():
    team = _team({"default": "logos/nfl/NE-1_default.png", "dark": "logos/nfl/NE-1_dark.png"})
    assert _store().get_best_logo_path("nfl", team, theme_mode="team") == "logos/nfl/NE-1_dark.png"


def test_get_best_logo_path_context_card_prefers_scoreboard():
    team = _team(
        {
            "scoreboard": "logos/nfl/KC-3_scoreboard.png",
            "full": "logos/nfl/KC-3_full.png",
        }
    )
    assert _store().get_best_logo_path("nfl", team, context="card") == "logos/nfl/KC-3_scoreboard.png"


def test_get_best_logo_path_priority_scoreboard_beats_default():
    team = _team(
        {
            "default": "logos/nfl/KC-3_default.png",
            "scoreboard": "logos/nfl/KC-3_scoreboard.png",
        }
    )
    assert _store().get_best_logo_path("nfl", team) == "logos/nfl/KC-3_scoreboard.png"


def test_get_best_logo_path_fallback_to_first_available():
    team = _team({"custom_variant": "logos/nfl/NE-1_custom_variant.png"})
    assert _store().get_best_logo_path("nfl", team) == "logos/nfl/NE-1_custom_variant.png"


def test_get_best_logo_path_light_theme_skips_dark_preference():
    team = _team({"dark": "logos/nfl/NE-1_dark.png", "scoreboard": "logos/nfl/NE-1_scoreboard.png"})
    # light theme: no dark preference applied, falls to priority order (scoreboard wins)
    result = _store().get_best_logo_path("nfl", team, theme_mode="light")
    assert result == "logos/nfl/NE-1_scoreboard.png"


# ---------------------------------------------------------------------------
# get_logo_path
# ---------------------------------------------------------------------------

def test_get_logo_path_returns_path_object():
    path = _store().get_logo_path("nfl", "BUF", "2", "dark")
    assert isinstance(path, Path)
    assert path.name == "BUF-2_dark.png"
    assert "nfl" in str(path).lower()
