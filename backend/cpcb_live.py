"""
CPCB's own hourly bulletin, taken directly from data.gov.in.

Why this exists when `waqi_live` already serves live stations
-------------------------------------------------------------
WAQI is CPCB's data with two lossy steps in between. It publishes *US EPA
sub-indices*, not concentrations, so `waqi_live` has to invert each integer
index back through the EPA breakpoints to guess a concentration and then
re-index it under CPCB. Two things follow, and both were visible on screen:

  - NO2 and SO2 have to be dropped, because EPA indexes them over one hour and
    CPCB over twenty-four. A station whose worst pollutant is NO2 therefore
    reports the second-worst, and the AQI comes out low.

  - What survives is a reconstruction. Against CPCB's own bulletin for the
    same hour, Wazirpur read 99 ug/m3 of PM2.5 - a sub-index of about 228,
    "Poor" - while the reconstructed figure for the neighbouring Wazirpur site
    was 50.3, a sub-index of 84, "Satisfactory".

This reads the same numbers CPCB publishes: real concentrations, every
pollutant, already averaged over the window the standard requires. There is
nothing to invert and nothing to drop, so the index this produces is the index
CPCB itself would produce.

`avg_value` is the *sub-index*, not the concentration it was computed from.
This was read the other way round at first and every station came out far too
high - Knowledge Park V reported 270 where CPCB publishes 140, because a
sub-index of 111 was fed back through the PM2.5 breakpoints as though it were
111 ug/m3.

Two things in the payload settle it. PM10's maximum across the network is lower
than PM2.5's, which cannot happen for concentrations because PM10 includes
PM2.5; it happens constantly for sub-indices, PM2.5 having much stricter
breakpoints. And CO tops out near 99, which as a sub-index is ordinary and as
mg/m3 would be lethal.

So the station AQI is simply the worst sub-index, which is CPCB's own
definition. Nothing is indexed here; the indexing was already done upstream.
The concentrations are not published in this resource, and are reported absent
rather than inverted back out of the index - that reconstruction is exactly
what makes the WAQI path lossy.

Absence is a normal state. Without a key, or if data.gov.in is down, `mesh()`
returns None and the caller stays on whatever it was already serving.
"""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

import aqi_cpcb

logger = logging.getLogger("cpcb_live")

API = "https://api.data.gov.in/resource"
#: "Real time Air Quality Index from various locations", CPCB, hourly.
RESOURCE = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"

TIMEOUT = 20
#: data.gov.in caps a single response; the record count for NCR runs to a few
#: hundred across pollutants, so it is paged rather than asked for at once.
PAGE = 500
MAX_PAGES = 12

CACHE_S = 600

#: data.gov.in silently black-holes requests carrying the `python-requests`
#: default User-Agent - the connection opens and then never answers, so it
#: surfaces as a read timeout rather than a refusal. curl from the same host
#: gets 200 in under half a second. Any ordinary agent string is accepted; this
#: one says what the caller actually is.
HEADERS = {
    "User-Agent": "airsense-ncr/1.0 (SIH26082; CPCB National AQI terminal)",
    "Accept": "application/json",
}

#: CPCB's own spelling on the left, ours on the right. `pollutant_id` uses
#: OZONE rather than O3, which is the one that would silently drop ozone.
POLLUTANT = {
    "PM2.5": "pm25",
    "PM10": "pm10",
    "NO2": "no2",
    "SO2": "so2",
    "OZONE": "o3",
    "NH3": "nh3",
    # Indexed here, unlike the archive: the unit objection was to a CO
    # *concentration* of ambiguous unit. A sub-index has no unit to mistake.
    "CO": "co",
}

#: Nothing is withheld here - every pollutant CPCB indexes arrives already
#: indexed, so there is no unit to misread and no window to mismatch.
EXCLUDED: dict[str, str] = {}

#: The NCR districts the terminal covers. CPCB files these under several
#: cities; matching on city keeps Punjab and the rest of UP out of the mesh.
NCR_CITIES = {
    "Delhi", "Gurugram", "Faridabad", "Noida", "Greater Noida", "Ghaziabad",
    "Bahadurgarh", "Sonipat", "Panipat", "Rohtak", "Meerut", "Baghpat",
    "Bulandshahr", "Hapur", "Manesar", "Ballabgarh", "Dharuhera",
}

_cache: tuple[float, dict[str, Any] | None] = (0.0, None)


def token() -> str | None:
    """data.gov.in API key, from the environment or a local .env."""
    tok = os.environ.get("CPCB_API_KEY") or os.environ.get("DATA_GOV_IN_KEY")
    if tok:
        return tok.strip()
    # Same three places WAQI looks, in the same order, so both keys live
    # together rather than one being findable and the other not.
    for env in (Path(__file__).resolve().parent / ".env",
                Path(__file__).resolve().parents[1] / ".env",
                Path(__file__).resolve().parents[1] / "external_data_pipeline" / ".env"):
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            for name in ("CPCB_API_KEY=", "DATA_GOV_IN_KEY="):
                if line.startswith(name):
                    v = line.split("=", 1)[1].strip()
                    if v:
                        return v
    return None


def available() -> bool:
    return token() is not None


def _page(offset: int, tok: str) -> list[dict[str, Any]]:
    r = requests.get(
        f"{API}/{RESOURCE}",
        params={"api-key": tok, "format": "json", "limit": PAGE, "offset": offset},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "ok":
        raise RuntimeError(f"data.gov.in: {body.get('message')}")
    return body.get("records") or []


def _records(tok: str) -> list[dict[str, Any]]:
    """Every record for the current hour, paged.

    The first page is fetched alone to learn the total; the rest go out
    together. Serially this is a dozen round trips to Delhi and back, which on
    a free instance is most of the request budget.
    """
    first = requests.get(
        f"{API}/{RESOURCE}",
        params={"api-key": tok, "format": "json", "limit": PAGE, "offset": 0},
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    first.raise_for_status()
    body = first.json()
    if body.get("status") != "ok":
        raise RuntimeError(f"data.gov.in: {body.get('message')}")

    records = body.get("records") or []
    total = int(body.get("total") or len(records))
    got = len(records)
    if got == 0:
        return []

    offsets = list(range(got, min(total, got * MAX_PAGES), got))
    if offsets:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for chunk in pool.map(lambda o: _page(o, tok), offsets):
                records.extend(chunk)
    return records


#: CPCB stamps the bulletin "19-09-2026 18:00:00" - day first, no zone. Every
#: other feed here emits ISO, and the dashboard parses these with `new Date()`,
#: which returns Invalid Date for that layout and took the pollutant dialog
#: down with a RangeError. Normalising at the edge keeps one shape in the
#: payload rather than teaching each consumer a second one.
IST = timezone(timedelta(hours=5, minutes=30))


def _iso(stamp: Any) -> str | None:
    """CPCB's "DD-MM-YYYY HH:MM:SS", read as IST, as an ISO string."""
    if not stamp:
        return None
    text = str(stamp).strip()
    for fmt in ("%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST).isoformat()
        except ValueError:
            continue
    # Already ISO, or a layout we do not know - hand it on unchanged rather
    # than dropping the hour entirely.
    return text


def _num(v: Any) -> float | None:
    """CPCB sends numbers as strings, and 'NA' for a sensor that is down."""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.upper() in {"NA", "N/A", "-", "NONE"}:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    # A negative concentration is an instrument fault, not a measurement.
    return f if f >= 0 else None


def _zone(lat: float, lon: float) -> str:
    """Same six-way split the curated mesh uses."""
    if lat >= 28.70:
        return "North"
    if lat <= 28.50:
        return "South" if 77.05 <= lon <= 77.35 else "NCR Outer"
    if lon <= 77.05:
        return "West"
    if lon >= 77.30:
        return "East"
    return "Central"


def _short_name(full: str) -> str:
    """"Wazirpur, Delhi - DPCC" -> "Wazirpur"."""
    return full.split(",", 1)[0].strip() or full


def mesh(force: bool = False) -> dict[str, Any] | None:
    """Every live NCR station, shaped like the archive registry's payload."""
    global _cache
    if not force and _cache[1] is not None and time.monotonic() - _cache[0] < CACHE_S:
        return _cache[1]

    tok = token()
    if not tok:
        return None

    try:
        records = _records(tok)
    except Exception as exc:  # noqa: BLE001 - the caller has a fallback
        logger.warning("CPCB bulletin unavailable (%s); staying on the previous feed", exc)
        return None

    # Group the flat pollutant rows into stations.
    grouped: dict[str, dict[str, Any]] = {}
    for rec in records:
        if rec.get("city") not in NCR_CITIES:
            continue
        name = rec.get("station")
        pol = POLLUTANT.get(str(rec.get("pollutant_id", "")).upper()
                            if str(rec.get("pollutant_id", "")).upper() in POLLUTANT
                            else str(rec.get("pollutant_id", "")))
        value = _num(rec.get("avg_value"))
        if not name or pol is None or value is None:
            continue
        lat, lon = _num(rec.get("latitude")), _num(rec.get("longitude"))
        if lat is None or lon is None:
            continue
        st = grouped.setdefault(name, {
            "name": name, "lat": lat, "lon": lon,
            "last_update": rec.get("last_update"), "conc": {},
        })
        st["conc"][pol] = value

    if not grouped:
        logger.warning("CPCB bulletin held no NCR stations; staying on the previous feed")
        return None

    stations: list[dict[str, Any]] = []
    for idx, (full_name, st) in enumerate(sorted(grouped.items())):
        conc: dict[str, float] = st["conc"]

        subs: dict[str, dict[str, Any]] = {}
        for pol, value in conc.items():
            # Taken as published. `sub_index()` is deliberately not called: the
            # value already is the sub-index, and running it through the
            # breakpoints a second time is what turned Knowledge Park V's 140
            # into 270 and moved its prominent pollutant from PM10 to PM2.5.
            sub = int(round(value))
            if sub < 0:
                continue
            window = aqi_cpcb.AVERAGING_HOURS[pol]
            subs[aqi_cpcb.DISPLAY_NAME[pol]] = {
                "sub_index": sub,
                # Not published in this resource. Null rather than a number
                # inverted back out of the index - that reconstruction is the
                # very thing that makes the WAQI path lossy.
                "concentration": None,
                "window_hours": window,
                # CPCB publishes the indexed figure, not the hours behind it.
                "valid_hours": window,
            }

        reasons: list[str] = []
        aqi = prominent = None
        if len(subs) >= 3:
            worst = max(subs.items(), key=lambda kv: kv[1]["sub_index"])
            prominent, aqi = worst[0], worst[1]["sub_index"]
        else:
            reasons.append(f"{len(subs)} usable pollutant(s); CPCB requires 3")

        stations.append({
            "id": 900_000 + idx,
            "name": _short_name(full_name),
            "full_name": full_name,
            "agency": full_name.rsplit("-", 1)[-1].strip() if "-" in full_name else "CPCB",
            "zone": _zone(st["lat"], st["lon"]),
            "lat": round(st["lat"], 6),
            "lon": round(st["lon"], 6),
            # A sub-index, not a concentration; the map reads this field as
            # ug/m3, so it is left absent rather than filled with the wrong unit.
            "pm25": None,
            # The bulletin carries one hour. There is no previous day in it to
            # compare against, and zero would render as "no change".
            "delta_24h_pct": None,
            "hours_observed": 24,
            "hours_expected": 24,
            "coverage_pct": 100.0,
            "sensors_reporting": len(conc),
            "pollutants": sorted(conc),
            "valid": aqi is not None,
            "aqi": aqi,
            "category": aqi_cpcb.category_for(aqi) if aqi is not None else None,
            "prominent_pollutant": prominent,
            "sub_indices": subs,
            "dropped": {},
            "reasons": reasons,
            "aqi_us": None,
            "observed_at": _iso(st["last_update"]),
        })

    newest = max((s["observed_at"] or "" for s in stations), default=None)
    valid = sum(1 for s in stations if s["valid"])

    payload = {
        "source": "cpcb_live",
        "season": None,
        "as_of": newest,
        "count": len(stations),
        "indexable": valid,
        "window_hours": 24,
        "index": "CPCB National AQI (2014)",
        "note": (
            "CPCB's own hourly bulletin via data.gov.in. The resource publishes "
            "each pollutant's CPCB sub-index, computed by CPCB over the windows "
            "the standard requires - not the concentration behind it - so "
            "sub_indices carry the published index and concentration is null. "
            "Every pollutant it measures is used, including NO2 and SO2, which "
            "the WAQI path has to drop over a window mismatch. Nothing is "
            "inverted or reconstructed here."
        ),
        "pollutants_indexed": sorted(set(POLLUTANT.values())),
        "pollutants_excluded": EXCLUDED,
        "stations": stations,
    }
    _cache = (time.monotonic(), payload)
    return payload


def describe() -> dict[str, Any]:
    """Status line for /api/v1/status."""
    p = _cache[1]
    return {
        "available": available(),
        "source": "data.gov.in / CPCB real-time bulletin",
        "resource": RESOURCE,
        "stations": None if p is None else p["count"],
        "as_of": None if p is None else p["as_of"],
    }
