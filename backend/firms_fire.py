"""
NASA FIRMS Active Fire Client - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Real fire pixels over the Punjab / Haryana / western UP stubble corridor, for
the two channels the forecast has been carrying as zeros.

Why this exists
---------------
The problem statement asks the system to model "the impact of atmospheric
inversion on external pollution spikes, such as regional stubble burning" and to
"predict how stubble-burning plumes will disperse under prevailing weather
conditions". Both need to know where the fires are.

Until now nothing did. `spatial_fusion.generate_mock_firms_df` invents 450 fires
from a seeded RNG, and the served forecast did not even use those - it left FRP
and smoke at zero and said so. The pipeline your team wrote
(`external_data_pipeline/app/ingestion/firms_fetcher.py`) already talks to FIRMS
correctly; the backend simply never called it. This is the backend's own client,
kept here so the forecast does not depend on the pipeline's database being up.

A real zero is not a failure
----------------------------
Fetching 20 September 2026 returns no fires, and that is the correct answer: the
Punjab stubble season runs from about mid-October to late November, and in
September the corridor is quiet. So an empty result is reported as an empty
result - `fires=0, corridor quiet` - and the channel is honestly zero.

What it must never do is fall back to the mock generator to make the map look
busy. That generator draws FRP from `exponential(scale=35)`; the real median
over the 2025 burning peak is 3.3 MW. It does not merely invent fires, it
invents fires an order of magnitude fiercer than the ones that actually burn.

Products
--------
FIRMS serves near-real-time (NRT) for roughly the last two months and standard
processing (SP) for everything older, and asking the wrong one for a date gives
an empty CSV rather than an error - a silent wrong answer. The age of the
requested date picks the product here, and the other is tried before an empty
result is believed.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger("firms_fire")

REPO_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = REPO_ROOT / "ml_pipeline" / "data" / "cache" / "firms"

#: min_lon,min_lat,max_lon,max_lat - the stubble corridor upwind of Delhi, the
#: same box the partner pipeline uses. Wider than NCR on purpose: the fires that
#: matter to Delhi burn 150-300 km northwest of it.
BBOX = "74.0,27.0,78.5,32.5"

#: Days of fire detections to gather from the start date. FIRMS caps this at 10.
#: Three covers the transport time from Punjab to NCR with room to spare - a
#: plume takes about a day at the winter flow of 2-4 m/s.
DEFAULT_DAYS = 3

#: Past this age FIRMS has moved the date from near-real-time into standard
#: processing. Sixty days sits inside NRT's roughly two-month retention with
#: enough margin that a slow SP release does not open a hole between them.
NRT_MAX_AGE_DAYS = 60

NRT_SOURCE = "VIIRS_SNPP_NRT"
SP_SOURCE = "VIIRS_SNPP_SP"

#: Columns the fusion layer needs. `bright_ti4` is VIIRS's brightness
#: temperature and is NOT interchangeable with FRP, which is why only `frp` is
#: read for the radiative power.
COLUMNS = ["latitude", "longitude", "frp", "acq_date"]

#: Fields FIRMS already returns in the same CSV that the fusion layer has no
#: use for but a map does. Kept as a separate list so `COLUMNS` - the contract
#: every existing consumer was written against - is unchanged.
#:
#: `confidence` is NOT a number on VIIRS: it is 'l', 'n' or 'h' (low, nominal,
#: high), so it is read as a string. `acq_time` is a zero-padded HHMM in UTC.
#: `type` is FIRMS's own inference: 0 presumed vegetation fire, 1 active
#: volcano, 2 other static land source, 3 offshore. It is carried because a
#: page that calls every thermal anomaly a stubble fire is overclaiming, and
#: this is the flag that says otherwise.
EXTRA_COLUMNS = [
    "acq_time",
    "satellite",
    "instrument",
    "confidence",
    "daynight",
    "bright_ti4",
    "type",
]
ALL_COLUMNS = COLUMNS + EXTRA_COLUMNS

#: Bumped when the parsed column set changes, because the disk cache stores the
#: parsed frame rather than the raw body. Files written under an older schema
#: are simply no longer looked for - nothing here deletes them.
CACHE_SCHEMA = "v2"

_memo: dict[tuple[str, int], pd.DataFrame] = {}


def token() -> str | None:
    """FIRMS map key from the environment, or the partner pipeline's .env."""
    t = os.getenv("NASA_FIRMS_KEY", "").strip()
    if not t:
        env = REPO_ROOT / "external_data_pipeline" / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("NASA_FIRMS_KEY="):
                    t = line.split("=", 1)[1].strip()
                    break
    if not t or t == "your_nasa_firms_map_key_here":
        return None
    return t


def available() -> bool:
    return token() is not None


def _source_for(start: date) -> tuple[str, str]:
    """(preferred, fallback) product for a start date."""
    age = (datetime.now(timezone.utc).date() - start).days
    return (NRT_SOURCE, SP_SOURCE) if age <= NRT_MAX_AGE_DAYS else (SP_SOURCE, NRT_SOURCE)


def _cache_path(source: str, start: date, days: int) -> Path:
    return CACHE_DIR / f"{source}_{start.isoformat()}_{days}d.{CACHE_SCHEMA}.csv"


def _opt_float(value: Any) -> float | None:
    """A float, or None. Never 0 for a missing reading - see the FRP note."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN is not a measurement either


def _opt_str(value: Any) -> str | None:
    s = str(value).strip() if value is not None else ""
    return s or None


def _parse(body: str) -> pd.DataFrame:
    if "latitude" not in body.lower():
        return pd.DataFrame(columns=ALL_COLUMNS)
    rows = []
    for r in csv.DictReader(io.StringIO(body)):
        try:
            row = {
                "latitude": float(r["latitude"]),
                "longitude": float(r["longitude"]),
                # A pixel with no FRP is a detection without a measured
                # power. Dropped rather than zeroed: zero would dilute the
                # interpolation with a fire that reads as no fire.
                "frp": float(r["frp"]),
                "acq_date": r.get("acq_date", ""),
            }
        except (KeyError, TypeError, ValueError):
            continue
        # Best effort, and only after the row has earned its place: a pixel is
        # still a usable detection when FIRMS omits its confidence flag.
        row["acq_time"] = _opt_str(r.get("acq_time"))
        row["satellite"] = _opt_str(r.get("satellite"))
        row["instrument"] = _opt_str(r.get("instrument"))
        row["confidence"] = (_opt_str(r.get("confidence")) or "").lower() or None
        row["daynight"] = _opt_str(r.get("daynight"))
        row["bright_ti4"] = _opt_float(r.get("bright_ti4"))
        row["type"] = _opt_float(r.get("type"))
        rows.append(row)
    return pd.DataFrame(rows, columns=ALL_COLUMNS)


def _ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Every column in ALL_COLUMNS present, so an older cache cannot KeyError.

    A file written before CACHE_SCHEMA existed carries four columns. It is no
    longer looked for by name, but a frame can also reach here from the memo of
    a process that predates a reload, so the guarantee is made here rather than
    assumed at every call site. The extras are optional everywhere downstream.
    """
    missing = [c for c in ALL_COLUMNS if c not in df.columns]
    if missing:
        df = df.copy()
        for c in missing:
            df[c] = None
    return df


def _download(source: str, start: date, days: int, key: str) -> pd.DataFrame | None:
    url = (
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}"
        f"/{BBOX}/{days}/{start.isoformat()}"
    )
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            body = resp.read().decode("utf-8", "ignore")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # Logged without the URL: it carries the map key.
        logger.warning("FIRMS %s request failed (%s)", source, type(exc).__name__)
        return None
    return _parse(body)


def fetch(start: date | str, days: int = DEFAULT_DAYS) -> pd.DataFrame:
    """Fire pixels over the corridor for `days` from `start`, oldest kept.

    Returns an empty frame when the corridor is quiet or the key is missing;
    both are ordinary answers and neither is filled in with invented fires.
    Results are cached on disk so a replayed origin costs one request ever, and
    so the forecast still builds when FIRMS is unreachable.
    """
    if isinstance(start, str):
        start = date.fromisoformat(start[:10])
    days = max(1, min(10, int(days)))

    memo_key = (start.isoformat(), days)
    if memo_key in _memo:
        return _ensure_columns(_memo[memo_key])

    preferred, fallback = _source_for(start)

    for source in (preferred, fallback):
        path = _cache_path(source, start, days)
        if path.exists():
            df = _ensure_columns(pd.read_csv(path))
            if not df.empty:
                _memo[memo_key] = df
                return df

    key = token()
    if key is None:
        logger.info("no NASA_FIRMS_KEY; the fire channels stay zero and say so")
        empty = pd.DataFrame(columns=ALL_COLUMNS)
        _memo[memo_key] = empty
        return empty

    result = pd.DataFrame(columns=ALL_COLUMNS)
    for source in (preferred, fallback):
        df = _download(source, start, days, key)
        if df is None:
            continue
        if not df.empty:
            result = df
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            df.to_csv(_cache_path(source, start, days), index=False)
            logger.info(
                "FIRMS %s: %d fire pixel(s) over the corridor from %s (+%dd)",
                source, len(df), start, days,
            )
            break
        # An empty NRT answer for an old date means the wrong product, not a
        # quiet corridor - so the fallback is tried before zero is believed.
        logger.info("FIRMS %s returned no pixels for %s; trying the other product",
                    source, start)

    if result.empty:
        logger.info("FIRMS: corridor quiet for %s (+%dd) - fire channels are a real zero",
                    start, days)
        # Cached as an empty file so a quiet date is not re-requested every
        # time the forecast is rebuilt.
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        result.to_csv(_cache_path(preferred, start, days), index=False)

    _memo[memo_key] = result
    return result


def describe(start: date | str | None = None, days: int = DEFAULT_DAYS) -> dict[str, Any]:
    """Status for /api/v1/status. Never raises."""
    if not available():
        return {
            "available": False,
            "reason": "no NASA_FIRMS_KEY; FRP and smoke stay zero rather than mocked",
        }
    out: dict[str, Any] = {
        "available": True,
        "source": "nasa_firms",
        "product": f"{NRT_SOURCE} / {SP_SOURCE}",
        "bbox": BBOX,
        "window_days": days,
    }
    if start is None:
        return out
    try:
        df = fetch(start, days)
    except Exception as exc:  # noqa: BLE001 - status must never fail
        out["error"] = str(exc)
        return out
    s = start if isinstance(start, str) else start.isoformat()
    out["window_start"] = s[:10]
    out["fires"] = int(len(df))
    if df.empty:
        # Said plainly, because a zero here is a fact about the season and not
        # a broken feed - the burning season runs mid-October to late November.
        out["note"] = "no active fires in the corridor for this window"
    else:
        out["frp_total_mw"] = round(float(df["frp"].sum()), 1)
        out["frp_max_mw"] = round(float(df["frp"].max()), 1)
    return out


def season_hint(when: date | str | None = None) -> str:
    """Whether the requested date sits inside the stubble burning season."""
    if when is None:
        when = datetime.now(timezone.utc).date()
    if isinstance(when, str):
        when = date.fromisoformat(when[:10])
    return "burning season" if (when.month == 10 and when.day >= 10) or when.month == 11 \
        else "outside the burning season"


__all__ = [
    "available", "fetch", "describe", "season_hint", "token",
    "BBOX", "DEFAULT_DAYS", "COLUMNS", "ALL_COLUMNS", "CACHE_SCHEMA",
]


# ── plume field ──────────────────────────────────────────────────────────────
#
# Why this is not `spatial_fusion.idw_interpolate`
# ------------------------------------------------
# That function takes the eight nearest fires and returns their inverse-distance
# weighted *average*, which is the right answer for an intensive quantity - a
# station's PM2.5 concentration is a property of a place, and averaging two
# neighbours estimates it. Emitted smoke is extensive: it is a quantity of
# material, and two fires emit twice as much as one.
#
# Averaging therefore makes the plume blind to how much is burning. Measured on
# this archive: 30 fires totalling 85 MW on 15 September and 850 fires totalling
# 4,475 MW on 5 November - 53x the fire energy - produced smoke fields whose
# means differed by 3%. A stubble-burning feature that cannot tell the peak of
# the season from a quiet September day is not one.
#
# So contributions accumulate here, and the field scales with both the number of
# fires and their radiative power.
#
# The transport model
# -------------------
# A steady-state Gaussian plume, which is the standard first approximation and
# is not WRF-Chem. Each fire contributes to a cell only if the cell lies
# downwind of it; the contribution falls off as a Gaussian across the wind and
# as a dilution length along it:
#
#     contribution = FRP x exp(-d_perp^2 / 2*SIGMA_CROSS^2) / (1 + d_along/DECAY)
#
# The parameters are what make Punjab reach Delhi at all: the corridor burns
# 200-300 km northwest of NCR, so a crosswind spread of a few kilometres would
# put every fire's plume outside the domain and return zeros that look like a
# working feature. SIGMA_CROSS is set to the spread a plume reaches after about
# a day of travel, which is the time the transport actually takes at 2-4 m/s.

#: Crosswind spread of a plume by the time it has travelled from the corridor to
#: NCR, in km. Roughly a day of dispersion at typical winter stability.
SIGMA_CROSS_KM = 45.0

#: Along-wind dilution length in km. Concentration falls by half about every
#: 200 km as the plume deepens, disperses and deposits.
DECAY_KM = 200.0

#: Converts accumulated MW x transport weight into the PM2.5 proxy the SMOKE
#: channel is documented to carry (ug/m3). Any such conversion needs an emission
#: factor, a plume depth and a mixing volume; none of those are measured here,
#: so this is calibrated instead against a known episode - the 5 November 2025
#: burning peak, 850 fires totalling 4,475 MW. Replayed with that window's own
#: winds it lands near 73 ug/m3 over the worst cells, against about 7.5 for a
#: quiet September. Published estimates put stubble's share of Delhi PM2.5 at
#: 30-40% during such an episode, against measured totals of 200-400, so a peak
#: contribution in the 60-160 range is the right order and this sits at the
#: lower end of it.
#:
#: The realised peak depends on the winds in the window, not on this constant
#: alone: the same fires under a flow away from Delhi contribute nothing.
#:
#: This is a documented scaling of a proxy, not a measured concentration, and
#: `describe()` says so. It is the one tuned number in this module.
EMISSION_TO_PROXY = 0.22

#: The wind speed the proxy is calibrated at, in m/s - a typical NCR winter
#: flow. A steady-state plume's concentration goes as 1/U: the same fires feed
#: the same material into a faster stream, so it arrives more dilute. Without
#: this term the field depended only on wind direction, and a 1 m/s inversion
#: night delivered exactly the same smoke as an 8 m/s afternoon.
U_REFERENCE_MS = 2.0

#: Smoke that cannot cross the distance within the forecast horizon does not
#: appear in the forecast. Without this the steady-state assumption quietly
#: claimed the plume had already arrived however slowly it was moving: at
#: 0.6 m/s, Punjab smoke needs about 115 hours to reach Delhi, and the field was
#: delivering it in full. The horizon is the honest cutoff - this module is
#: filling a 72-hour forecast, and material still in transit at hour 72 has not
#: influenced it.
MAX_TRANSIT_H = 72.0

#: Fires processed per block. The kernel is cells x fires, so 850 November
#: fires over a 70x80 grid would allocate about 38 MB per intermediate and some
#: six of them at once - 230 MB transient on a box with 258 MB free, which is an
#: OOM on precisely the episode this feature exists to show. Blocking bounds the
#: peak at a few tens of MB whatever the season does, and the sum is identical
#: because contributions accumulate.
FIRE_CHUNK = 128

#: Below this the wind has no reliable direction, so a plume has no axis to be
#: carried along. Under it the fires are treated as a still-air source that
#: spreads symmetrically instead of being advected nowhere.
CALM_MS = 0.5


def plume_field(
    fires: pd.DataFrame,
    u_ms: float,
    v_ms: float,
    shape: tuple[int, int] = (70, 80),
    bounds: tuple[float, float, float, float] = (28.20, 28.90, 76.80, 77.60),
) -> tuple[Any, Any]:
    """(frp_grid, smoke_grid) over the NCR grid from real fire pixels.

    `frp_grid` accumulates radiative power near each cell regardless of wind -
    it is what is burning. `smoke_grid` accumulates only what the wind is
    carrying towards the cell - it is what is arriving. The two differ whenever
    the flow is not from the corridor, which is the point: the same fires
    should darken Delhi on a northwesterly and leave it alone on an easterly.
    """
    import numpy as np

    h, w = shape
    lat_min, lat_max, lon_min, lon_max = bounds
    if fires is None or len(fires) == 0:
        z = np.zeros((h, w), dtype=np.float32)
        return z, z.copy()

    lats = np.linspace(lat_min, lat_max, h)
    lons = np.linspace(lon_min, lon_max, w)
    glat, glon = np.meshgrid(lats, lons, indexing="ij")

    all_lat = fires["latitude"].to_numpy(dtype=np.float64)
    all_lon = fires["longitude"].to_numpy(dtype=np.float64)
    all_frp = fires["frp"].to_numpy(dtype=np.float64)

    speed = float(np.hypot(u_ms, v_ms))
    frp_grid = np.zeros((h, w), dtype=np.float64)
    smoke_grid = np.zeros((h, w), dtype=np.float64)

    for lo in range(0, len(all_lat), FIRE_CHUNK):
        f_lat = all_lat[lo:lo + FIRE_CHUNK]
        f_lon = all_lon[lo:lo + FIRE_CHUNK]
        f_frp = all_frp[lo:lo + FIRE_CHUNK]

        # Local flat-earth km. Good to well under a percent over this domain.
        KM_LAT, KM_LON = 111.0, 97.5
        dy = (glat[..., None] - f_lat[None, None, :]) * KM_LAT   # (h, w, n)
        dx = (glon[..., None] - f_lon[None, None, :]) * KM_LON

        dist = np.hypot(dx, dy)

        # What is burning: distance-weighted accumulation, no wind.
        frp_grid += (f_frp[None, None, :]
                     * np.exp(-(dist ** 2) / (2 * SIGMA_CROSS_KM ** 2))).sum(axis=2)

        if speed < CALM_MS:
            # No axis to project onto, so the plume spreads symmetrically. It
            # must still be diluted by distance the way a directed plume is:
            # without that term the calm field was the undiluted accumulation
            # and jumped by more than an order of magnitude as the wind crossed
            # CALM_MS - a still night looked far smokier than a light breeze.
            weight = np.exp(-(dist ** 2) / (2 * SIGMA_CROSS_KM ** 2)) / (1.0 + dist / DECAY_KM)
            weight = weight * (U_REFERENCE_MS / CALM_MS)
        else:
            ux, vy = u_ms / speed, v_ms / speed
            # Along-wind: positive when the cell is downwind of the fire.
            d_along = dx * ux + dy * vy
            d_perp = np.abs(-dx * vy + dy * ux)
            weight = (np.exp(-(d_perp ** 2) / (2 * SIGMA_CROSS_KM ** 2))
                      / (1.0 + np.maximum(d_along, 0.0) / DECAY_KM))
            # Concentration falls as the wind rises: the same emission spread
            # through a faster stream arrives thinner.
            weight = weight * (U_REFERENCE_MS / max(speed, CALM_MS))
            # Hours for the parcel to travel the along-wind distance.
            transit_h = np.maximum(d_along, 0.0) / (speed * 3.6)
            weight = np.where((d_along > 0.0) & (transit_h <= MAX_TRANSIT_H), weight, 0.0)

        smoke_grid += (f_frp[None, None, :] * weight).sum(axis=2)

    return (
        (frp_grid * EMISSION_TO_PROXY).astype(np.float32),
        (smoke_grid * EMISSION_TO_PROXY).astype(np.float32),
    )
