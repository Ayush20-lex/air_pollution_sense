"""
Phase 0, step 2 — Fetch hourly observations for every catalogued station/season.

Reads data/raw/stations/catalog.json and pulls /v3/sensors/{id}/hours for each
sensor across each burning season, writing one Parquet file per (season, sensor).

This is a multi-thousand-request job against a 60 req/min budget, so it is
resumable: completed (season, sensor) pairs are recorded in a manifest and
skipped on the next run. Interrupting with Ctrl-C is safe.

The /hours endpoint is used rather than /measurements because it returns the
station's own hourly aggregate together with a `coverage` block (expected vs.
observed sub-hourly counts), which is what lets 12_build_observation_matrix.py
distinguish "genuinely clean air" from "sensor was offline".

Usage:
    # smoke test — 3 stations, one season
    python ml_pipeline/scripts/11_fetch_station_observations.py --seasons 2023 --max-stations 3

    # full run (~70 min; use nohup / a background shell)
    python ml_pipeline/scripts/11_fetch_station_observations.py
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openaq_client import OpenAQClient, OpenAQError  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("observations")

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "ml_pipeline" / "data"
CATALOG = DATA_DIR / "raw" / "stations" / "catalog.json"
OUT_DIR = DATA_DIR / "raw" / "observations"
MANIFEST = OUT_DIR / "_manifest.json"


def season_window(catalog: dict, year: int) -> tuple[str, str]:
    """Read the season's real window from the catalogue.

    Not every season is Oct-Dec: the OpenAQ CPCB feed stops on 2022-10-31, so
    the 2022 season is pinned to October alone. `to` is made exclusive by
    advancing one day, since the catalogue stores an inclusive end date.
    """
    start, end = catalog["seasons"][str(year)]["window"]
    end_excl = (datetime.fromisoformat(end) + timedelta(days=1)).date().isoformat()
    return f"{start}T00:00:00Z", f"{end_excl}T00:00:00Z"


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"completed": {}, "failed": {}, "started_at": None}


def save_manifest(m: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=2))


def flatten(row: dict, sensor_id: int, location_id: int, param: str) -> dict | None:
    period = row.get("period") or {}
    ts = ((period.get("datetimeFrom") or {}).get("utc"))
    if ts is None:
        return None
    cov = row.get("coverage") or {}
    summ = row.get("summary") or {}
    return {
        "timestamp_utc": ts,
        "location_id": location_id,
        "sensor_id": sensor_id,
        "parameter": param,
        "value": row.get("value"),
        "value_min": summ.get("min"),
        "value_max": summ.get("max"),
        "expected_count": cov.get("expectedCount"),
        "observed_count": cov.get("observedCount"),
        "has_flags": bool((row.get("flagInfo") or {}).get("hasFlags")),
    }


def fetch_one(client: OpenAQClient, sensor_id: int, location_id: int,
              param: str, dt_from: str, dt_to: str) -> pd.DataFrame:
    rows = []
    for raw in client.paginate(
        f"/v3/sensors/{sensor_id}/hours",
        {"datetime_from": dt_from, "datetime_to": dt_to},
        page_size=1000,
    ):
        rec = flatten(raw, sensor_id, location_id, param)
        if rec:
            rows.append(rec)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"], utc=True, format="ISO8601")
    return df.sort_values("timestamp_utc").drop_duplicates(subset=["timestamp_utc"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", type=int, nargs="+", default=None,
                    help="Years to fetch (default: whatever the catalogue declares).")
    ap.add_argument("--params", nargs="+", default=None,
                    help="Parameters to fetch (default: all in the catalogue).")
    ap.add_argument("--max-stations", type=int, default=None, help="Cap for smoke tests.")
    ap.add_argument("--catalog", type=Path, default=CATALOG)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--force", action="store_true", help="Refetch pairs already in the manifest.")
    args = ap.parse_args()

    load_dotenv(REPO_ROOT / "external_data_pipeline" / ".env")

    if not args.catalog.exists():
        logger.error("No catalogue at %s — run 10_fetch_station_catalog.py first.", args.catalog)
        return 1

    catalog = json.loads(args.catalog.read_text())
    seasons = args.seasons or [int(y) for y in catalog["seasons"]]

    # Build the work list from the per-season sensor resolution in the
    # catalogue. A station only appears for a season if a sensor genuinely
    # covered it, so no request is spent on decommissioned hardware.
    jobs = []
    for st in catalog["stations"]:
        for year in seasons:
            chosen = st["seasons"].get(str(year))
            if not chosen:
                continue
            for param, sensor_id in chosen.items():
                if args.params and param not in args.params:
                    continue
                jobs.append((year, st["location_id"], param, sensor_id, st["location_name"]))

    if args.max_stations:
        keep = {loc for _, loc, _, _, _ in jobs}
        keep = set(sorted(keep)[: args.max_stations])
        jobs = [j for j in jobs if j[1] in keep]

    manifest = load_manifest()
    manifest["started_at"] = manifest.get("started_at") or datetime.now(timezone.utc).isoformat()
    done = set() if args.force else set(manifest["completed"])

    pending = [j for j in jobs if f"{j[0]}:{j[3]}" not in done]
    logger.info("%d sensor-seasons total; %d already done; %d to fetch.",
                len(jobs), len(jobs) - len(pending), len(pending))
    if not pending:
        logger.info("Nothing to do.")
        return 0

    est_min = len(pending) * 3 * (60 / 55) / 60
    logger.info("Rough estimate: ~%.0f min at the 55 req/min budget.", est_min)

    args.out.mkdir(parents=True, exist_ok=True)
    client = OpenAQClient()
    t0 = time.time()
    written = failed = empty = 0

    try:
        for i, (year, loc_id, param, sensor_id, loc_name) in enumerate(pending, 1):
            key = f"{year}:{sensor_id}"
            dt_from, dt_to = season_window(catalog, year)
            label = f"[{i}/{len(pending)}] {year} {param:<16} {str(loc_name)[:32]}"
            try:
                df = fetch_one(client, sensor_id, loc_id, param, dt_from, dt_to)
            except OpenAQError as exc:
                logger.error("%s -> FAILED: %s", label, exc)
                manifest["failed"][key] = str(exc)
                failed += 1
                save_manifest(manifest)
                continue

            if df.empty:
                logger.info("%s -> no data", label)
                manifest["completed"][key] = {"rows": 0, "path": None}
                empty += 1
            else:
                season_dir = args.out / f"season={year}"
                season_dir.mkdir(parents=True, exist_ok=True)
                path = season_dir / f"{param}_{loc_id}_{sensor_id}.parquet"
                df.to_parquet(path, index=False)
                manifest["completed"][key] = {
                    "rows": len(df),
                    "path": str(path.relative_to(DATA_DIR)),
                }
                written += 1
                logger.info("%s -> %4d rows", label, len(df))

            manifest["failed"].pop(key, None)
            if i % 10 == 0 or i == len(pending):
                save_manifest(manifest)

    except KeyboardInterrupt:
        logger.warning("Interrupted — progress saved; rerun to resume.")
    finally:
        save_manifest(manifest)

    mins = (time.time() - t0) / 60
    logger.info("-" * 62)
    logger.info("Wrote %d files, %d empty, %d failed in %.1f min (%d API requests).",
                written, empty, failed, mins, client.request_count)
    logger.info("Manifest: %s", MANIFEST)
    if failed:
        logger.warning("%d sensor-seasons failed; rerun to retry just those.", failed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
