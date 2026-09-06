"""
Phase 0, step 1 — Build the ground-truth station catalogue for Delhi NCR.

Replaces the single-station label set (openaq_20231101_20231107.csv: one station,
pm25 only, 206 rows) with the full CPCB/DPCC/UPPCB/HSPCB network that OpenAQ v3
redistributes.

Two traps this script exists to avoid:

1. A location's `datetimeFirst`/`datetimeLast` is the UNION across all of its
   sensors, including decommissioned ones. Location 17 (R K Puram) advertises
   2016-02-05 -> 2026-09-03, but that is sensor 35 (pm25, dead in Feb 2018) plus
   sensor 12234787 (pm25, live from Feb 2025). Nothing covers 2023 or 2024.
   Filtering on the location envelope therefore silently selects dead sensors.
   We resolve coverage per SENSOR, via /v3/locations/{id}/sensors.

2. Most CPCB stations in OpenAQ have a hard gap from ~2022-10-31 to 2025-02-18.
   Only location 8118 (AirNow, the US embassy monitor) spans it — which is why
   the original pilot ended up with exactly one station.

The catalogue records, per season, which sensor id actually serves each
parameter, so 11_fetch_station_observations.py never spends its request budget
on a sensor that has no data for the window.

Usage:
    python ml_pipeline/scripts/10_fetch_station_catalog.py
    python ml_pipeline/scripts/10_fetch_station_catalog.py --seasons 2025
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openaq_client import OpenAQClient, OpenAQError  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("catalog")

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "ml_pipeline" / "data"
GRID_DEF = DATA_DIR / "metadata" / "grid_definition.json"
OUT_PATH = DATA_DIR / "raw" / "stations" / "catalog.json"

# Pollutants the 12-channel model consumes, plus surface met variables that let
# us measure forecast bias in the meteorology directly at the station.
POLLUTANTS = ["pm25", "pm10", "o3", "no2", "nox"]
MET = ["temperature", "relativehumidity", "wind_speed", "wind_direction"]

# The CAMS reanalysis that Open-Meteo serves — the forecast we bias-correct —
# only begins in 2022. Earlier seasons have observations but nothing to correct.
# (Open-Meteo returns HTTP 200 with all-null values before then, not an error.)
CAMS_FIRST_YEAR = 2022

# Default season is 1 Oct -> 31 Dec, but the OpenAQ CPCB feed stops on
# 2022-10-31, so Oct-Dec 2022 would score 34% coverage and drop 37 usable
# stations. Pin 2022 to the month that actually has data.
SEASON_WINDOWS: dict[int, tuple[str, str]] = {
    2022: ("2022-10-01", "2022-10-31"),
}


def load_bbox() -> str:
    """OpenAQ wants minLon,minLat,maxLon,maxLat — read it off the model grid."""
    grid = json.loads(GRID_DEF.read_text())
    lat0, lat1 = grid["lat_bounds"]
    lon0, lon1 = grid["lon_bounds"]
    return f"{lon0},{lat0},{lon1},{lat1}"


def season_window(year: int) -> tuple[str, str]:
    """Burning season window for a year — Oct-Dec unless pinned above."""
    return SEASON_WINDOWS.get(year, (f"{year}-10-01", f"{year}-12-31"))


def covers(first: str, last: str, start: str, end: str, min_frac: float) -> bool:
    """Does [first,last] cover at least `min_frac` of [start,end]?

    Full coverage is too strict: several stations come online mid-season
    (Manesar starts 2025-09-30, Ballabgarh 2025-10-04) and are still worth
    fetching. Overlap is measured on date strings, which sort correctly in ISO.
    """
    if not first or not last or last < start or first > end:
        return False
    lo, hi = max(first, start), min(last, end)
    span = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days + 1
    got = (datetime.fromisoformat(hi) - datetime.fromisoformat(lo)).days + 1
    return got / span >= min_frac


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", type=int, nargs="+", default=[2022, 2023, 2024, 2025],
                    help="Burning-season years (Oct-Dec) to resolve sensors for.")
    ap.add_argument("--min-coverage", type=float, default=0.5,
                    help="Fraction of the season a sensor must span to be kept.")
    ap.add_argument("--bbox", default=None, help="minLon,minLat,maxLon,maxLat (default: model grid)")
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args()

    load_dotenv(REPO_ROOT / "external_data_pipeline" / ".env")

    bbox = args.bbox or load_bbox()
    logger.info("bbox=%s  seasons=%s  min-coverage=%.0f%%",
                bbox, args.seasons, args.min_coverage * 100)

    client = OpenAQClient()
    locations = list(client.paginate("/v3/locations", {"bbox": bbox}, page_size=1000))
    logger.info("Discovered %d locations in bbox. Resolving per-sensor coverage...", len(locations))

    wanted = set(POLLUTANTS) | set(MET)
    stations = []

    for i, loc in enumerate(locations, 1):
        loc_id = loc["id"]
        try:
            sensors_raw = list(client.paginate(f"/v3/locations/{loc_id}/sensors", page_size=100))
        except OpenAQError as exc:
            logger.warning("loc %s: could not list sensors (%s) — skipping.", loc_id, exc)
            continue

        # Every sensor for a wanted parameter, with its own real coverage window.
        sensors: dict[str, list[dict]] = {}
        for s in sensors_raw:
            name = (s.get("parameter") or {}).get("name")
            if name not in wanted:
                continue
            sensors.setdefault(name, []).append({
                "sensor_id": s["id"],
                "units": (s.get("parameter") or {}).get("units"),
                "first": ((s.get("datetimeFirst") or {}).get("utc") or "")[:10],
                "last": ((s.get("datetimeLast") or {}).get("utc") or "")[:10],
            })

        # Resolve, per season, which sensor actually serves each parameter.
        per_season: dict[str, dict[str, int]] = {}
        for year in args.seasons:
            start, end = season_window(year)
            chosen: dict[str, int] = {}
            for param, cands in sensors.items():
                live = [c for c in cands
                        if covers(c["first"], c["last"], start, end, args.min_coverage)]
                if live:
                    # Prefer the sensor with the longest overlap of this season.
                    live.sort(key=lambda c: (min(c["last"], end), -len(c["first"])), reverse=True)
                    chosen[param] = live[0]["sensor_id"]
            if "pm25" in chosen:  # no PM2.5 label ⇒ the station is useless as ground truth
                per_season[str(year)] = chosen

        if not per_season:
            continue

        coords = loc.get("coordinates") or {}
        stations.append({
            "location_id": loc_id,
            "location_name": loc.get("name"),
            "provider": (loc.get("provider") or {}).get("name"),
            "latitude": coords.get("latitude"),
            "longitude": coords.get("longitude"),
            "timezone": loc.get("timezone"),
            "sensors": sensors,
            "seasons": per_season,
        })

        if i % 25 == 0:
            logger.info("  ...resolved %d/%d locations", i, len(locations))

    stations.sort(key=lambda s: s["location_id"])

    season_summary = {}
    for year in args.seasons:
        y = str(year)
        members = [s for s in stations if y in s["seasons"]]
        sensor_n = sum(len(s["seasons"][y]) for s in members)
        season_summary[y] = {
            "window": season_window(year),
            "station_count": len(members),
            "sensor_count": sensor_n,
            "cams_forecast_available": year >= CAMS_FIRST_YEAR,
        }

    catalog = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox": bbox,
        "min_coverage": args.min_coverage,
        "parameters": {"pollutants": POLLUTANTS, "met": MET},
        "seasons": season_summary,
        "station_count": len(stations),
        "stations": stations,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(catalog, indent=2))

    logger.info("-" * 68)
    logger.info("%-8s %-9s %-8s %s", "SEASON", "STATIONS", "SENSORS", "CAMS forecast?")
    for y, s in season_summary.items():
        logger.info("%-8s %-9d %-8d %s", y, s["station_count"], s["sensor_count"],
                    "yes" if s["cams_forecast_available"] else "NO — unusable for bias correction")
    logger.info("-" * 68)
    logger.info("%d stations catalogued. %d API requests.", len(stations), client.request_count)
    logger.info("Wrote %s", args.out)

    if not stations:
        logger.error("No stations matched — widen --bbox, --seasons or --min-coverage.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
