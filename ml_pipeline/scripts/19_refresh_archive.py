"""
Phase 0, step 4 — Bring the served archive up to date, in one command.

The service replays a real window, so "how current is it" is a data question,
not a code one. This closes the gap between the newest hour in the archive and
now, and then updates everything that was derived from the old window - because
those derivations are frozen views and a mismatch between them and the archive
is silent.

    python ml_pipeline/scripts/19_refresh_archive.py

What it does, in order:

  1. reads the newest hour already held, and builds a catalogue window from
     there to today
  2. fetches observations (PM2.5, PM10, NO2, O3) and the CAMS + weather
     forecast fields for that window only
  3. merges them into the season - concatenate, sort, drop duplicate
     timestamps - so re-running changes nothing and nothing held is lost
  4. re-scores the baselines on the larger record
  5. installs the refitted CAMS correction for that season
  6. rewrites the published RMSE, sample size and CAMS-beat in
     backend/baseline_forecaster.py
  7. regenerates the offline station snapshot in the dashboard
  8. retunes the synthetic REGIME scale to the new window's loading

Steps 6 to 8 are the reason this is a script rather than a note. They are
mechanical, easy to forget, and forgetting any one of them leaves the product
claiming something about a window it no longer serves: a published error
measured on different data, an offline mesh that disagrees with the live one, a
synthetic fallback describing a different city.

Two days of lag will remain and cannot be closed from here. That is CPCB's own
publication delay through OpenAQ; the newest reading available is typically
around 36-48 hours old.

Needs OPENAQ_API_KEY. It is read from the environment, or from
external_data_pipeline/.env if that file is present.

Usage:
    python ml_pipeline/scripts/19_refresh_archive.py
    python ml_pipeline/scripts/19_refresh_archive.py --dry-run
    python ml_pipeline/scripts/19_refresh_archive.py --skip-fetch   # re-derive only
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "ml_pipeline" / "data"
SCRIPTS = REPO / "ml_pipeline" / "scripts"
BACKEND = REPO / "backend"
STATIONS_TS = REPO / "sih-dashboard" / "src" / "lib" / "terminal" / "stations.ts"
DATA_TS = REPO / "sih-dashboard" / "src" / "lib" / "data.ts"

OBS_DIR = DATA / "raw" / "observations"
FC_PATH = DATA / "raw" / "forecast"
CATALOG = DATA / "raw" / "stations" / "catalog.json"
CATALOG_EXT = DATA / "raw" / "stations" / "catalog_extended.json"

PARAMS = ["pm25", "pm10", "no2", "o3"]

#: How far past today to pull the forecast. The horizon is 72 hours and an
#: origin needs all of it, so anything less caps how recent an origin can be.
LEAD_DAYS = 4

#: Unscaled loading of the synthetic generator at hour 0, in ug/m3. REGIME is
#: the ratio between the replayed window's level and this. Measured once by
#: setting REGIME to 1 and reading the console; it is a property of the
#: generator's constants, not of any season.
SYNTHETIC_BASE_PM25 = 111.0

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("refresh")


# ── helpers ──────────────────────────────────────────────────────────────────

def api_key() -> str:
    key = os.getenv("OPENAQ_API_KEY", "")
    if key:
        return key
    env = REPO / "external_data_pipeline" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAQ_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit(
        "OPENAQ_API_KEY not set, and no external_data_pipeline/.env to read it from."
    )


def archive_end(season: int) -> pd.Timestamp:
    """Newest *observed* hour the archive holds.

    Read from the observations, not the forecast. The forecast parquet runs
    ahead of now by design - it carries the CAMS and weather prediction for
    hours that have not happened - so measuring the gap from it reports the
    archive as current when the measurements behind it are days old.
    """
    files = sorted((OBS_DIR / f"season={season}").glob("pm25_*.parquet"))
    if not files:
        raise SystemExit(f"no PM2.5 observations for season {season}")
    newest = max(
        pd.to_datetime(
            pd.read_parquet(f, columns=["timestamp_utc"]).timestamp_utc, utc=True
        ).max()
        for f in files
    )
    return newest


def run(cmd: list[str], env: dict | None = None) -> None:
    log.info("  $ %s", " ".join(str(c) for c in cmd[-6:]))
    r = subprocess.run(cmd, env={**os.environ, **(env or {})}, cwd=REPO)
    if r.returncode != 0:
        raise SystemExit(f"step failed: {' '.join(str(c) for c in cmd)}")


def patch(path: Path, pairs: list[tuple[str, str]], label: str) -> None:
    """Replace each old with new, refusing on anything but an exact single hit.

    Silent no-ops are the failure mode that matters here: a refresh that
    appears to succeed while leaving a stale number behind is worse than one
    that stops.
    """
    s = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old == new:
            continue
        n = s.count(old)
        if n != 1:
            raise SystemExit(f"{label}: expected one {old!r}, found {n}")
        s = s.replace(old, new)
    path.write_text(s, encoding="utf-8", newline="\n")
    log.info("  updated %s", label)


# ── steps ────────────────────────────────────────────────────────────────────

def build_gap_catalogue(season: int, start: date, end: date) -> Path:
    src = CATALOG_EXT if CATALOG_EXT.exists() else CATALOG
    cat = json.loads(src.read_text(encoding="utf-8"))
    cat["seasons"][str(season)] = {"window": [start.isoformat(), end.isoformat()]}
    out = DATA / "raw" / "stations" / "catalog_gap.json"
    out.write_text(json.dumps(cat), encoding="utf-8")
    return out


def merge_observations(gap_dir: Path, season: int) -> int:
    added = 0
    target = OBS_DIR / f"season={season}"
    for g in sorted((gap_dir / f"season={season}").glob("*.parquet")):
        m = target / g.name
        gd = pd.read_parquet(g)
        if m.exists():
            md = pd.read_parquet(m)
            before = len(md)
            out = pd.concat([md, gd], ignore_index=True)
            out["_t"] = pd.to_datetime(out.timestamp_utc, utc=True)
            out = (out.sort_values("_t")
                      .drop_duplicates(subset=["_t"], keep="last")
                      .drop(columns="_t"))
            added += len(out) - before
        else:
            out = gd
            added += len(gd)
        out.to_parquet(m, index=False)
    return added


def merge_forecast(gap_dir: Path, season: int) -> tuple[int, pd.Timestamp]:
    g = gap_dir / f"forecast_{season}.parquet"
    m = FC_PATH / f"forecast_{season}.parquet"
    gd = pd.read_parquet(g)
    md = pd.read_parquet(m)
    before = len(md)
    out = pd.concat([md, gd], ignore_index=True)
    out["_t"] = pd.to_datetime(out.timestamp_utc, utc=True)
    out = (out.sort_values(["location_id", "_t"])
              .drop_duplicates(subset=["location_id", "_t"], keep="last")
              .drop(columns="_t"))
    out.to_parquet(m, index=False)
    return len(out) - before, pd.to_datetime(out.timestamp_utc, utc=True).max()


def rescore(season: int, out_dir: Path) -> dict:
    run([sys.executable, str(SCRIPTS / "14_baselines.py"),
         "--season", str(season), "--out", str(out_dir)])
    overall = pd.read_csv(out_dir / "baselines_overall.csv").set_index("method")
    by_lead = pd.read_csv(out_dir / "baselines_by_lead.csv").set_index("lead")
    blend = overall.loc["blend_diurnal_cams"]
    raw = overall.loc["cams_raw", "rmse"]
    return {
        "rmse": round(float(blend["rmse"]), 2),
        "n": int(blend["n"]),
        "beats": f"{round((raw - float(blend['rmse'])) / raw * 100)}%",
        "lead": {k: round(float(v), 1)
                 for k, v in by_lead["blend_diurnal_cams"].items()},
        "persistence_lead": {k: round(float(v), 1)
                             for k, v in by_lead["persistence"].items()},
        "table": {m: round(float(overall.loc[m, "rmse"]), 2) for m in overall.index},
    }


def regenerate_snapshot(season: int, as_of: str) -> dict:
    """Rewrite the dashboard's offline station list from the registry."""
    sys.path.insert(0, str(BACKEND))
    import station_registry  # noqa: PLC0415 - path set above

    station_registry.build.cache_clear()
    mesh = [s for s in station_registry.build(season, as_of)["stations"]
            if s["valid"] and s["aqi"] is not None]

    src = STATIONS_TS.read_text(encoding="utf-8")
    block = re.search(r"export const STATIONS: Station\[\] = \[\n(.*?)\n\];", src, re.S)
    rows = [l for l in block.group(1).split("\n") if l.strip().startswith("{")]

    def field(line: str, key: str, quoted: bool = True):
        m = re.search((rf"{key}: '([^']*)'") if quoted else (rf"{key}: (-?[\d.]+)"), line)
        return m.group(1) if m else None

    cur = [dict(id=field(l, "id"), name=field(l, "name"), zone=field(l, "zone"),
                source=field(l, "source"), lat=float(field(l, "lat", False)),
                lng=float(field(l, "lng", False)), master="master: true" in l)
           for l in rows]

    def km(a, b, c, d):
        return math.hypot((a - c) * 111.0, (b - d) * 97.5)

    stop = {"delhi", "new", "ncr", "uttar", "pradesh", "up", "india", "gram"}

    def toks(s):
        return {t for t in re.split(r"[^a-z0-9]+", s.lower())
                if len(t) > 1 and t not in stop}

    pairs = sorted((km(c["lat"], c["lng"], m["lat"], m["lon"]), i, j)
                   for i, c in enumerate(cur) for j, m in enumerate(mesh)
                   if km(c["lat"], c["lng"], m["lat"], m["lon"]) <= 2.0)
    used_c, used_m, match = set(), set(), {}
    for d, i, j in pairs:
        if i in used_c or j in used_m:
            continue
        if d > 0.25 and not (toks(cur[i]["name"]) & toks(mesh[j]["full_name"])):
            continue
        used_c.add(i)
        used_m.add(j)
        match[i] = mesh[j]

    label = {"PM2.5": "PM2.5", "PM10": "PM10", "O3": "O3", "NO2": "NO2"}
    out = []
    for i, c in enumerate(cur):
        if i not in match:
            continue
        m = match[i]
        cov = m["coverage_pct"]
        status = "ONLINE" if cov >= 90 else "DEGRADED" if cov >= 60 else "CALIBRATING"
        out.append(
            f"  {{ id: '{c['id']}', name: '{c['name']}', zone: '{c['zone']}', "
            f"agency: '{m['agency']}', lat: {c['lat']}, lng: {c['lng']}, "
            f"aqi: {m['aqi']}, dominant: '{label.get(m['prominent_pollutant'] or '', 'PM2.5')}', "
            f"source: '{c['source']}', delta: {round(m['delta_24h_pct'] or 0.0, 1)}, "
            f"sensors: {m['sensors_reporting']}, uptime: '{cov:.1f}%', status: '{status}'"
            f"{', master: true' if c['master'] else ''} }},"
        )

    aqis = [match[i]["aqi"] for i in match]
    src = re.sub(r"(export const STATIONS: Station\[\] = \[\n).*?(\n\];)",
                 lambda mm: mm.group(1) + "\n".join(out) + mm.group(2), src, flags=re.S)
    src = re.sub(r"recorded at \S+Z", f"recorded at {as_of.replace('+00:00', 'Z')}", src)
    src = re.sub(r"a mean of \d+, ranging \d+ to \d+",
                 f"a mean of {sum(aqis) // len(aqis)}, ranging {min(aqis)} to {max(aqis)}", src)
    STATIONS_TS.write_text(src, encoding="utf-8", newline="\n")
    return {"nodes": len(aqis), "min": min(aqis), "max": max(aqis),
            "mean": sum(aqis) // len(aqis)}


def retune_regime(season: int) -> tuple[float, float]:
    """Set REGIME so the offline console sits at the replayed window's level.

    Sampled at the five district coordinates the console plots, read out of
    data.ts rather than duplicated here - the point is to match what the page
    shows, and a second copy of those coordinates would be one more thing to
    drift.
    """
    sys.path.insert(0, str(BACKEND))
    import baseline_forecaster as bf  # noqa: PLC0415

    result = bf.BlendBaselineForecaster(season).forecast()
    grid = result.tensor[0, 0] * 500.0          # hour 0, PM2.5, (70, 80) ug/m3

    ts = DATA_TS.read_text(encoding="utf-8")
    coords = [(float(a), float(b)) for a, b in
              re.findall(r"lat:\s*(-?[\d.]+),\s*\n?\s*lng:\s*(-?[\d.]+)", ts)]
    lat_v = np.linspace(28.20, 28.90, grid.shape[0])
    lon_v = np.linspace(76.80, 77.60, grid.shape[1])
    vals = [float(grid[int(np.clip(np.searchsorted(lat_v, la), 0, grid.shape[0] - 1)),
                        int(np.clip(np.searchsorted(lon_v, lo), 0, grid.shape[1] - 1))])
            for la, lo in coords] or [float(grid.mean())]
    target = float(np.mean(vals))
    return round(target / SYNTHETIC_BASE_PM25, 3), round(target, 1)


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--skip-fetch", action="store_true",
                    help="Re-derive from what is already held, fetching nothing.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report the gap and stop.")
    args = ap.parse_args()

    season = args.season
    end = archive_end(season)
    today = date.today()
    behind = (today - end.date()).days
    log.info("archive holds up to %s  (%d days behind %s)", end, behind, today)

    if args.dry_run:
        return 0

    tmp = DATA / "raw" / "_refresh_tmp"
    if not args.skip_fetch:
        if behind < 1:
            log.info("already current; nothing to fetch")
        else:
            shutil.rmtree(tmp, ignore_errors=True)
            # One day of overlap: the boundary hour is often partial when first
            # published, and the merge dedupes, so re-fetching it is free.
            start = end.date() - timedelta(days=1)
            env = {"OPENAQ_API_KEY": api_key()}

            # Observations: up to today. There are none beyond it.
            cat = build_gap_catalogue(season, start, today)
            log.info("fetching observations %s -> %s", start, today)
            run([sys.executable, str(SCRIPTS / "11_fetch_station_observations.py"),
                 "--catalog", str(cat), "--seasons", str(season),
                 "--params", *PARAMS, "--out", str(tmp / "obs"), "--force"], env)

            # Forecast: past today, and that is the point. An origin needs 72
            # hours of lead ahead of it, so stopping the forecast at today caps
            # the newest origin three days back however current the
            # measurements are - the archive looked a fortnight stale for
            # exactly this reason, and the missing data was the future, not the
            # past. Open-Meteo serves roughly a week ahead.
            fut = today + timedelta(days=LEAD_DAYS)
            cat = build_gap_catalogue(season, start, fut)
            log.info("fetching forecast %s -> %s (%d days of lead)", start, fut, LEAD_DAYS)
            run([sys.executable, str(SCRIPTS / "12_fetch_openmeteo_forecast.py"),
                 "--catalog", str(cat), "--seasons", str(season),
                 "--out", str(tmp / "fc"), "--force"])

            obs_added = merge_observations(tmp / "obs", season)
            fc_added, new_end = merge_forecast(tmp / "fc", season)
            log.info("merged: +%d observation rows, +%d forecast rows, archive now ends %s",
                     obs_added, fc_added, new_end)
            shutil.rmtree(tmp, ignore_errors=True)
            cat.unlink(missing_ok=True)

    log.info("re-scoring")
    score_dir = DATA / "processed" / f"_baselines_{season}"
    s = rescore(season, score_dir)
    shutil.copy(score_dir / "baseline_corrections.json",
                DATA / "processed" / f"baseline_corrections_{season}.json")
    log.info("  RMSE %.2f over %d comparisons, %s better than raw CAMS",
             s["rmse"], s["n"], s["beats"])

    fwd = BACKEND / "baseline_forecaster.py"
    cur_rmse = re.search(r'"validated_rmse_ugm3": ([\d.]+)', fwd.read_text(encoding="utf-8"))
    cur_n = re.search(r'"scored_comparisons": ([\d_]+)', fwd.read_text(encoding="utf-8"))
    cur_beats = re.search(r'"beats_raw_cams_by": "(\d+%)"', fwd.read_text(encoding="utf-8"))
    patch(fwd, [
        (f'"validated_rmse_ugm3": {cur_rmse.group(1)}', f'"validated_rmse_ugm3": {s["rmse"]}'),
        (f'"scored_comparisons": {cur_n.group(1)}', f'"scored_comparisons": {s["n"]:_}'),
        (f'"beats_raw_cams_by": "{cur_beats.group(1)}"', f'"beats_raw_cams_by": "{s["beats"]}"'),
    ], "backend/baseline_forecaster.py")

    sys.path.insert(0, str(BACKEND))
    import baseline_forecaster as bf  # noqa: PLC0415

    origin = str(bf.BlendBaselineForecaster(season).forecast().origin).replace(" ", "T")
    log.info("served origin is now %s", origin)

    snap = regenerate_snapshot(season, origin)
    log.info("  snapshot: %d nodes, %d-%d, mean %d",
             snap["nodes"], snap["min"], snap["max"], snap["mean"])

    regime, target = retune_regime(season)
    ts = DATA_TS.read_text(encoding="utf-8")
    old_regime = re.search(r"export const REGIME = ([\d.]+);", ts).group(1)
    patch(DATA_TS, [
        (f"export const REGIME = {old_regime};", f"export const REGIME = {regime};"),
        (re.search(r" \* Season \d+, origin \S+: target ~[\d.]+ ug/m3 at hour 0\.", ts).group(0),
         f" * Season {season}, origin {origin.replace('+00:00', 'Z')}: "
         f"target ~{target:.0f} ug/m3 at hour 0."),
    ], "sih-dashboard/src/lib/data.ts")

    print()
    print("  RMSE            %.2f ug/m3   (%d comparisons, %s better than raw CAMS)"
          % (s["rmse"], s["n"], s["beats"]))
    print("  by lead         " + "  ".join(f"{k} {v}" for k, v in s["lead"].items()))
    print("  origin          %s" % origin)
    print("  snapshot        %d nodes, AQI %d-%d" % (snap["nodes"], snap["min"], snap["max"]))
    print("  REGIME          %s  (target %.0f ug/m3)" % (regime, target))
    print()
    print("  Next: rebuild the dashboard, run the backend suites, commit.")
    print("    cd sih-dashboard && npm run build")
    print("    cd backend && python test_aqi_cpcb.py && python test_normalization.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
