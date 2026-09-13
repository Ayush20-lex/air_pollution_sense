"""
Extend the station catalogue to the full available record - Air Pollution Sense
SIH26082 - MoES / NCMRWF

    python ml_pipeline/scripts/18_extend_catalog.py

The fetchers are season-driven: script 11 reads `catalog["seasons"][year]` for a
date window and `station["seasons"][year]` for which sensor carries each
parameter. That design pulled one burning season at a time, which was right for
the pilot and is now the binding constraint on training.

The record is far longer than what was fetched. The CPCB feed resumed on
2025-02-18 after its outage and 66 stations are still reporting into September
2026 - roughly eighteen months of continuous hourly data against the three
months currently on disk. The coupled model's failure was diagnosed as 1.15 M
parameters against ~1,800 training windows; six times the record is the one
intervention that attacks that directly, and it costs API time rather than
engineering time.

This writes a *new* catalogue rather than editing the original. catalog.json is
what the existing dataset, its manifest and every published number were built
from, so mutating it would quietly invalidate work that is already validated.

The new season is labelled 2026 and spans the whole continuous run, so the
resulting dataset is one unbroken block with no seam to exclude windows across -
unlike the present 2022/2025 split, which costs 78 training windows.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CATALOG = REPO_ROOT / "ml_pipeline" / "data" / "raw" / "stations" / "catalog.json"
OUT = REPO_ROOT / "ml_pipeline" / "data" / "raw" / "stations" / "catalog_extended.json"

#: The continuous CPCB run: feed resumes after the outage, through the latest
#: reading in the catalogue.
LABEL = "2026"
WINDOW_START = "2025-02-18"

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("extend_catalog")


def overlaps(first: str | None, last: str | None, lo: str, hi: str) -> bool:
    """Does a sensor's lifetime intersect the requested window at all?"""
    if not first or not last:
        return False
    return first <= hi and last >= lo


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    # End the window at the newest reading any sensor reports, so we never ask
    # the API for a future it cannot have.
    latest = max(
        (sn["last"] for st in catalog["stations"]
         for lst in (st.get("sensors") or {}).values()
         for sn in lst if sn.get("last")),
        default=date.today().isoformat(),
    )
    window = [WINDOW_START, latest]
    logger.info("window: %s -> %s", *window)

    n_stations = 0
    n_sensors = 0
    for st in catalog["stations"]:
        chosen: dict[str, int] = {}
        for param, sensors in (st.get("sensors") or {}).items():
            live = [s for s in sensors
                    if overlaps(s.get("first"), s.get("last"), *window)
                    and s.get("sensor_id") is not None]
            if not live:
                continue
            # Several sensors can carry one parameter across a station's life;
            # take the one reporting furthest into the window.
            chosen[param] = max(live, key=lambda s: s["last"])["sensor_id"]

        if chosen:
            st.setdefault("seasons", {})[LABEL] = chosen
            n_stations += 1
            n_sensors += len(chosen)

    catalog["seasons"][LABEL] = {
        "window": window,
        "station_count": n_stations,
        "sensor_count": n_sensors,
        "cams_forecast_available": False,   # script 12 has not run for this span
        "note": "full continuous CPCB run after the 2022-10..2025-02 outage",
    }

    OUT.write_text(json.dumps(catalog, indent=2), encoding="utf-8")

    months = (date.fromisoformat(window[1]) - date.fromisoformat(window[0])).days / 30.44
    hours = int(months * 30.44 * 24)
    print()
    print("=" * 66)
    print(f"  season {LABEL}   {window[0]} -> {window[1]}   ({months:.1f} months)")
    print(f"  stations     {n_stations}")
    print(f"  sensors      {n_sensors}")
    print(f"  hours        ~{hours:,}   (currently training on 2,208)")
    print(f"  written      {OUT}")
    print("=" * 66)
    print("  next:")
    print(f"    python ml_pipeline/scripts/11_fetch_station_observations.py \\")
    print(f"        --catalog {OUT.relative_to(REPO_ROOT)} --seasons {LABEL}")
    print(f"    python ml_pipeline/scripts/12_fetch_openmeteo_forecast.py \\")
    print(f"        --catalog {OUT.relative_to(REPO_ROOT)} --seasons {LABEL}")
    print("=" * 66)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
