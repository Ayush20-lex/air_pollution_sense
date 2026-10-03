"""
Live meteorology for the NCR domain, from Open-Meteo.

Why this exists
---------------
`gfs_reader` serves the same quantities from a parquet the partner pipeline
commits, and its own docstring says where temperature and wind are supposed to
come from: "temperature and wind arrive from Open-Meteo at 68 station points".
They did - but only in the *archive*, through
ml_pipeline/scripts/12_fetch_openmeteo_forecast.py at dataset-build time. The
running API never called Open-Meteo at all, so the only met source a reader
could see was a file, and on 3 October 2026 that file was 299.6 hours old with
its entire 72-hour window in the past. The panel correctly reported "expired",
which is honest and useless: a live, keyless, working source of the same fields
was sitting unused in the repository.

This is the live one. Same model, even - `models=gfs_seamless` is NCEP GFS, so
this is not a second opinion against the parquet's forecast, it is that forecast
without the staleness.

What it is not
--------------
A forecast input. `gfs_reader` refuses to feed `baseline_forecaster` or
`channel_spec` because the blend baseline is validated at 61.62 ug/m3 over
3,993,801 scored comparisons, and a new field would invalidate that number with
no time to re-score it. The source being live changes nothing about that
reasoning, so this keeps the same discipline: a read-only side channel, reported
and drawn, never fed back.

Two unit traps, both already paid for once in this repository
-------------------------------------------------------------
**Wind.** Open-Meteo's default is km/h, and 12_fetch_openmeteo_forecast.py sends
no `wind_speed_unit` - which is why `channel_spec` carries a note that
`baseline_forecaster` reports wind 3.6x too large. This sends
`wind_speed_unit=ms` explicitly and then asserts the unit that came back, rather
than trusting a default that has already been wrong once here.

**Precipitation window.** The parquet's column is `precipitation_mm_3h`, an
accumulation over the three hours ending at valid_time, and `gfs_reader` warns
that "a 3-hour bucket read as an hourly rate is wrong by 3x and nothing
downstream would raise". Open-Meteo's hourly `precipitation` is the *one* hour
ending at the timestamp. It is therefore published here as
`precipitation_mm_1h`, under a deliberately different key, so that a consumer
treating the two as one quantity fails to find the name rather than being
quietly wrong by three.

Wind is published as u/v in m/s rather than speed and bearing, because that is
what the twelve channels use and what the parquet publishes. The conversion
follows the meteorological convention that a direction is where the wind comes
*from*.

Absence is a normal state
-------------------------
No key is needed, but a network can still fail. `load()` then returns None and
the caller falls back to the parquet or answers 204, exactly as before this
module existed. Nothing that works today depends on this answering.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

import log_safety

logger = logging.getLogger("openmeteo_live")

API = "https://api.open-meteo.com/v1/forecast"

#: NCEP GFS, so this is the same model the committed parquet holds. Named
#: explicitly rather than left to Open-Meteo's default blend: the point of this
#: module is to be the live version of that file, not a different forecast.
MODEL = "gfs_seamless"

#: The nine 0.25-degree nodes inside the forecast domain, matching
#: `gfs_reader`'s LAT_MIN/LAT_MAX and LON_MIN/LON_MAX so the two payloads
#: describe the same region and can be read against each other.
LATS = (28.25, 28.50, 28.75)
LONS = (77.00, 77.25, 77.50)

#: How far ahead to serve. The parquet runs f000 to f072, so this matches it.
#: Four days are requested because Open-Meteo's hourly series starts at 00:00
#: today and the hours already past are trimmed off below.
HORIZON_H = 72

#: Our name on the left, the unit we publish on the right.
#: `wind_speed_10m`/`wind_direction_10m` do not appear: they are consumed into
#: u/v rather than published as themselves.
FIELDS: dict[str, str] = {
    "temperature_c": "C",
    "u_wind_ms": "m/s",
    "v_wind_ms": "m/s",
    "relative_humidity_pct": "%",
    "boundary_layer_height_m": "m",
    "shortwave_radiation_wm2": "W/m2",
    # One hour, not three. See the module docstring.
    "precipitation_mm_1h": "mm/1h",
}

HOURLY = (
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "boundary_layer_height",
    "precipitation",
    "shortwave_radiation",
)

#: Below this, a boundary-layer height is a fill value and not a profile.
#:
#: GFS's PBL over this domain went 2760 m at 10z, 2820 m at 11z, then 15 m at
#: 12z and sat on 10 m for most of the night. A mixed layer does not fall by two
#: orders of magnitude in an hour, and 10 m is the exact floor the field never
#: goes below - across `gfs_seamless` and `gfs_global` alike, with `best_match`
#: showing the same shape against a floor of 25 m. ECMWF and ICON do not publish
#: the field at all, so there is no model here to switch to that reports a
#: credible nocturnal PBL.
#:
#: The daytime values are good and this is the field the project most needs - it
#: is channel 9 and one whole side of the aerosol-PBL loop - so the field stays.
#: What cannot stay is serving 10 m as a measurement: a real nocturnal boundary
#: layer over a city is one to three hundred metres, so 10 m is not a low
#: reading, it is no reading, and it would be read as a catastrophic inversion.
#: Those values are published as null and counted in `rows_floored`, so the
#: panel shows a gap it can see rather than a number it cannot question.
#:
#: 50 m is below any real mixed layer over Delhi and above both floors, so it
#: removes the fills without touching a genuinely low night.
#:
#: Worth knowing: `channel_spec` records the observed PBL range over the
#: training archive as "10 .. 3920 m". That archive is built by
#: 12_fetch_openmeteo_forecast.py from this same API, so the same floor is
#: already in the gridded dataset. This guard covers the live path only.
PBL_FLOOR_M = 50.0

#: The unit string Open-Meteo must echo back for wind. Asserted rather than
#: assumed: the default is km/h, and silently accepting it would reproduce the
#: 3.6x error `channel_spec` documents.
WIND_UNIT_EXPECTED = "m/s"

TIMEOUT = 20

#: Open-Meteo republishes hourly, so anything under an hour is free freshness.
#: Fifteen minutes keeps a demo responsive without leaning on a free endpoint.
CACHE_S = 900

#: How long to stop asking after a failure, so an outage costs one timeout
#: rather than one per request - the same guard `cpcb_live` carries.
RETRY_AFTER_S = 120

_cache: tuple[float, dict[str, Any] | None] = (0.0, None)
_failed_at = 0.0


def available() -> bool:
    """Always true: Open-Meteo needs no key.

    Kept as a function so this module reads like the other feeds, and so a
    future requirement for a key has somewhere to go.
    """
    return True


def _uv(speed: float | None, direction: float | None) -> tuple[float | None, float | None]:
    """Speed and bearing to u/v components, both m/s.

    Meteorological convention: `direction` is where the wind blows *from*, so a
    northerly (0 degrees) has a negative v. Getting this backwards flips the
    corridor - a wind carrying stubble smoke down from Punjab would be drawn
    pushing it away - so the sign is not cosmetic.
    """
    if speed is None or direction is None:
        return None, None
    rad = math.radians(direction)
    return -speed * math.sin(rad), -speed * math.cos(rad)


def _fetch() -> list[dict[str, Any]]:
    """Every node in one request. Open-Meteo takes parallel coordinate lists."""
    r = requests.get(
        API,
        params={
            "latitude": ",".join(str(x) for x in LATS for _ in LONS),
            "longitude": ",".join(str(y) for _ in LATS for y in LONS),
            "hourly": ",".join(HOURLY),
            "wind_speed_unit": "ms",
            "timezone": "UTC",
            "forecast_days": 4,
            "models": MODEL,
        },
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    body = r.json()
    # One location comes back as an object, several as a list. Nine are asked
    # for, but the branch is kept so a narrowed domain cannot crash the reader.
    return body if isinstance(body, list) else [body]


def _build() -> dict[str, Any] | None:
    locations = _fetch()
    if not locations:
        return None

    first = locations[0]
    got = (first.get("hourly_units") or {}).get("wind_speed_10m")
    if got != WIND_UNIT_EXPECTED:
        # Refuse rather than publish. A km/h figure sitting in a field declared
        # m/s is the one failure here that looks entirely plausible on screen.
        raise RuntimeError(
            f"Open-Meteo returned wind in {got!r}, expected {WIND_UNIT_EXPECTED!r}; "
            "refusing to publish a wind field whose unit is not the one declared"
        )

    times: list[str] = (first.get("hourly") or {}).get("time") or []
    if not times:
        return None

    # Trim to a forward-looking window. The hourly series starts at 00:00 today,
    # so without this the payload would open with hours that have already
    # happened and `hours_remaining` would be measuring the wrong thing.
    now = datetime.now(timezone.utc)
    start = now.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=HORIZON_H)

    series: list[dict[str, Any]] = []
    counted: dict[str, int] = {f: 0 for f in FIELDS}
    floored = 0

    for i, stamp in enumerate(times):
        ts = datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)
        if ts < start or ts > end:
            continue
        cells: list[dict[str, Any]] = []
        for loc in locations:
            hourly = loc.get("hourly") or {}

            def at(name: str, _h: dict[str, Any] = hourly, _i: int = i) -> float | None:
                col = _h.get(name) or []
                v = col[_i] if _i < len(col) else None
                return None if v is None else float(v)

            u, v = _uv(at("wind_speed_10m"), at("wind_direction_10m"))

            # See PBL_FLOOR_M. Dropped rather than clamped: a clamp would still
            # be a number, and the honest answer here is that there isn't one.
            pbl = at("boundary_layer_height")
            if pbl is not None and pbl <= PBL_FLOOR_M:
                pbl = None
                floored += 1

            cell: dict[str, Any] = {
                # The coordinates Open-Meteo actually served, which are the
                # model's nearest node and not necessarily what was asked for.
                "lat": round(float(loc["latitude"]), 4),
                "lon": round(float(loc["longitude"]), 4),
                "temperature_c": at("temperature_2m"),
                "u_wind_ms": None if u is None else round(u, 3),
                "v_wind_ms": None if v is None else round(v, 3),
                "relative_humidity_pct": at("relative_humidity_2m"),
                "boundary_layer_height_m": pbl,
                "shortwave_radiation_wm2": at("shortwave_radiation"),
                "precipitation_mm_1h": at("precipitation"),
            }
            for f in FIELDS:
                if cell[f] is not None:
                    counted[f] += 1
            cells.append(cell)

        series.append({
            "valid_time": ts.isoformat(),
            "lead_hours": int((ts - start).total_seconds() // 3600),
            "cells": cells,
        })

    if not series:
        return None

    fetched = datetime.now(timezone.utc)
    return {
        "source": "open_meteo",
        "export": "api.open-meteo.com/v1/forecast",
        "via": f"live fetch, {MODEL} (NCEP GFS)",
        "resolution_deg": 0.25,
        "grid_points": len(locations),
        # Open-Meteo does not publish which GFS run answered, so there is no
        # cycle id to report. Empty rather than invented.
        "cycles": [],
        "is_synthetic": False,
        "first_valid": series[0]["valid_time"],
        "last_valid": series[-1]["valid_time"],
        "steps": len(series),
        # `rows` counts values actually present. Open-Meteo publishes no QC or
        # imputation flags, so the two counts below are zero to keep the shape
        # the parquet uses - zero meaning "none reported by the upstream", not
        # "every value independently verified". `quality_note` says so.
        "fields": {
            f: {
                "unit": unit,
                "rows": counted[f],
                "rows_flagged": 0,
                "rows_imputed": 0,
                # Only the one field this applies to carries the count, so a
                # reader is not invited to look for it on the others.
                **({"rows_floored": floored} if f == "boundary_layer_height_m" else {}),
            }
            for f, unit in FIELDS.items()
        },
        "fields_absent": [f for f in FIELDS if counted[f] == 0],
        "quality_note": (
            "Open-Meteo publishes no QC or imputation flags; rows_flagged and "
            "rows_imputed are zero because none are reported, not because the "
            f"values were checked here. boundary_layer_height_m is the exception: "
            f"{floored} value(s) at or below {PBL_FLOOR_M:.0f} m were withheld as "
            "fill rather than served as a boundary layer - GFS floors the field "
            "at 10 m overnight and a real one over Delhi is 100-300 m."
        ),
        "fetched_at": fetched.isoformat(),
        "read_at": fetched.isoformat(),
        "series": series,
    }


def _freshness(data: dict[str, Any]) -> dict[str, Any]:
    """How old the fetch is, and whether its window has run out.

    Computed per call and never cached, for the reason `gfs_reader._freshness`
    gives: an age frozen at first read is a worse answer than no age at all.

    What ages here is the *fetch* - there is no file to go stale and no cycle id
    to read - so `cycle_init` carries the fetch time and the note says as much.
    The field names are the ones the page already understands; the meaning is
    stated rather than left to be guessed from the name.
    """
    now = datetime.now(timezone.utc)
    fetched = datetime.fromisoformat(data["fetched_at"])
    last = datetime.fromisoformat(data["last_valid"])
    age = (now - fetched).total_seconds() / 3600.0
    remaining = (last - now).total_seconds() / 3600.0
    expired = remaining <= 0

    if expired:
        status = "expired"
    elif age > 6.0:
        status = "stale"
    elif age > 1.0:
        status = "aging"
    else:
        status = "fresh"

    note = ("fetched live, so what ages here is the fetch rather than a "
            "committed cycle; Open-Meteo republishes hourly")
    if expired:
        note = ("the fetched window is entirely in the past, which for a live "
                "feed means a cached fetch outlived it; the next one replaces it")

    return {
        "status": status,
        "cycle_init": fetched.isoformat(),
        "cycle_age_hours": round(age, 1),
        "hours_remaining": round(remaining, 1),
        "expired": expired,
        "evaluated_at": now.isoformat(),
        "note": note,
    }


def _with_age(payload: dict[str, Any]) -> dict[str, Any]:
    """Shallow copy, so a cached payload never acquires a frozen timestamp."""
    return {**payload, "freshness": _freshness(payload)}


def load() -> dict[str, Any] | None:
    """The live met series, with its age measured at the moment of the call."""
    global _cache, _failed_at

    at, cached = _cache
    if cached is not None and time.monotonic() - at < CACHE_S:
        return _with_age(cached)

    # Recently failed: answer at once rather than make this request pay the
    # timeout the last one already paid.
    if _failed_at and time.monotonic() - _failed_at < RETRY_AFTER_S:
        return _with_age(cached) if cached else None

    try:
        built = _build()
    except Exception as exc:  # noqa: BLE001 - the parquet and the archive stand
        _failed_at = time.monotonic()
        logger.warning("Open-Meteo unavailable (%s); not retrying for %ds",
                       log_safety.safe(exc), RETRY_AFTER_S)
        # Serve the previous fetch if there is one: its freshness states how old
        # it is, which is a better answer than nothing.
        return _with_age(cached) if cached else None

    _failed_at = 0.0
    if built is None:
        return None
    _cache = (time.monotonic(), built)
    return _with_age(built)


def describe() -> dict[str, Any]:
    """Short summary for /api/v1/status, without the series."""
    data = load()
    if data is None:
        return {"available": False, "reason": "Open-Meteo did not answer"}
    return {
        "available": True,
        "source": data["source"],
        "via": data["via"],
        "grid_points": data["grid_points"],
        "steps": data["steps"],
        "fields": sorted(data["fields"]),
        "fields_absent": data["fields_absent"],
        "first_valid": data["first_valid"],
        "last_valid": data["last_valid"],
        "freshness": data["freshness"],
    }
