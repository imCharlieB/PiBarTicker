from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EspnLeagueRegistryEntry:
    league_id: str
    sport: str
    league: str
    supports_week_filter: bool = False
    has_news: bool = True

    @property
    def scoreboard_url(self) -> str:
        return f"https://site.api.espn.com/apis/site/v2/sports/{self.sport}/{self.league}/scoreboard"


# League ids in config are typically short names (nfl, mlb, nba, etc.).
_REGISTRY: dict[str, EspnLeagueRegistryEntry] = {
    "nfl": EspnLeagueRegistryEntry("nfl", "football", "nfl", supports_week_filter=True),
    "college-football": EspnLeagueRegistryEntry(
        "college-football", "football", "college-football", supports_week_filter=True
    ),
    "cfb": EspnLeagueRegistryEntry("cfb", "football", "college-football", supports_week_filter=True),
    "cfl": EspnLeagueRegistryEntry("cfl", "football", "cfl", supports_week_filter=True),
    "xfl": EspnLeagueRegistryEntry("xfl", "football", "xfl", supports_week_filter=True),
    "ufl": EspnLeagueRegistryEntry("ufl", "football", "ufl", supports_week_filter=True),
    "usfl": EspnLeagueRegistryEntry("usfl", "football", "ufl", supports_week_filter=True),
    "nba": EspnLeagueRegistryEntry("nba", "basketball", "nba"),
    "wnba": EspnLeagueRegistryEntry("wnba", "basketball", "wnba"),
    "ncaam": EspnLeagueRegistryEntry("ncaam", "basketball", "mens-college-basketball"),
    "ncaaw": EspnLeagueRegistryEntry("ncaaw", "basketball", "womens-college-basketball"),
    "mlb": EspnLeagueRegistryEntry("mlb", "baseball", "mlb"),
    "nhl": EspnLeagueRegistryEntry("nhl", "hockey", "nhl"),
    "mls": EspnLeagueRegistryEntry("mls", "soccer", "usa.1"),
    "nwsl": EspnLeagueRegistryEntry("nwsl", "soccer", "usa.nwsl"),
    "epl": EspnLeagueRegistryEntry("epl", "soccer", "eng.1"),
    "nascar-premier": EspnLeagueRegistryEntry("nascar-premier", "racing", "nascar-premier"),
    "nascar-cup": EspnLeagueRegistryEntry("nascar-cup", "racing", "nascar-cup", has_news=False),
    "nascar-xfinity": EspnLeagueRegistryEntry("nascar-xfinity", "racing", "nascar-xfinity", has_news=False),
    "nascar-trucks": EspnLeagueRegistryEntry("nascar-trucks", "racing", "nascar-trucks", has_news=False),
    "nascar-truck": EspnLeagueRegistryEntry("nascar-truck", "racing", "nascar-truck"),
    "f1": EspnLeagueRegistryEntry("f1", "racing", "f1"),
    "indycar": EspnLeagueRegistryEntry("indycar", "racing", "indycar", has_news=False),
    "ufc": EspnLeagueRegistryEntry("ufc", "mma", "ufc"),
    "pfl": EspnLeagueRegistryEntry("pfl", "mma", "pfl"),
    "pga": EspnLeagueRegistryEntry("pga", "golf", "pga"),
    "lpga": EspnLeagueRegistryEntry("lpga", "golf", "lpga"),
    "eur": EspnLeagueRegistryEntry("eur", "golf", "eur"),
    "liv": EspnLeagueRegistryEntry("liv", "golf", "liv"),
    "champions-tour": EspnLeagueRegistryEntry("champions-tour", "golf", "champions-tour"),
    "ntw": EspnLeagueRegistryEntry("ntw", "golf", "ntw"),
}


def _normalized(value: object) -> str:
    return str(value or "").strip().lower()


def get_registry_entry(league_id: str, sport: str | None = None) -> EspnLeagueRegistryEntry | None:
    key = _normalized(league_id)
    entry = _REGISTRY.get(key)
    if entry is None:
        return None

    if sport and _normalized(sport) != entry.sport:
        return None

    return entry


def resolve_registry_entry(league_id: str, sport: str | None = None) -> EspnLeagueRegistryEntry:
    entry = get_registry_entry(league_id, sport)
    if entry is not None:
        return entry

    normalized_league = _normalized(league_id)
    normalized_sport = _normalized(sport)
    if not normalized_league or not normalized_sport:
        raise ValueError("Unknown league mapping. Provide a known league id or both sport and league.")

    return EspnLeagueRegistryEntry(
        league_id=normalized_league,
        sport=normalized_sport,
        league=normalized_league,
        supports_week_filter=normalized_sport == "football",
    )


def list_registry_entries() -> list[EspnLeagueRegistryEntry]:
    return sorted(_REGISTRY.values(), key=lambda entry: (entry.sport, entry.league_id))
