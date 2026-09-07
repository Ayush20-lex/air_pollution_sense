"""
Phase B, step 2 — Compute the CPCB National AQI from the fetched observations.

Turns the per-sensor Parquet from 11_fetch_station_observations.py into an
hourly AQI series per station, using backend/aqi_cpcb.py so there is exactly one
implementation of the standard in the repo.

AQI is evaluated on a *trailing* window at every hour, not once per calendar
day. CPCB's bulletin is daily, but a 72-hour AQI forecast needs a target at each
forecast hour, and the trailing form is what a model can be scored against.

Per hour t, for each pollutant:
  * 24-hourly species (PM2.5, PM10, NO2, SO2) — mean over (t-23 … t), requiring
    at least 16 valid hours
  * 8-hourly species (CO, O3) — the maximum 8-hour rolling mean inside that same
    trailing 24 hours, each 8-hour mean requiring at least 6 valid hours

Then AQI(t) = max of the available sub-indices, subject to the validity rules:
at least three pollutants, with PM2.5 or PM10 among them. Hours that fail are
written with aqi = null and a reason, never a zero.

Units are resolved per sensor from the station catalogue. This matters: the same
station can report NO2 in ppb on one sensor and µg/m³ on another, and indexing a
ppb value against a µg/m³ table understates it by ~1.9x.

Usage:
    python ml_pipeline/scripts/13_compute_station_aqi.py
    python ml_pipeline/scripts/13_compute_station_aqi.py --seasons 2025
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from aqi_cpcb import (  # noqa: E402
    AVERAGING_HOURS,
    MANDATORY_ANY_OF,
    MIN_POLLUTANTS,
    MIN_VALID_HOURS,
    BREAKPOINTS,
    category_for,
    sub_index,
    to_cpcb_units,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("station-aqi")

DATA_DIR = REPO_ROOT / "ml_pipeline" / "data"
CATALOG = DATA_DIR / "raw" / "stations" / "catalog.json"
OBS_DIR = DATA_DIR / "raw" / "observations"
OUT_DIR = DATA_DIR / "processed"

#: Only these feed the AQI. `nox` is fetched for the model's NOx channel but the
#: standard indexes NO2, and there is no NOx breakpoint table.
AQI_POLLUTANTS = [p for p in BREAKPOINTS]


def sensor_units(catalog: dict) -> dict[int, str]:
    """sensor_id -> unit string, so a reading can be converted before indexing."""
    out: dict[int, str] = {}
    for st in catalog["stations"]:
        for cands in st["sensors"].values():
            for c in cands:
                out[int(c["sensor_id"])] = c.get("units") or "ug/m3"
    return out


def load_season(season: int, units: dict[int, str]) -> pd.DataFrame:
    """Wide frame: one row per (location, hour), one column per AQI pollutant."""
    files = sorted((OBS_DIR / f"season={season}").glob("*.parquet"))
    keep = [f for f in files if f.name.split("_")[0] in AQI_POLLUTANTS]
    if not keep:
        return pd.DataFrame()

    frames = []
    for f in keep:
        d = pd.read_parquet(f, columns=["timestamp_utc", "location_id", "sensor_id",
                                        "parameter", "value"])
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df = df.dropna(subset=["value"])

    # Convert every reading into the unit its breakpoint table expects.
    converted = []
    for (param, sid), grp in df.groupby(["parameter", "sensor_id"], sort=False):
        unit = units.get(int(sid), "ug/m3")
        try:
            factor_test = to_cpcb_units(param, 1.0, unit)
        except ValueError:
            logger.warning("sensor %s (%s): unrecognised unit %r, skipped", sid, param, unit)
            continue
        g = grp.copy()
        g["value"] = g["value"] * factor_test  # conversion is linear in value
        converted.append(g)

    if not converted:
        return pd.DataFrame()
    df = pd.concat(converted, ignore_index=True)

    # Several sensors can serve the same pollutant at one station; average them.
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True).dt.floor("h")
    wide = (df.groupby(["location_id", "timestamp_utc", "parameter"])["value"]
              .mean()
              .unstack("parameter"))
    return wide


def trailing_windows(series: pd.Series, pollutant: str) -> pd.Series:
    """Value the sub-index is computed from, at every hour."""
    window = AVERAGING_HOURS[pollutant]
    if window == 24:
        return series.rolling(24, min_periods=MIN_VALID_HOURS[24]).mean()
    # 8-hourly: rolling 8-hour means, then the worst one inside trailing 24 h.
    eight = series.rolling(8, min_periods=MIN_VALID_HOURS[8]).mean()
    return eight.rolling(24, min_periods=1).max()


def aqi_for_station(loc_id: int, wide: pd.DataFrame) -> pd.DataFrame:
    """Hourly AQI for one station."""
    # A complete hourly index so real gaps stay visible as NaN rather than being
    # silently closed up by the rolling window.
    full = pd.date_range(wide.index.min(), wide.index.max(), freq="h", tz="UTC")
    wide = wide.reindex(full)

    windowed = pd.DataFrame(index=full)
    for p in AQI_POLLUTANTS:
        if p in wide.columns:
            windowed[p] = trailing_windows(wide[p], p)

    if windowed.empty:
        return pd.DataFrame()

    # Sub-index per pollutant. The scalar function is the one the tests cover, so
    # it is reused rather than reimplemented vectorised.
    sub = pd.DataFrame(index=full)
    for p in windowed.columns:
        sub[p] = [sub_index(p, v) if pd.notna(v) else None for v in windowed[p]]

    present = sub.notna()
    n_present = present.sum(axis=1)
    has_pm = present.reindex(columns=list(MANDATORY_ANY_OF), fill_value=False).any(axis=1)
    valid = (n_present >= MIN_POLLUTANTS) & has_pm

    aqi = sub.max(axis=1).where(valid)

    # idxmax raises on an all-NA row, and early hours are all-NA by construction:
    # nothing has 16 trailing samples yet. Only ask for it where something exists.
    prominent = pd.Series(pd.NA, index=full, dtype=object)
    any_present = n_present > 0
    if any_present.any():
        prominent.loc[any_present] = sub.loc[any_present].idxmax(axis=1)
    prominent = prominent.where(valid)

    reason = np.where(
        valid, "",
        np.where(~has_pm, "no PM2.5 or PM10",
                 "fewer than %d pollutants" % MIN_POLLUTANTS))

    out = pd.DataFrame({
        "location_id": loc_id,
        "timestamp_utc": full,
        "aqi": aqi.astype("Float64"),
        "prominent_pollutant": prominent,
        "n_pollutants": n_present.astype("Int64"),
        "valid": valid,
        "reason": reason,
    })
    out["category"] = [category_for(int(a)) if pd.notna(a) else None for a in out["aqi"]]
    for p in AQI_POLLUTANTS:
        out[f"sub_{p}"] = sub[p].values if p in sub.columns else pd.NA
        out[f"conc_{p}"] = windowed[p].values if p in windowed.columns else pd.NA
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", type=int, nargs="+", default=None)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    if not CATALOG.exists():
        logger.error("No catalogue at %s — run 10_fetch_station_catalog.py first.", CATALOG)
        return 1
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    units = sensor_units(catalog)
    seasons = args.seasons or [int(y) for y in catalog["seasons"]]

    args.out.mkdir(parents=True, exist_ok=True)
    grand_total = 0

    for season in sorted(seasons):
        wide = load_season(season, units)
        if wide.empty:
            logger.info("Season %d: no observations, skipping.", season)
            continue

        rows = []
        for loc_id, grp in wide.groupby(level="location_id"):
            g = grp.droplevel("location_id").sort_index()
            r = aqi_for_station(int(loc_id), g)
            if not r.empty:
                rows.append(r)

        if not rows:
            logger.info("Season %d: nothing computable.", season)
            continue

        result = pd.concat(rows, ignore_index=True)
        path = args.out / f"station_aqi_{season}.parquet"
        result.to_parquet(path, index=False)
        grand_total += len(result)

        ok = result["valid"].sum()
        stations = result["location_id"].nunique()
        logger.info(
            "Season %d -> %s  (%d station-hours across %d stations, %.1f%% valid)",
            season, path.name, len(result), stations, 100 * ok / len(result))
        if ok:
            v = result[result["valid"]]
            top = v["prominent_pollutant"].value_counts(normalize=True).head(3)
            logger.info("   AQI median %.0f, p95 %.0f | prominent: %s",
                        v["aqi"].median(), v["aqi"].quantile(0.95),
                        ", ".join(f"{k} {100*x:.0f}%" for k, x in top.items()))

    logger.info("-" * 62)
    logger.info("Total station-hours written: %d", grand_total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
