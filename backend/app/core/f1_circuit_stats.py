"""F1 race facts (laps, distance, track length) — ESPN's F1 scoreboard has none of them.

Primary path: `f1_stats_from_length` derives everything from the circuit length ESPN's core circuit
record does provide. Fallback: a static per-circuit table, used only when ESPN has no length.

Keyed by the cached circuit-map filename stem, lowercased ("Bahrain_Circuit.png" -> "bahrain"),
which is what the scoreboard already matches an event to. Values are the standard published race
lap count and lap length, converted to miles; a circuit missing here just shows no stats line.
Review when the calendar changes (new circuits, layout changes).
"""

from __future__ import annotations

import math
import re

# stem -> (race laps, track miles, race miles)
_F1_CIRCUIT_STATS: dict[str, tuple[int, float, float]] = {
    "abu_dhabi": (58, 3.281, 190.3),
    "australia": (58, 3.280, 190.2),
    "austria": (71, 2.683, 190.4),
    "bahrain": (57, 3.363, 191.5),
    "baku": (51, 3.730, 190.2),
    "belgium": (44, 4.352, 191.4),
    "brazil": (71, 2.677, 190.1),
    "canada": (70, 2.710, 189.7),
    "china": (56, 3.387, 189.6),
    "great_britain": (52, 3.661, 190.3),
    "hungary": (70, 2.722, 190.5),
    "italy": (53, 3.600, 190.8),
    "japan": (53, 3.608, 191.1),
    "las_vegas": (50, 3.853, 192.6),
    "mexico": (71, 2.674, 189.7),
    "miami": (57, 3.363, 191.6),
    "monaco": (78, 2.074, 161.7),
    "netherlands": (72, 2.646, 190.5),
    "qatar": (57, 3.367, 191.8),
    "saudi_arabia": (50, 3.836, 191.7),
    "singapore": (62, 3.070, 190.2),
    "spain": (66, 2.894, 190.9),
    "usa": (56, 3.426, 191.6),
}


def f1_circuit_stats(circuit_image: str) -> dict | None:
    """Stats for a circuit-map path like '/logos/f1/circuits/Bahrain_Circuit.png', or None."""
    name = str(circuit_image or "").replace("\\", "/").rsplit("/", 1)[-1]
    stem = name.rsplit(".", 1)[0]
    if stem.lower().endswith("_circuit"):
        stem = stem[: -len("_circuit")]
    hit = _F1_CIRCUIT_STATS.get(stem.lower())
    if not hit:
        return None
    laps, track_mi, race_mi = hit
    return {"scheduledLaps": laps, "trackMiles": track_mi, "scheduledDistance": race_mi}


_KM_PER_MILE = 1.609344


def f1_stats_from_length(length: object, *, monaco: bool = False) -> dict | None:
    """Race facts from a circuit length string like '5.543 km' or '3.363 mi'.

    F1 race distance = the fewest whole laps that exceed 305 km (260 km at Monaco)."""
    m = re.search(r"([\d.]+)\s*(km|mi)", str(length or ""), re.IGNORECASE)
    if not m:
        return None
    value = float(m.group(1))
    km = value if m.group(2).lower() == "km" else value * _KM_PER_MILE
    if km <= 0:
        return None
    laps = math.ceil((260.0 if monaco else 305.0) / km)
    track_mi = km / _KM_PER_MILE
    return {
        "scheduledLaps": laps,
        "trackMiles": round(track_mi, 2),
        "scheduledDistance": round(laps * track_mi, 1),
    }
