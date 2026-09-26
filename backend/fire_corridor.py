"""Where the corridor is burning, as pixels rather than one average.

The forecast has always used every VIIRS pixel - `firms_fire.plume_field`
accumulates a Gaussian plume per fire across all of them - but only one number
pair ever escaped to a client. `baseline_forecaster._fire_fields` reduces the
whole corridor to an FRP-weighted centroid, and the map, having nothing else,
drew a single ribbon to it. That is why the site looks like the smoke comes
from one spot: the fires were never collapsed by the physics, they were
collapsed by the serialiser.

This module is that missing serialisation. It takes the frame `firms_fire`
already fetches and caches, and turns it into something a map and a table can
read: the pixels themselves, cells of adjacent pixels grouped into clusters,
rollups by region, and - where the wind supports it - how long the flow would
take to bring a cluster's smoke to Delhi.

Three things it refuses to do, because nothing here measures them:

  * No per-cluster µg/m³. The only concentration-like quantity in the system is
    the SMOKE channel, a proxy scaled by one constant calibrated against a
    single episode. It is a domain figure and it is already published as one.
  * No confidence score for the transit. What exists is the alignment between
    the flow and the bearing to Delhi, and it is reported as that number
    against its threshold.
  * No claim that a thermal anomaly is a stubble fire. FIRMS publishes its own
    `type` flag; a presumed vegetation fire says so and anything else is
    counted separately.

Pure functions, no FastAPI, no module state. Nothing here raises.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

#: The receptor. Same point `spatial_fusion` measures fire transport to and the
#: frontend's NCR_CENTER, so a distance printed here and a bearing drawn there
#: are about the same place.
DELHI_LAT, DELHI_LON = 28.60, 77.21

#: Kilometres per degree at this latitude. The same pair the mesh and the plume
#: kernel use; a shared constant is the only way those three agree on a bearing.
KM_LAT, KM_LON = 111.0, 97.5

#: cos(72.5°). Below this the along-track component of the wind is so small
#: that a transit time computed from it is arithmetic rather than a forecast -
#: dispersion, not advection, would decide when the smoke arrived. The same
#: threshold, for the same reason, as `spatial_fusion.compute_fire_transport`,
#: which is where this calculation already lived; that copy is fed the mock
#: generator and is reachable only on the untrained-model fallback, so the
#: maths is repeated here rather than called.
ALIGN_MIN = 0.3

#: The forecast's own horizon. An arrival past it is not a forecast this system
#: can make, and is reported as out of range rather than as a number.
HORIZON_H = 72.0

#: Cell size for grouping pixels into clusters, in degrees (~27 km × 24 km).
CLUSTER_CELL_DEG = 0.25

#: Cell size for thinning, in degrees (~5.5 km × 4.9 km).
THIN_CELL_DEG = 0.05

#: How the regions are drawn, said in the payload because it is a real limit.
REGION_METHOD = (
    "latitude/longitude boxes, not official boundaries: a detection within "
    "roughly 50 km of a state line may be attributed to its neighbour"
)

CLUSTER_METHOD = (
    f"{CLUSTER_CELL_DEG}-degree cell binning, FRP-weighted centre per cell: a "
    "burn front lying on a cell edge is reported as two clusters"
)

THIN_METHOD = (
    "strongest detection per ~5 km cell, then the highest FRP: keeps the "
    "extent of the burning rather than sampling it at random"
)


# ── geometry ────────────────────────────────────────────────────────────────


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle distance in kilometres."""
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Initial great-circle bearing from a to b, compass degrees 0-360."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(deg: float) -> str:
    """The 16-point name for a bearing."""
    return _POINTS[int((deg % 360.0) / 22.5 + 0.5) % 16]


def detected_at(acq_date: Any, acq_time: Any) -> str | None:
    """FIRMS's date and zero-padded HHMM, as one ISO instant in UTC.

    `acq_time` arrives as '709' for 07:09, and pandas will have read it as the
    integer 709 if every row in the file happened to be numeric - so it is
    normalised here rather than trusted. A row with no time is dated to
    midnight and says so by carrying no minutes; a row with no date is None.
    """
    d = str(acq_date or "").strip()[:10]
    if len(d) != 10:
        return None
    t = str(acq_time or "").strip()
    if t.endswith(".0"):
        t = t[:-2]
    t = t.zfill(4) if t.isdigit() else "0000"
    try:
        return (
            datetime.fromisoformat(f"{d}T{t[:2]}:{t[2:4]}:00")
            .replace(tzinfo=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except ValueError:
        return None


# ── regions ─────────────────────────────────────────────────────────────────
#
# Two labels per pixel, deliberately.
#
# `band` is a latitude slice. It cannot be wrong, because it is a statement
# about where the pixel is and nothing else, and it is what the arrival strip
# narrates the path with.
#
# `state_approx` is a guess made of rectangles. The Punjab-Haryana border runs
# diagonally from about (29.5, 75.5) to (30.5, 77.0), so no box can follow it:
# Haryana's Sirsa and Fatehabad sit at Punjab's latitude and will be counted as
# Punjab. That is why every political name this produces is printed with
# "approx." beside it and REGION_METHOD underneath it.

#: south, north, west, east - the NCR domain the mesh and the forecast cover.
NCR_BOX = (28.20, 28.92, 76.80, 77.62)


def _band(lat: float) -> str:
    if lat >= 30.5:
        return "upper corridor"
    if lat >= 29.5:
        return "mid corridor"
    if lat >= 28.92:
        return "lower corridor"
    if lat >= NCR_BOX[0]:
        return "NCR domain"
    return "south of NCR"


def _state_approx(lat: float, lon: float) -> str:
    if NCR_BOX[0] <= lat <= NCR_BOX[1] and NCR_BOX[2] <= lon <= NCR_BOX[3]:
        return "Delhi NCR"
    if lat >= 31.1:
        return "Punjab / Himachal foothills"
    if lat >= 29.6 and lon <= 76.6:
        return "Punjab"
    if lat >= 29.6:
        return "Haryana / Chandigarh"
    if lon >= 77.3:
        return "Western UP"
    if lat < 28.6 and lon < 76.2:
        return "Northern Rajasthan"
    return "Haryana"


def assign_region(lat: float, lon: float) -> tuple[str, str]:
    """(band, state_approx) for one pixel. See the note above on the second."""
    return _band(lat), _state_approx(lat, lon)


# ── wind and transit ────────────────────────────────────────────────────────


def wind_block(u_ms: float | None, v_ms: float | None, source: str) -> dict[str, Any] | None:
    """The flow, as both the direction it blows to and the one it comes from.

    Both, because they are the two conventions in use on this page and printing
    one under the other's name is how a map ends up drawn backwards: the
    station feed reports the direction wind comes *from*, and the advection
    below needs the direction it goes *to*.
    """
    if u_ms is None or v_ms is None:
        return None
    speed = math.hypot(u_ms, v_ms)
    to_deg = (math.degrees(math.atan2(u_ms, v_ms)) + 360.0) % 360.0
    from_deg = (to_deg + 180.0) % 360.0
    return {
        "u_ms": round(float(u_ms), 2),
        "v_ms": round(float(v_ms), 2),
        "speed_ms": round(speed, 2),
        "speed_kmh": round(speed * 3.6, 1),
        "to_deg": round(to_deg, 1),
        "to_compass": compass(to_deg),
        "from_deg": round(from_deg, 1),
        "from_compass": compass(from_deg),
        "source": source,
    }


def transit(
    lat: float,
    lon: float,
    wind: dict[str, Any] | None,
    origin: datetime | None = None,
) -> dict[str, Any]:
    """How long the flow would take to carry this cluster's smoke to Delhi.

    Straight-line advection at the domain-mean speed, projected onto the
    bearing to Delhi. Four outcomes and no fifth: carrying with an hour count,
    not carrying because the flow points elsewhere, not carrying because the
    arrival falls past the forecast horizon, and unknown because no wind is
    loaded. A number is only ever returned for the first.
    """
    if wind is None:
        return {"carrying": None, "reason": "no wind field loaded yet"}

    to_delhi = bearing_deg(lat, lon, DELHI_LAT, DELHI_LON)
    alignment = math.cos(math.radians(to_delhi - wind["to_deg"]))
    dist = haversine_km(lat, lon, DELHI_LAT, DELHI_LON)
    out: dict[str, Any] = {"alignment": round(alignment, 2), "dist_km": round(dist, 1)}

    speed_kmh = wind["speed_kmh"]
    if alignment <= ALIGN_MIN or speed_kmh <= 0.1:
        out.update(
            carrying=False,
            hours=None,
            reason="the flow is not carrying this cluster toward Delhi",
        )
        return out

    hours = dist / (speed_kmh * alignment)
    if hours > HORIZON_H:
        out.update(
            carrying=False,
            hours=round(hours, 1),
            reason=f"arrival falls beyond the {int(HORIZON_H)}-hour forecast horizon",
        )
        return out

    out.update(carrying=True, hours=round(hours, 1))
    # `isinstance` rather than a truth test: a pandas NaT is a datetime
    # subclass that is not None and raises on arithmetic, so it has to be
    # rejected by behaviour, not by presence.
    if isinstance(origin, datetime) and origin == origin:
        out["arrives_at"] = (
            (origin + timedelta(hours=hours))
            .astimezone(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
    return out


# ── aggregation ─────────────────────────────────────────────────────────────


#: FIRMS's own inference about what the hot pixel is. Present on the standard
#: product and ABSENT from near-real-time, which is the distinction that
#: matters: an NRT window has no type column at all, and reporting "0
#: vegetation fires" for it would be a finding where there is only silence.
TYPE_NAMES = {0: "vegetation", 1: "volcano", 2: "other static land", 3: "offshore"}


def type_counts(frame: pd.DataFrame) -> dict[str, int]:
    """How many pixels of each FIRMS type, with the unclassified counted."""
    out: dict[str, int] = {}
    if frame.empty or "type" not in frame:
        return {"unclassified": int(len(frame))}
    for v in frame["type"]:
        if v is None or (isinstance(v, float) and v != v):
            key = "unclassified"
        else:
            key = TYPE_NAMES.get(int(v), f"type {int(v)}")
        out[key] = out.get(key, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _counts(values: Iterable[Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in values:
        if v is None or (isinstance(v, float) and v != v):
            continue
        k = str(v).strip()
        if k:
            out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _newest(frame: pd.DataFrame) -> tuple[str | None, float | None]:
    """(ISO instant of the newest detection, its age in hours)."""
    stamps = [
        detected_at(d, t)
        for d, t in zip(frame.get("acq_date", []), frame.get("acq_time", []))
    ]
    stamps = [s for s in stamps if s]
    if not stamps:
        return None, None
    newest = max(stamps)
    age = (
        datetime.now(timezone.utc) - datetime.fromisoformat(newest.replace("Z", "+00:00"))
    ).total_seconds() / 3600.0
    return newest, round(age, 1)


def cluster(
    fires: pd.DataFrame,
    wind: dict[str, Any] | None,
    origin: datetime | None,
    cell_deg: float = CLUSTER_CELL_DEG,
    limit: int = 24,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Adjacent pixels grouped into cells, strongest first.

    Cell binning rather than a real clustering algorithm: it is deterministic,
    linear, and needs no new dependency on a box with 951 MB of RAM. The cost
    is on the record in CLUSTER_METHOD - a front on a cell edge counts twice.

    Returns (clusters, other) where `other` rolls up every cell too small to be
    worth a row, so the totals still close.
    """
    if fires.empty:
        return [], {"clusters": 0, "pixels": 0, "frp_total_mw": 0.0}

    df = fires.copy()
    df["_cy"] = (df["latitude"] / cell_deg).apply(math.floor)
    df["_cx"] = (df["longitude"] / cell_deg).apply(math.floor)

    rows: list[dict[str, Any]] = []
    for (cy, cx), g in df.groupby(["_cy", "_cx"], sort=False):
        w = g["frp"].to_numpy(dtype=float)
        total = float(w.sum())
        if total <= 0:
            continue
        lat = float((g["latitude"] * w).sum() / total)
        lon = float((g["longitude"] * w).sum() / total)
        band, state = assign_region(lat, lon)
        newest, age = _newest(g)
        types = type_counts(g)
        rows.append(
            {
                "id": f"c_{int(cy)}_{int(cx)}",
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "band": band,
                "state_approx": state,
                "pixels": int(len(g)),
                "types": types,
                "frp_total_mw": round(total, 1),
                "frp_max_mw": round(float(w.max()), 1),
                "dist_km": round(haversine_km(lat, lon, DELHI_LAT, DELHI_LON), 1),
                "from_delhi_deg": round(bearing_deg(DELHI_LAT, DELHI_LON, lat, lon), 1),
                "from_delhi_compass": compass(bearing_deg(DELHI_LAT, DELHI_LON, lat, lon)),
                "newest_detection": newest,
                "age_h": age,
                "sensors": sorted({f"{s}" for s in _counts(g.get("instrument", []))}),
                "satellites": _counts(g.get("satellite", [])),
                "confidence": _counts(g.get("confidence", [])),
                "daynight": _counts(g.get("daynight", [])),
                "transit": transit(lat, lon, wind, origin),
            }
        )

    rows.sort(key=lambda r: -r["frp_total_mw"])
    corridor_frp = sum(r["frp_total_mw"] for r in rows) or 1.0
    for r in rows:
        r["frp_share_pct"] = round(r["frp_total_mw"] / corridor_frp * 100.0, 1)

    kept, rest = rows[:limit], rows[limit:]
    other = {
        "clusters": len(rest),
        "pixels": sum(r["pixels"] for r in rest),
        "frp_total_mw": round(sum(r["frp_total_mw"] for r in rest), 1),
    }
    return kept, other


def regions(fires: pd.DataFrame) -> list[dict[str, Any]]:
    """Rollups by band and approximate state, worst first."""
    if fires.empty:
        return []
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for lat, lon, frp in zip(fires["latitude"], fires["longitude"], fires["frp"]):
        band, state = assign_region(float(lat), float(lon))
        key = (band, state)
        d = out.setdefault(
            key,
            {
                "band": band,
                "state_approx": state,
                "pixels": 0,
                "frp_total_mw": 0.0,
                "frp_max_mw": 0.0,
                "_dist": [],
            },
        )
        d["pixels"] += 1
        d["frp_total_mw"] += float(frp)
        d["frp_max_mw"] = max(d["frp_max_mw"], float(frp))
        d["_dist"].append(haversine_km(float(lat), float(lon), DELHI_LAT, DELHI_LON))

    rows = []
    for d in out.values():
        dists = d.pop("_dist")
        d["frp_total_mw"] = round(d["frp_total_mw"], 1)
        d["frp_max_mw"] = round(d["frp_max_mw"], 1)
        d["nearest_km"] = round(min(dists), 1)
        d["mean_km"] = round(sum(dists) / len(dists), 1)
        rows.append(d)
    rows.sort(key=lambda r: -r["frp_total_mw"])
    return rows


def thin(fires: pd.DataFrame, cap: int) -> tuple[pd.DataFrame, float]:
    """At most `cap` pixels, chosen so the map keeps the shape of the burning.

    Never a random sample: two polls would then draw two different maps of the
    same fires. The strongest detection in each ~5 km cell is kept first, which
    preserves extent, and only if that is still too many does it fall back to
    the highest FRP among the survivors.

    Returns (kept, share of total FRP that was dropped).
    """
    total = float(fires["frp"].sum()) if not fires.empty else 0.0
    if fires.empty or len(fires) <= cap:
        return fires, 0.0

    df = fires.copy()
    df["_ty"] = (df["latitude"] / THIN_CELL_DEG).apply(math.floor)
    df["_tx"] = (df["longitude"] / THIN_CELL_DEG).apply(math.floor)
    # sort_values before drop_duplicates, and the tie-break on coordinates, are
    # what make this deterministic: the same frame must thin to the same map.
    df = df.sort_values(["frp", "latitude", "longitude"], ascending=[False, True, True])
    kept = df.drop_duplicates(subset=["_ty", "_tx"], keep="first")
    if len(kept) > cap:
        kept = kept.head(cap)
    dropped = total - float(kept["frp"].sum())
    return kept.drop(columns=["_ty", "_tx"]), round(dropped / total * 100.0, 1) if total else 0.0


def snapshot(
    fires: pd.DataFrame,
    *,
    window_start: str,
    window_days: int,
    wind: dict[str, Any] | None,
    origin: datetime | None,
    max_pixels: int = 1200,
) -> dict[str, Any]:
    """Everything a corridor map and a hotspot table need, from one frame."""
    total_frp = float(fires["frp"].sum()) if not fires.empty else 0.0
    newest, _ = _newest(fires)
    oldest = None
    if not fires.empty:
        stamps = [
            detected_at(d, t) for d, t in zip(fires["acq_date"], fires.get("acq_time", []))
        ]
        stamps = [s for s in stamps if s]
        oldest = min(stamps) if stamps else None

    clusters, other = cluster(fires, wind, origin)
    kept, dropped_share = thin(fires, max_pixels)

    rows = [
        [
            round(float(r.latitude), 4),
            round(float(r.longitude), 4),
            round(float(r.frp), 1),
            detected_at(getattr(r, "acq_date", None), getattr(r, "acq_time", None)),
            getattr(r, "confidence", None) or None,
            getattr(r, "daynight", None) or None,
        ]
        for r in kept.itertuples(index=False)
    ]

    carrying = [c for c in clusters if c["transit"].get("carrying") is True]
    return {
        "window": {
            "start": window_start,
            "days": window_days,
            "end": (
                date_add(window_start, window_days - 1) if window_start else None
            ),
        },
        "totals": {
            "pixels": int(len(fires)),
            "frp_total_mw": round(total_frp, 1),
            "frp_max_mw": round(float(fires["frp"].max()), 1) if not fires.empty else 0.0,
            # FIRMS's own flag, not our inference. A detection it types as
            # `other static land` is a flare or a kiln, not a burning field,
            # and calling the whole count "stubble fires" is the overclaim this
            # exists to prevent. `unclassified` is its own answer: the
            # near-real-time product ships no type column, so those pixels are
            # untyped rather than untypical.
            "types": type_counts(fires),
            "newest_detection": newest,
            "oldest_detection": oldest,
        },
        "region_method": REGION_METHOD,
        "cluster_method": CLUSTER_METHOD,
        "regions": regions(fires),
        "clusters": clusters,
        "clusters_other": other,
        "pixels": {
            "returned": len(rows),
            "total": int(len(fires)),
            "method": THIN_METHOD,
            "dropped_frp_share_pct": dropped_share,
            "cols": ["lat", "lon", "frp", "at", "conf", "dn"],
            "rows": rows,
        },
        "transport": {
            "available": wind is not None,
            "wind": wind,
            "align_min": ALIGN_MIN,
            "horizon_h": HORIZON_H,
            "carrying_clusters": len(carrying),
            "carrying_frp_share_pct": round(
                sum(c["frp_share_pct"] for c in carrying), 1
            ),
            "earliest_arrival_h": (
                min(c["transit"]["hours"] for c in carrying) if carrying else None
            ),
            "assumptions": [
                "Delhi's own wind is applied across the whole corridor. This "
                "system has no wind field over Punjab or Haryana - nothing here "
                "measures the air above the fires.",
                "Straight-line advection at the domain-mean speed: no vertical "
                "structure, no shear, no dispersion and no deposition.",
                f"A transit time is reported only where the flow has a component "
                f"toward Delhi (alignment above {ALIGN_MIN}); otherwise the "
                "cluster is marked as not carrying.",
            ],
        },
    }


def date_add(iso_day: str, days: int) -> str | None:
    try:
        d = datetime.fromisoformat(iso_day[:10]).date()
    except (TypeError, ValueError):
        return None
    return (d + timedelta(days=days)).isoformat()
