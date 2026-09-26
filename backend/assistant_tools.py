"""
The only facts the assistant is allowed to speak from.

Every tool here reads this system's own endpoints and hands back a small,
labelled dict. That shape is the whole design, and it is doing two jobs.

The first is size. `/api/v1/stations` is 108 KB of JSON for 73 stations; a
model does not need it and paying for it on every turn would be absurd. Each
tool summarises to the few dozen numbers an answer could actually use.

The second matters more. Every payload carries where it came from, the hour it
describes, and - where the distinction exists - whether the reading is live or
replayed from the archive. The system prompt requires a citation on every
figure, and a model cannot cite what it was not told. So provenance is not
decoration here; it is the mechanism by which an answer can be checked, and
the reason this assistant is different from one that has read about Delhi.

Tools reach the API over the loopback interface rather than importing the
handlers. That keeps this module decoupled from `api_server`'s internals, and
it costs nothing worth measuring: the endpoints are already memoised for 900
seconds, so a tool call is usually a dict lookup behind a localhost socket.
"""
from __future__ import annotations

import os
from typing import Any, Callable

import requests

import aqi_cpcb

#: The API to read. Loopback by default - this process talking to itself.
SELF_BASE = os.environ.get("ASSISTANT_SELF_BASE", "http://127.0.0.1:8000").rstrip("/")

#: A tool that cannot answer in this long is not going to save the turn.
TOOL_TIMEOUT_S = 20


class ToolError(RuntimeError):
    """A tool could not answer. Returned to the model, never raised at a user."""


def _get(path: str, **params: Any) -> Any:
    try:
        r = requests.get(
            f"{SELF_BASE}/api/v1/{path.lstrip('/')}",
            params=params or None,
            timeout=TOOL_TIMEOUT_S,
            headers={"Accept": "application/json"},
        )
    except requests.RequestException as exc:
        raise ToolError(f"{path} is unreachable ({type(exc).__name__})") from exc
    if r.status_code == 204:
        raise ToolError(f"{path} has nothing to report right now")
    if not r.ok:
        raise ToolError(f"{path} returned HTTP {r.status_code}")
    try:
        return r.json()
    except ValueError as exc:
        raise ToolError(f"{path} did not return JSON") from exc


def _round(v: Any, n: int = 1) -> Any:
    return round(v, n) if isinstance(v, (int, float)) else v


# ── the tools ───────────────────────────────────────────────────────────────


def city_now() -> dict[str, Any]:
    """What the network is reading this hour, across the city."""
    d = _get("stations")
    stations = [s for s in d.get("stations", []) if s.get("valid") and s.get("aqi")]
    if not stations:
        return {
            "source": "/api/v1/stations",
            "as_of": d.get("as_of"),
            "note": "no station is publishable this hour under CPCB's validity rule",
        }
    live = [s for s in stations if s.get("freshness") == "live"]
    aqis = [s["aqi"] for s in stations]
    worst = max(stations, key=lambda s: s["aqi"])
    best = min(stations, key=lambda s: s["aqi"])
    drivers: dict[str, int] = {}
    for s in stations:
        p = s.get("prominent_pollutant")
        if p:
            drivers[p] = drivers.get(p, 0) + 1
    return {
        "source": "/api/v1/stations",
        "as_of": d.get("as_of"),
        "index": d.get("index"),
        "city_mean_aqi": round(sum(aqis) / len(aqis)),
        "stations_reporting": len(stations),
        "live_this_hour": len(live),
        "carried_from_archive": len(stations) - len(live),
        "worst": {"station": worst["name"], "aqi": worst["aqi"], "zone": worst.get("zone")},
        "cleanest": {"station": best["name"], "aqi": best["aqi"], "zone": best.get("zone")},
        "deciding_channel_counts": drivers,
        "channels_withheld": d.get("pollutants_excluded", {}),
        "caveat": (
            "Archive stations describe an earlier hour than the live ones; say so "
            "if the answer leans on them."
        ),
    }


def station_detail(station: str) -> dict[str, Any]:
    """One station's own measurements, channel by channel."""
    d = _get("stations")
    q = (station or "").strip().lower()
    if not q:
        raise ToolError("no station name given")
    rows = d.get("stations", [])
    hit = next((s for s in rows if q == str(s.get("name", "")).lower()), None)
    if hit is None:
        hit = next((s for s in rows if q in str(s.get("name", "")).lower()), None)
    if hit is None:
        near = [s["name"] for s in rows][:40]
        raise ToolError(f"no station matching '{station}'. Known names include: {near}")

    channels = {}
    for name, sub in (hit.get("sub_indices") or {}).items():
        channels[name] = {
            "sub_index": sub.get("sub_index"),
            "concentration": sub.get("concentration"),
            "unit": "mg/m3" if name == "CO" else "ug/m3",
            "window_hours": sub.get("window_hours"),
            "valid_hours": sub.get("valid_hours"),
        }
    return {
        "source": "/api/v1/stations",
        "station": hit.get("name"),
        "full_name": hit.get("full_name"),
        "zone": hit.get("zone"),
        "agency": hit.get("agency"),
        "as_of": hit.get("as_of") or d.get("as_of"),
        "freshness": hit.get("freshness"),
        "aqi": hit.get("aqi"),
        "category": hit.get("category"),
        "deciding_channel": hit.get("prominent_pollutant"),
        "channels": channels,
        "coverage_pct": hit.get("coverage_pct"),
        "indexable": hit.get("valid"),
        "why_not_indexed": hit.get("reasons") or None,
        "channel_shortfalls": hit.get("dropped") or None,
    }


def forecast(hours: int = 72) -> dict[str, Any]:
    """The next 72 hours, with the error it was scored at."""
    d = _get("forecast/frames")
    src = d.get("source") or {}
    frames = d.get("frames") or []
    n = max(1, min(int(hours or 72), len(frames)))
    picked = [frames[i] for i in range(0, n, 6)]
    series = [
        {
            "hour": f.get("offset", i * 6),
            "city_pm25_ugm3": _round(f.get("avgPm25")),
            "pbl_m": f.get("avgPbl"),
        }
        for i, f in enumerate(picked)
    ]
    return {
        "source": "/api/v1/forecast/frames",
        "origin": src.get("origin"),
        "engine": src.get("engine"),
        "method": src.get("method"),
        "mode": src.get("mode"),
        "validated_rmse_ugm3": src.get("validated_rmse_ugm3"),
        "beats_raw_cams_by": src.get("beats_raw_cams_by"),
        "every_6_hours": series,
        "caveat": (
            "This run replays a scored archive. Its origin is the hour above, not "
            "the wall clock - quote the origin when the two differ."
        ),
    }


def fire_corridor(window: str | None = None) -> dict[str, Any]:
    """Stubble and other burning upwind, and whether the flow is carrying it."""
    d = _get("fires", **({"start": window} if window else {}))
    if not d.get("available"):
        return {"source": "/api/v1/fires", "available": False, "reason": d.get("reason")}
    t = d.get("transport") or {}
    wind = t.get("wind") or {}
    clusters = [
        {
            "where": c.get("state_approx"),
            "band": c.get("band"),
            "detections": c.get("pixels"),
            "frp_mw": c.get("frp_total_mw"),
            "km_from_delhi": c.get("dist_km"),
            "bearing_from_delhi": c.get("from_delhi_compass"),
            "carrying": (c.get("transit") or {}).get("carrying"),
            "arrival_hours": (c.get("transit") or {}).get("hours"),
        }
        for c in (d.get("clusters") or [])[:6]
    ]
    return {
        "source": "/api/v1/fires",
        "window": d.get("window"),
        "season": d.get("season"),
        "status": d.get("status"),
        "detections": (d.get("totals") or {}).get("pixels"),
        "frp_total_mw": (d.get("totals") or {}).get("frp_total_mw"),
        "classification": (d.get("totals") or {}).get("types"),
        "wind_from": wind.get("from_compass"),
        "wind_speed_kmh": wind.get("speed_kmh"),
        "clusters_carrying": t.get("carrying_clusters"),
        "earliest_arrival_hours": t.get("earliest_arrival_h"),
        "top_clusters": clusters,
        "smoke_share_pct": (d.get("smoke") or {}).get("share_pct"),
        "assumptions": t.get("assumptions"),
        "caveat": (
            "State names are approximate boxes, not official boundaries. The smoke "
            "share is a proxy scaled by one calibrated constant, not a measurement."
        ),
    }


def grap_stage() -> dict[str, Any]:
    """The GRAP stage in force, and what set it."""
    d = _get("policy/grap")
    g = d.get("grap") or {}
    return {
        "source": "/api/v1/policy/grap",
        "as_of": d.get("timestamp"),
        "stage": g.get("stage"),
        "category": g.get("category"),
        "actions": g.get("actions"),
        "city_aqi": d.get("city_aqi"),
        "city_pm25_ugm3": d.get("city_pm25_ugm3"),
        "hotspot": d.get("hotspot"),
        "stations_considered": d.get("stations_considered"),
        "basis": d.get("message"),
    }


def inversion() -> dict[str, Any]:
    """Where the boundary layer is trapping, over the forecast horizon."""
    rows = _get("alerts/inversion")
    if not isinstance(rows, list) or not rows:
        return {"source": "/api/v1/alerts/inversion", "zones_above_threshold": 0}
    by_sev: dict[str, int] = {}
    for z in rows:
        s = str(z.get("severity", "?"))
        by_sev[s] = by_sev.get(s, 0) + 1
    worst = max(rows, key=lambda z: z.get("isi_score") or 0)
    return {
        "source": "/api/v1/alerts/inversion",
        "zones_above_threshold": len(rows),
        "by_severity": by_sev,
        "worst_zone": {
            "severity": worst.get("severity"),
            "isi_score": worst.get("isi_score"),
            "lat": worst.get("lat_center"),
            "lon": worst.get("lon_center"),
        },
        "caveat": "The inversion index is a modelled quantity; no station measures it.",
    }


def city_history(days: int = 30) -> dict[str, Any]:
    """The archived daily record, for comparing today with the recent past."""
    d = _get("history/city")
    rows = d.get("days") or []
    n = max(1, min(int(days or 30), len(rows)))
    recent = rows[-n:]
    aqis = [r["aqi"] for r in recent if isinstance(r.get("aqi"), (int, float))]
    return {
        "source": "/api/v1/history/city",
        "window_days": d.get("window_days"),
        "index": d.get("index"),
        "days_returned": len(recent),
        "mean_aqi": round(sum(aqis) / len(aqis)) if aqis else None,
        "best_day": min(recent, key=lambda r: r.get("aqi", 1e9)) if aqis else None,
        "worst_day": max(recent, key=lambda r: r.get("aqi", -1)) if aqis else None,
        "band_day_counts": d.get("band_days"),
        "days_excluded_for_thin_coverage": d.get("days_excluded_thin"),
        "last_7": recent[-7:],
        "caveat": d.get("note"),
    }


def index_rules(pollutant: str | None = None) -> dict[str, Any]:
    """CPCB's own breakpoints and validity rule. Read from the scoring code."""
    wanted = (pollutant or "").strip().lower().replace(".", "").replace("pm25", "pm25")
    keys = [wanted] if wanted in aqi_cpcb.BREAKPOINTS else list(aqi_cpcb.BREAKPOINTS)
    out = {}
    for k in keys:
        window = aqi_cpcb.AVERAGING_HOURS[k]
        out[k] = {
            "averaging_hours": window,
            "min_valid_hours": aqi_cpcb.MIN_VALID_HOURS[window],
            "unit": "mg/m3" if k == "co" else "ug/m3",
            "breakpoints": [
                {"from": c_lo, "to": c_hi, "index_from": i_lo, "index_to": i_hi}
                for c_lo, c_hi, i_lo, i_hi in aqi_cpcb.BREAKPOINTS[k]
            ],
        }
    return {
        "source": "backend/aqi_cpcb.py (CPCB National AQI, 2014)",
        "rule": (
            "A station's AQI is the maximum of its sub-indices, and needs at least "
            "three pollutants with a particulate among them."
        ),
        "channels": out,
    }


# ── declarations the model sees ─────────────────────────────────────────────
#
# Gemini function-calling schema (OpenAPI subset). Descriptions are written for
# the model, so each says when to reach for the tool rather than what it wraps.

DECLARATIONS: list[dict[str, Any]] = [
    {
        "name": "city_now",
        "description": (
            "Current air quality across Delhi NCR: city mean AQI, how many stations "
            "are reporting, the worst and cleanest station, and which pollutant is "
            "deciding the index. Use for any 'right now' or 'today' question."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "station_detail",
        "description": (
            "One monitoring station's own readings: every channel's concentration, "
            "sub-index, averaging window and how many valid hours went into it. Use "
            "when the user names a place, or asks why a station reads what it does."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "station": {
                    "type": "string",
                    "description": "Station name, e.g. 'Anand Vihar' or 'Punjabi Bagh'.",
                }
            },
            "required": ["station"],
        },
    },
    {
        "name": "forecast",
        "description": (
            "The 72-hour PM2.5 forecast with the error it was scored at, and the "
            "boundary-layer height alongside it. Use for anything about later today, "
            "tomorrow, or how accurate the forecast is."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "hours": {"type": "integer", "description": "Horizon to read, 1-72."}
            },
        },
    },
    {
        "name": "fire_corridor",
        "description": (
            "NASA FIRMS fire detections upwind of Delhi, grouped into clusters, with "
            "the measured wind and whether it is carrying their smoke to the city. "
            "Use for stubble burning, smoke, or 'where is the pollution coming from'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "window": {
                    "type": "string",
                    "description": (
                        "Optional window start as YYYY-MM-DD. Omit for the current "
                        "window; '2025-11-03' is the November 2025 burning episode."
                    ),
                }
            },
        },
    },
    {
        "name": "grap_stage",
        "description": (
            "The Graded Response Action Plan stage in force, the restrictions it "
            "carries, and the reading that set it. Use for rules, restrictions, "
            "bans, odd-even, school closures or 'what is the government doing'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "inversion",
        "description": (
            "Boundary-layer trapping risk by zone over the forecast horizon. Use for "
            "questions about why pollution is being held near the ground, smog at "
            "night, or why the air is worse after dark."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "city_history",
        "description": (
            "The archived daily city AQI record. Use to compare today with recent "
            "days or weeks, or for questions about trends."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "How many recent days, 1-30."}
            },
        },
    },
    {
        "name": "index_rules",
        "description": (
            "CPCB's National AQI breakpoints, averaging windows and validity rule. "
            "Use to explain how the index is computed, what a band means, or why a "
            "station has no index."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pollutant": {
                    "type": "string",
                    "description": "Optional: pm25, pm10, no2, so2, co, o3, nh3, pb.",
                }
            },
        },
    },
]

HANDLERS: dict[str, Callable[..., Any]] = {
    "city_now": city_now,
    "station_detail": station_detail,
    "forecast": forecast,
    "fire_corridor": fire_corridor,
    "grap_stage": grap_stage,
    "inversion": inversion,
    "city_history": city_history,
    "index_rules": index_rules,
}


def run(name: str, args: dict[str, Any] | None) -> dict[str, Any]:
    """Execute one tool call. Never raises - the model is told what went wrong."""
    fn = HANDLERS.get(name)
    if fn is None:
        return {"error": f"no such tool: {name}"}
    try:
        return fn(**(args or {}))
    except ToolError as exc:
        return {"error": str(exc)}
    except TypeError as exc:
        return {"error": f"bad arguments for {name}: {exc}"}
    except Exception as exc:  # noqa: BLE001 - a broken tool must not kill the turn
        return {"error": f"{name} failed ({type(exc).__name__})"}
