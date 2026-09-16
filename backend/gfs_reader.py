"""
NOAA GFS reader - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Reads the NCR-clipped GFS extract produced by the partner ingestion pipeline
(yadavarpit9833-cpu/Data-Pipeline, exports/gfs_ncr.parquet) and hands it to the
API as a forecast-hour series over the nine 0.25-degree grid cells that fall
inside the domain.

Why this exists, and what it is not
-----------------------------------
GFS duplicates almost everything already on hand: temperature and wind arrive
from Open-Meteo at 68 station points, which is far denser than nine grid cells.
The one field it adds is **precipitation** - rain scavenges PM2.5 and none of
the twelve channels can see it.

So this is a read-only side channel, not a forecast input. It deliberately does
not touch baseline_forecaster or channel_spec: the blend baseline is validated
at 84.89 ug/m3 over 462,323 scored comparisons, and feeding a new field into it
would invalidate that number with no time left to re-run the scoring.

Absence is a normal state
-------------------------
The extract is produced by a separate repository on someone else's schedule. If
it is missing, stale or malformed, `load()` returns None and the API answers 204
rather than failing. Nothing that works today depends on this file existing.

Quality flags are honoured rather than dropped: rows the upstream cleaner marked
imputed or not `ok` are reported in the payload instead of being silently served
as measurements.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger("gfs_reader")

REPO_ROOT = Path(__file__).resolve().parents[1]
GFS_PATH = REPO_ROOT / "ml_pipeline" / "data" / "raw" / "gfs" / "gfs_ncr.parquet"

# Same domain as the forecast grid, so the cells line up with everything else.
LAT_MIN, LAT_MAX = 28.20, 28.90
LON_MIN, LON_MAX = 76.80, 77.60

#: Column -> unit, as the partner names them. The units are in the column names
#: on purpose: an earlier export carried `no2_ppb` holding ug/m3, and reading
#: that at face value would have inflated the pollutant by 88%.
FIELDS: dict[str, str] = {
    "temperature_c": "C",
    "u_wind_ms": "m/s",
    "v_wind_ms": "m/s",
    "precipitation_mm": "mm",
}


def _flag_columns(df: pd.DataFrame, field: str) -> tuple[str | None, str | None]:
    """QC and imputation columns for a field, whichever naming the export used."""
    stem = field.rsplit("_", 1)[0] if field.count("_") > 1 else field
    qc = next((c for c in (f"{field}_qc_flag", f"{stem}_qc_flag") if c in df.columns), None)
    imp = next((c for c in (f"{field}_imputed", f"{stem}_imputed") if c in df.columns), None)
    return qc, imp


def _quality(df: pd.DataFrame, field: str) -> dict[str, Any]:
    """How much of this field is measured rather than filled in."""
    qc, imp = _flag_columns(df, field)
    out: dict[str, Any] = {"unit": FIELDS[field], "rows": int(df[field].notna().sum())}
    if qc:
        bad = int((df[qc].astype(str) != "ok").sum())
        out["rows_flagged"] = bad
    if imp:
        out["rows_imputed"] = int(df[imp].astype(bool).sum())
    return out


@lru_cache(maxsize=1)
def load(path: str | None = None) -> dict[str, Any] | None:
    """The extract as a JSON-ready payload, or None when it is unusable.

    Cached: the file only changes when the partner repository is pulled, and the
    API has no way to notice that mid-process.
    """
    p = Path(path) if path else GFS_PATH
    if not p.exists():
        logger.info("no GFS extract at %s; the met side channel stays off", p)
        return None

    try:
        df = pd.read_parquet(p)
    except Exception as exc:  # noqa: BLE001 - a bad file must not take the API down
        logger.warning("GFS extract unreadable (%s); serving without it", exc)
        return None

    required = {"valid_time", "lat", "lon"}
    if not required.issubset(df.columns):
        logger.warning("GFS extract missing %s; ignoring it", required - set(df.columns))
        return None

    df = df[
        df.lat.between(LAT_MIN, LAT_MAX) & df.lon.between(LON_MIN, LON_MAX)
    ].copy()
    if df.empty:
        logger.warning("GFS extract has no rows inside the NCR domain; ignoring it")
        return None

    df["valid_time"] = pd.to_datetime(df.valid_time, utc=True, format="ISO8601")
    df = df.sort_values(["valid_time", "lat", "lon"])

    present = [f for f in FIELDS if f in df.columns]
    missing = [f for f in FIELDS if f not in df.columns]

    origin = df.valid_time.min()
    series: list[dict[str, Any]] = []
    for ts, group in df.groupby("valid_time", sort=True):
        cells = []
        for _, r in group.iterrows():
            cell: dict[str, Any] = {"lat": float(r.lat), "lon": float(r.lon)}
            for f in present:
                v = r[f]
                cell[f] = None if pd.isna(v) else round(float(v), 3)
            cells.append(cell)
        series.append(
            {
                "valid_time": ts.isoformat(),
                "lead_hours": int((ts - origin).total_seconds() // 3600),
                "cells": cells,
            }
        )

    cycles = sorted(df.cycle.unique().tolist()) if "cycle" in df.columns else []
    synthetic = bool(df.is_synthetic.any()) if "is_synthetic" in df.columns else False

    return {
        "source": "noaa_gfs",
        "via": "partner ingestion pipeline (medallion silver layer)",
        "resolution_deg": 0.25,
        "grid_points": int(df.groupby(["lat", "lon"]).ngroups),
        "cycles": cycles,
        "is_synthetic": synthetic,
        "first_valid": origin.isoformat(),
        "last_valid": df.valid_time.max().isoformat(),
        "steps": len(series),
        "fields": {f: _quality(df, f) for f in present},
        # Named rather than silently absent: precipitation is the only field
        # here that is not already available at higher density, so a consumer
        # needs to know when it is the one that did not arrive.
        "fields_absent": missing,
        "read_at": datetime.now(timezone.utc).isoformat(),
        "series": series,
    }


def describe() -> dict[str, Any]:
    """Short summary for /api/v1/status, without the payload."""
    data = load()
    if data is None:
        return {"available": False, "reason": "no usable GFS extract"}
    return {
        "available": True,
        "source": data["source"],
        "grid_points": data["grid_points"],
        "steps": data["steps"],
        "fields": sorted(data["fields"]),
        "fields_absent": data["fields_absent"],
        "first_valid": data["first_valid"],
        "last_valid": data["last_valid"],
    }
