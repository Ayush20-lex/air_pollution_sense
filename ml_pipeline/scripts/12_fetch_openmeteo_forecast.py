"""
Phase 0, step 3 — Backfill the forecasts that the ML layer will bias-correct.

For every catalogued station and season this pulls, at the station's coordinates:

  * CAMS air quality (air-quality-api)     — pm2_5 etc. This IS the prediction
    being corrected. The training target is  y = observed_pm25 - cams_pm2_5.
  * Archived weather forecast (historical-forecast-api) — the meteorology as it
    was forecast, not as it was later reanalysed. Using ERA5 here instead would
    leak information the model will not have at inference time.

Two fields deserve calling out, because they unblock the physics features:

  * ``aerosol_optical_depth`` — the repo currently has no AOD channel;
    coupled_convlstm_engine.py fakes it as AOD_PER_PM25 * pm25, which makes the
    "AOD x downwelling shortwave" feature a restatement of the model's own
    output. This is a real, independent AOD.
  * ``temperature_850hPa`` — with temperature_2m this gives a genuine vertical
    gradient for the inversion-strength proxy. The pilot dataset carries surface
    temperature only, so no gradient could be formed.

CAMS only begins in 2022; earlier dates return HTTP 200 with all-null values
rather than an error, so the script asserts non-null coverage and fails loudly.

Usage:
    python ml_pipeline/scripts/12_fetch_openmeteo_forecast.py --seasons 2025
    python ml_pipeline/scripts/12_fetch_openmeteo_forecast.py            # all
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("forecast")

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "ml_pipeline" / "data"
CATALOG = DATA_DIR / "raw" / "stations" / "catalog.json"
OUT_DIR = DATA_DIR / "raw" / "forecast"

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"

AQ_VARS = [
    "pm2_5", "pm10", "carbon_monoxide", "nitrogen_dioxide", "ozone",
    "sulphur_dioxide", "aerosol_optical_depth", "dust",
]
WX_VARS = [
    "temperature_2m", "temperature_850hPa", "relative_humidity_2m",
    "boundary_layer_height", "shortwave_radiation", "surface_pressure",
    "wind_speed_10m", "wind_direction_10m", "precipitation",
]

CAMS_FIRST_YEAR = 2022
BATCH = 20          # Open-Meteo accepts comma-separated coordinate lists
PAUSE = 1.5         # be polite; free tier is generous but not unlimited


def request_json(url: str, params: dict, retries: int = 5) -> list[dict]:
    """GET with backoff. Always returns a list, one entry per requested point."""
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=180)
        except requests.RequestException as exc:
            logger.warning("network error (%s); retry %d/%d", exc, attempt + 1, retries)
            time.sleep(min(2 ** attempt, 60))
            continue
        if r.status_code == 200:
            payload = r.json()
            return payload if isinstance(payload, list) else [payload]
        if r.status_code in (429, 500, 502, 503, 504):
            wait = min(2 ** attempt, 60) + 5
            logger.warning("HTTP %d; waiting %ss (retry %d/%d)", r.status_code, wait,
                           attempt + 1, retries)
            time.sleep(wait)
            continue
        reason = ""
        try:
            reason = r.json().get("reason", "")
        except Exception:
            reason = r.text[:200]
        raise RuntimeError(f"HTTP {r.status_code} from {url}: {reason}")
    raise RuntimeError(f"Gave up on {url} after {retries} attempts")


def to_frame(block: dict, variables: list[str], loc_id: int, source: str) -> pd.DataFrame:
    hourly = block.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        return pd.DataFrame()
    data = {"timestamp_utc": pd.to_datetime(times, utc=True, format="ISO8601")}
    for v in variables:
        data[f"{source}_{v}"] = hourly.get(v, [None] * len(times))
    df = pd.DataFrame(data)
    df.insert(1, "location_id", loc_id)
    return df


def fetch_block(url: str, variables: list[str], stations: list[dict],
                start: str, end: str, source: str) -> dict[int, pd.DataFrame]:
    params = {
        "latitude": ",".join(f"{s['latitude']:.4f}" for s in stations),
        "longitude": ",".join(f"{s['longitude']:.4f}" for s in stations),
        "hourly": ",".join(variables),
        "start_date": start,
        "end_date": end,
        "timezone": "UTC",
    }
    blocks = request_json(url, params)
    if len(blocks) != len(stations):
        raise RuntimeError(
            f"{source}: asked for {len(stations)} points, got {len(blocks)} blocks back")
    return {
        st["location_id"]: to_frame(b, variables, st["location_id"], source)
        for st, b in zip(stations, blocks)
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", type=int, nargs="+", default=None)
    ap.add_argument("--catalog", type=Path, default=CATALOG)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if not args.catalog.exists():
        logger.error("No catalogue at %s — run 10_fetch_station_catalog.py first.", args.catalog)
        return 1

    catalog = json.loads(args.catalog.read_text())
    seasons = args.seasons or [int(y) for y in catalog["seasons"]]

    args.out.mkdir(parents=True, exist_ok=True)
    total_rows = 0

    for year in sorted(seasons):
        if year < CAMS_FIRST_YEAR:
            logger.warning("Season %d predates the CAMS archive (%d) — skipping. "
                           "Open-Meteo would return nulls, not an error.", year, CAMS_FIRST_YEAR)
            continue

        members = [s for s in catalog["stations"] if str(year) in s["seasons"]
                   and s.get("latitude") is not None]
        if not members:
            logger.info("Season %d: no catalogued stations, skipping.", year)
            continue

        start, end = catalog["seasons"][str(year)]["window"]
        out_path = args.out / f"forecast_{year}.parquet"
        if out_path.exists() and not args.force:
            logger.info("Season %d: %s exists, skipping (use --force).", year, out_path.name)
            continue

        logger.info("Season %d: %d stations, %s -> %s", year, len(members), start, end)
        frames = []

        for i in range(0, len(members), BATCH):
            chunk = members[i: i + BATCH]
            n = i // BATCH + 1
            total_batches = (len(members) + BATCH - 1) // BATCH

            aq = fetch_block(AQ_URL, AQ_VARS, chunk, start, end, "cams")
            time.sleep(PAUSE)
            wx = fetch_block(WX_URL, WX_VARS, chunk, start, end, "fcst")
            time.sleep(PAUSE)

            for st in chunk:
                lid = st["location_id"]
                a, w = aq.get(lid), wx.get(lid)
                if a is None or a.empty or w is None or w.empty:
                    logger.warning("  station %s: empty response, skipped", lid)
                    continue
                merged = a.merge(w.drop(columns=["location_id"]), on="timestamp_utc", how="outer")
                merged["latitude"] = st["latitude"]
                merged["longitude"] = st["longitude"]
                frames.append(merged)

            logger.info("  batch %d/%d done (%d stations)", n, total_batches, len(chunk))

        if not frames:
            logger.error("Season %d produced no data.", year)
            continue

        df = pd.concat(frames, ignore_index=True).sort_values(
            ["location_id", "timestamp_utc"]).reset_index(drop=True)

        # CAMS silently returns nulls before 2022 — refuse to write a hollow file.
        nn = df["cams_pm2_5"].notna().sum()
        if nn == 0:
            logger.error("Season %d: cams_pm2_5 is entirely null — refusing to write.", year)
            continue

        df.to_parquet(out_path, index=False)
        total_rows += len(df)
        logger.info("Season %d -> %s  (%d rows, cams_pm2_5 %.1f%% non-null, AOD %.1f%% non-null)",
                    year, out_path.name, len(df), 100 * nn / len(df),
                    100 * df["cams_aerosol_optical_depth"].notna().mean())

    logger.info("-" * 62)
    logger.info("Total forecast rows written: %d", total_rows)
    logger.info("Output: %s", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
