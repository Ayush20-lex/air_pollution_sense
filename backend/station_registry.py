"""
Station registry - Air Pollution Sense
SIH26082 - MoES / NCMRWF

The real monitoring mesh: every CPCB / DPCC / IMD / HSPCB / UPPCB station in the
archive, with a National AQI computed from its own measurements.

Why this exists
---------------
The public terminal drew 26 nodes at their true coordinates and then labelled
them with numbers that were written by hand - `aqi: 142` was a literal in a
TypeScript file. The map was real and the readings on it were not, which is the
one combination a viewer cannot detect.

Everything here is measured. PM2.5, PM10, NO2, O3 and SO2 all come from the
station's own sensors in the archive; nothing is modelled, interpolated or
carried over from a neighbour. A station that cannot support a number does not
get one - see `valid` below. CO is withheld because its catalogued unit is
contradicted by its own values; the reason travels with the payload in
`pollutants_excluded` rather than living only in this comment.

Why the AQI here differs from the console
-----------------------------------------
The console derives its AQI from PM2.5 alone, because PM2.5 is what the
forecast predicts. This is the *National* AQI: the worst of the six sub-indices,
which is what CPCB publishes and what a resident actually reads. The National
figure is therefore >= the console figure by construction, and the pollutant
responsible is named in `prominent_pollutant` so the two can be reconciled
rather than merely differing.

The CPCB rules are enforced by aqi_cpcb, not re-implemented here: 24-hour means
for particulates, the maximum 8-hour rolling mean for O3, a minimum of three
pollutants, and a refusal to publish when those are unmet. A station short of
data reports `valid: false` with its reasons instead of a plausible-looking
integer - 11 of the 68 do.
"""
from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import aqi_cpcb

logger = logging.getLogger("station_registry")

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA = REPO_ROOT / "ml_pipeline" / "data"

#: Pollutants that carry a CPCB sub-index and are present in the archive as
#: station measurements. NH3 has a breakpoint table but no sensors here, and
#: NOx is not an AQI pollutant in its own right - NO2 is.
AQI_POLLUTANTS = ("pm25", "pm10", "no2", "o3", "so2")

#: Pollutants deliberately left out of the index, and why. Surfaced in the
#: payload rather than silently omitted, because a missing sub-index changes the
#: AQI and a reader is entitled to know one was withheld.
EXCLUDED: dict[str, str] = {
    "co": (
        "unit in the catalogue is 'ppb', which the values contradict: the median "
        "across sensors is 1.01 and the maximum 8.74, magnitudes that are mg/m3 "
        "or ppm, not ppb. Read as ppb the sub-index collapses to roughly zero "
        "(0.004 mg/m3 at Anand Vihar), so CO would silently contribute nothing. "
        "mg/m3 and ppm differ by 15% and the label cannot be trusted to choose "
        "between them, so CO is withheld rather than guessed at. Fixing this "
        "upstream would restore it - no change is needed here."
    ),
}

#: The window each sub-index is computed over. CPCB's longest is 24 hours, so
#: that is how much history a station needs before it can be indexed.
WINDOW_HOURS = 24

#: Delhi proper, roughly. Outside this box a station is NCR rather than Delhi,
#: which is how the terminal groups its rail.
DELHI = (28.40, 28.90, 76.84, 77.35)  # lat_min, lat_max, lon_min, lon_max

#: Radius in km around Connaught Place within which a station reads as Central
#: rather than by compass sector.
CENTRAL_KM = 7.0
CENTRE = (28.6289, 77.2065)

#: Operating authority, as the provider encodes it in the station name. CPCB's
#: catalogue writes the agency after the last dash: "R K Puram, Delhi - DPCC".
_AGENCY_RE = re.compile(r"-\s*([A-Z]{3,6})\s*$")
KNOWN_AGENCIES = {"CPCB", "DPCC", "IMD", "ICAR", "HSPCB", "UPPCB", "IITM", "NEERI"}


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Planar distance, good enough over a 60 km domain."""
    return math.hypot((lat1 - lat2) * 111.0, (lon1 - lon2) * 97.5)


def _agency(name: str, provider: str | None) -> str:
    """Operating authority from the station name, falling back to the provider.

    Real rather than assigned: the catalogue name carries it, and inventing an
    agency for a station whose name does not state one would be the same class
    of fabrication this module exists to remove.
    """
    m = _AGENCY_RE.search(name or "")
    if m and m.group(1) in KNOWN_AGENCIES:
        return m.group(1)
    return (provider or "CPCB").upper()


def _display_name(name: str) -> str:
    """The station name without the city and agency suffix.

    "Sector - 125, Noida, UP - UPPCB" -> "Sector - 125, Noida". The full string
    is kept alongside, because it is the one that matches CPCB's own listings.
    """
    stem = _AGENCY_RE.sub("", name or "").strip().rstrip(",").strip()
    parts = [p.strip() for p in stem.split(",") if p.strip()]
    if len(parts) > 1 and parts[-1].lower() in {"delhi", "new delhi", "up", "uttar pradesh"}:
        parts = parts[:-1]
    return ", ".join(parts) or (name or "Unknown")


def _zone(lat: float, lon: float) -> str:
    """Geographic grouping. Derived from the coordinate, not assigned."""
    lat_min, lat_max, lon_min, lon_max = DELHI
    if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
        return "NCR Outer"
    if _km(lat, lon, *CENTRE) <= CENTRAL_KM:
        return "Central"
    dlat, dlon = lat - CENTRE[0], lon - CENTRE[1]
    if abs(dlat) >= abs(dlon):
        return "North" if dlat > 0 else "South"
    return "East" if dlon > 0 else "West"


@dataclass(frozen=True)
class SensorMeta:
    """One pollutant's sensor at one station, as the catalogue describes it."""
    pollutant: str
    unit: str


def _catalogue() -> dict[int, dict[str, Any]]:
    """Station metadata keyed by location_id, with the unit of each sensor.

    The unit matters more than anything else here. NO2, SO2 and CO arrive in
    ppb, and their breakpoint tables are in ug/m3 (mg/m3 for CO); reading a ppb
    value against a ug/m3 table understates NO2 by about 1.9x and would quietly
    lower every AQI it touched. aqi_cpcb does the conversion, but only if it is
    told the unit, so the unit is carried per sensor rather than assumed.
    """
    path = DATA / "raw" / "stations" / "catalog.json"
    cat = json.loads(path.read_text(encoding="utf-8"))

    out: dict[int, dict[str, Any]] = {}
    for s in cat["stations"]:
        if s.get("latitude") is None or s.get("longitude") is None:
            continue
        sensors: dict[str, SensorMeta] = {}
        for pol, entries in (s.get("sensors") or {}).items():
            if pol not in AQI_POLLUTANTS or not entries:
                continue
            # Newest deployment wins: several stations carry a decommissioned
            # 2016-2018 sensor whose unit differs from the one in service.
            newest = max(entries, key=lambda e: str(e.get("last") or ""))
            unit = newest.get("units")
            if unit:
                sensors[pol] = SensorMeta(pollutant=pol, unit=str(unit))
        name = s.get("location_name") or ""
        out[int(s["location_id"])] = {
            "name": _display_name(name),
            "full_name": name,
            "agency": _agency(name, s.get("provider")),
            "lat": float(s["latitude"]),
            "lon": float(s["longitude"]),
            "sensors": sensors,
        }
    return out


def _observations(season: int, pollutants: tuple[str, ...]) -> dict[str, pd.DataFrame]:
    """Hourly station measurements, one wide frame per pollutant.

    Gaps are left as NaN rather than filled. The forecaster fills them because
    its IDW weights must stay constant; here a gap is information - it is what
    decides whether a station has enough hours to be indexed at all.
    """
    root = DATA / "raw" / "observations" / f"season={season}"
    frames: dict[str, pd.DataFrame] = {}
    for pol in pollutants:
        files = sorted(root.glob(f"{pol}_*.parquet"))
        if not files:
            logger.info("no %s observations for season %d", pol, season)
            continue
        df = pd.concat(
            [pd.read_parquet(f, columns=["timestamp_utc", "location_id", "value"]) for f in files]
        ).dropna(subset=["value"])
        df["timestamp_utc"] = pd.to_datetime(df.timestamp_utc, utc=True).dt.floor("h")
        wide = df.pivot_table(
            index="timestamp_utc", columns="location_id", values="value", aggfunc="mean"
        )
        frames[pol] = wide
    return frames


def _window(wide: pd.DataFrame, station: int, end: pd.Timestamp) -> list[float | None]:
    """The trailing 24 hours for one station, hour by hour, gaps as None."""
    if station not in wide.columns:
        return []
    idx = pd.date_range(end - pd.Timedelta(hours=WINDOW_HOURS - 1), end, freq="h", tz="UTC")
    col = wide[station].reindex(idx)
    return [None if pd.isna(v) else float(v) for v in col]


@lru_cache(maxsize=4)
def build(season: int = 2025, as_of: str | None = None) -> dict[str, Any]:
    """The whole mesh at one instant, ready to serve.

    Cached per (season, as_of). In archive replay the instant is fixed, so this
    runs once for the life of the process.
    """
    meta = _catalogue()
    obs = _observations(season, AQI_POLLUTANTS)
    if "pm25" not in obs:
        logger.warning("no PM2.5 observations for season %d; registry empty", season)
        return {"stations": [], "season": season, "as_of": None, "count": 0}

    pm25 = obs["pm25"]
    end = pd.Timestamp(as_of).tz_convert("UTC").floor("h") if as_of else pm25.index.max()

    stations: list[dict[str, Any]] = []
    for sid in sorted(set(pm25.columns) & set(meta)):
        info = meta[sid]

        readings: list[tuple[str, float | None, str]] = []
        measured: list[str] = []
        for pol in AQI_POLLUTANTS:
            wide = obs.get(pol)
            if wide is None:
                continue
            sensor = info["sensors"].get(pol)
            if sensor is None:
                # Present in the parquet but not the catalogue: without a unit
                # there is no safe way to index it, so it is left out rather
                # than guessed at.
                continue
            series = _window(wide, sid, end)
            if not series or all(v is None for v in series):
                continue
            measured.append(pol)
            readings.extend((pol, v, sensor.unit) for v in series)

        result = aqi_cpcb.compute_aqi_from_readings(readings)
        payload = result.as_dict()

        pm_series = _window(pm25, sid, end)
        latest = next((v for v in reversed(pm_series) if v is not None), None)
        prev = _window(pm25, sid, end - pd.Timedelta(hours=WINDOW_HOURS))
        prev_valid = [v for v in prev if v is not None]
        now_valid = [v for v in pm_series if v is not None]
        delta = None
        if prev_valid and now_valid:
            a, b = float(np.mean(prev_valid)), float(np.mean(now_valid))
            if a > 0:
                delta = round((b - a) / a * 100.0, 1)

        hours = len(now_valid)
        stations.append(
            {
                "id": int(sid),
                "name": info["name"],
                "full_name": info["full_name"],
                "agency": info["agency"],
                "zone": _zone(info["lat"], info["lon"]),
                "lat": round(info["lat"], 6),
                "lon": round(info["lon"], 6),
                "pm25": None if latest is None else round(latest, 1),
                "delta_24h_pct": delta,
                # Real coverage over the indexing window, not an uptime figure
                # invented to look reassuring.
                "hours_observed": hours,
                "hours_expected": WINDOW_HOURS,
                "coverage_pct": round(hours / WINDOW_HOURS * 100.0, 1),
                "sensors_reporting": len(measured),
                "pollutants": measured,
                **payload,
            }
        )

    valid = sum(1 for s in stations if s["valid"])
    logger.info(
        "station registry: %d stations, %d indexable, as_of %s",
        len(stations), valid, end.isoformat(),
    )
    return {
        "season": season,
        "as_of": end.isoformat(),
        "count": len(stations),
        "indexable": valid,
        "window_hours": WINDOW_HOURS,
        "index": "CPCB National AQI (2014)",
        "pollutants_indexed": list(AQI_POLLUTANTS),
        "pollutants_excluded": EXCLUDED,
        # Said plainly, because the console's number is computed differently and
        # a viewer comparing the two pages deserves to know why they differ.
        "note": (
            "National AQI is the worst of six measured sub-indices; the console "
            "forecast indexes PM2.5 alone, so this figure is greater than or "
            "equal to it and names the pollutant responsible."
        ),
        "stations": stations,
    }


def describe(season: int = 2025, as_of: str | None = None) -> dict[str, Any]:
    """Counts only, for /api/v1/status."""
    reg = build(season, as_of)
    return {
        "count": reg["count"],
        "indexable": reg.get("indexable", 0),
        "as_of": reg["as_of"],
        "index": reg.get("index"),
    }
