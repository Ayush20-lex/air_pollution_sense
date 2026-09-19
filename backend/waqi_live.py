"""
WAQI live feed - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Real-time station readings, for the mesh only.

Why this exists
---------------
The archive is a mirror of CPCB through OpenAQ and it publishes about 42 hours
behind - measured across all four pollutants, median 42 h, and only five of 68
stations fresher than that. No amount of polling moves it; the lag is the
source's. Anyone checking a public AQI site during a demo sees the difference.

WAQI publishes the same CPCB stations within the hour. This reads it for the
*mesh* - what the air is doing now. The forecast keeps running on the archive,
because its 62.23 ug/m3 was scored there and swapping the source underneath it
would invalidate the one validated number in the project.

The units problem, and what is done about it
--------------------------------------------
WAQI does not return concentrations. Its `iaqi` values are US EPA sub-indices:
a station reporting `aqi: 89` with `dominentpol: pm25` has `iaqi.pm25.v = 89`,
which is an index, not ug/m3. Everything here indexes under CPCB, so each value
is inverted through the EPA breakpoints back to a concentration and re-indexed.

That inversion is only defensible where the two standards average over the same
window, and for three pollutants they do:

    PM2.5   24-hour  in both          -> used
    PM10    24-hour  in both          -> used
    O3      8-hour maximum in both    -> used
    NO2     1-hour EPA, 24-hour CPCB  -> excluded
    SO2     1-hour EPA, 24-hour CPCB  -> excluded
    CO      8-hour EPA, 8-hour CPCB, but the archive's CO is already withheld
            over a unit contradiction; adding a second CO path would make two
            differently-wrong numbers instead of one honest gap.

Three is exactly CPCB's minimum, so a station with all three can be indexed and
one without cannot - the same refusal the archive path already makes.

The round trip costs precision. WAQI rounds the sub-index to an integer, so
inverting lands on a concentration band rather than a point; the midpoint is
taken. At PM2.5 AQI 89 that is +/- 0.2 ug/m3, at AQI 400 nearer +/- 2. Both are
far inside the measurement's own uncertainty, and the alternative - presenting a
US index beside a National one on the same page - is worse than a rounding error.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

logger = logging.getLogger("waqi_live")

API = "https://api.waqi.info"
TIMEOUT = 20

#: NCR, matching the forecast grid so the two describe the same region.
BOUNDS = (28.20, 76.80, 28.90, 77.60)   # lat1, lon1, lat2, lon2

#: EPA breakpoints, (c_low, c_high, i_low, i_high), in the unit EPA tabulates.
#: Only the three whose averaging window matches CPCB's are here - the rest are
#: absent on purpose rather than commented out, so nothing can quietly start
#: using them.
EPA: dict[str, tuple[str, list[tuple[float, float, int, int]]]] = {
    "pm25": ("ugm3", [
        (0.0, 12.0, 0, 50), (12.1, 35.4, 51, 100), (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200), (150.5, 250.4, 201, 300),
        (250.5, 350.4, 301, 400), (350.5, 500.4, 401, 500),
    ]),
    "pm10": ("ugm3", [
        (0, 54, 0, 50), (55, 154, 51, 100), (155, 254, 101, 150),
        (255, 354, 151, 200), (355, 424, 201, 300),
        (425, 504, 301, 400), (505, 604, 401, 500),
    ]),
    "o3": ("ppb", [
        (0, 54, 0, 50), (55, 70, 51, 100), (71, 85, 101, 150),
        (86, 105, 151, 200), (106, 200, 201, 300),
    ]),
}

#: Why each omitted pollutant is omitted, carried to the caller rather than
#: left as a silent absence - a missing sub-index changes the AQI.
EXCLUDED: dict[str, str] = {
    "no2": "EPA indexes NO2 over 1 hour and CPCB over 24; the live sub-index is "
           "not the same quantity and inverting it would produce a number that "
           "looks like a 24-hour mean and is not one.",
    "so2": "same window mismatch as NO2 - EPA 1 hour against CPCB 24.",
    "co": "the archive already withholds CO over a unit contradiction in the "
          "catalogue; a second, differently-derived CO would give two wrong "
          "numbers rather than one honest gap.",
}


def token() -> str | None:
    """WAQI token from the environment, or the partner pipeline's .env."""
    t = os.getenv("WAQI_TOKEN", "").strip()
    if t:
        return t
    from pathlib import Path
    env = Path(__file__).resolve().parents[1] / "external_data_pipeline" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("WAQI_TOKEN="):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    return None


def from_epa(pollutant: str, index: float) -> float | None:
    """EPA sub-index back to a concentration, at the band's midpoint.

    WAQI rounds the index to an integer, so an index maps to a range rather than
    a point. The midpoint is the honest reading of that range; the alternative
    is to pick an end and be biased in one direction at every station.
    """
    spec = EPA.get(pollutant)
    if spec is None or index is None:
        return None
    _, table = spec
    for c_lo, c_hi, i_lo, i_hi in table:
        if i_lo <= index <= i_hi:
            if i_hi == i_lo:
                return (c_lo + c_hi) / 2.0
            span = (c_hi - c_lo) / (i_hi - i_lo)
            low = c_lo + (index - i_lo) * span
            return round(low + span / 2.0, 2)
    # Above the table. EPA stops at 500; report the top concentration rather
    # than extrapolating a band that the standard does not define.
    return float(table[-1][1])


def _get(path: str, tok: str, **params: Any) -> Any:
    r = requests.get(f"{API}{path}", params={"token": tok, **params}, timeout=TIMEOUT)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "ok":
        raise RuntimeError(f"WAQI {path}: {body.get('data')}")
    return body["data"]


def list_stations(tok: str) -> list[dict[str, Any]]:
    """Every WAQI station inside the NCR box."""
    lat1, lon1, lat2, lon2 = BOUNDS
    data = _get("/map/bounds/", tok, latlng=f"{lat1},{lon1},{lat2},{lon2}")
    out = []
    for s in data:
        try:
            out.append({
                "uid": int(s["uid"]),
                "lat": float(s["lat"]),
                "lon": float(s["lon"]),
                "name": (s.get("station") or {}).get("name", ""),
                "time": (s.get("station") or {}).get("time"),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def read_station(uid: int, tok: str) -> dict[str, Any] | None:
    """One station's sub-indices, inverted to concentrations."""
    try:
        d = _get(f"/feed/@{uid}/", tok)
    except Exception as exc:  # noqa: BLE001 - one bad station must not stop the mesh
        logger.info("WAQI station %s unreadable (%s)", uid, exc)
        return None

    iaqi = d.get("iaqi") or {}
    conc: dict[str, float] = {}
    for pol in EPA:
        v = (iaqi.get(pol) or {}).get("v")
        if v is None:
            continue
        c = from_epa(pol, float(v))
        if c is not None:
            conc[pol] = c

    station = d.get("city") or {}
    return {
        "uid": uid,
        "name": station.get("name", ""),
        "lat": (station.get("geo") or [None, None])[0],
        "lon": (station.get("geo") or [None, None])[1],
        "observed_at": (d.get("time") or {}).get("iso"),
        "aqi_us": d.get("aqi") if isinstance(d.get("aqi"), int) else None,
        "dominant_us": d.get("dominentpol"),
        # In CPCB's units, ready for aqi_cpcb: ug/m3 for particulates, ppb for
        # ozone, which to_cpcb_units converts.
        "concentrations": conc,
        "units": {p: EPA[p][0] for p in conc},
    }


def available() -> bool:
    return token() is not None


def describe() -> dict[str, Any]:
    """Short status for /api/v1/status."""
    if not available():
        return {
            "available": False,
            "reason": "no WAQI_TOKEN; the mesh falls back to the archive, which "
                      "publishes about 42 hours behind",
        }
    return {"available": True, "source": "waqi", "pollutants": sorted(EPA),
            "excluded": EXCLUDED}
