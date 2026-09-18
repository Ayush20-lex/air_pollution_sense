"""
Phase C, step 0 — Forecast baselines.

Before any model is trained, establish what it has to beat. A 72-hour PM2.5
forecast is only worth the GPU time if it improves on the trivial answers, and
those answers are strong in Delhi because the diurnal cycle is so regular.

Baselines, all scored on the same origins and lead times:

  persistence          y(t+h) = y(t)                  — the last observation
  diurnal persistence  y(t+h) = y(t+h-24)             — same hour, previous day
  climatology          y(t+h) = mean of that hour-of-day over the training period
  cams_raw             the CAMS forecast, untouched
  cams_bias            CAMS scaled by a single factor fitted on training data
  cams_bias_hourly     CAMS scaled per hour-of-day, fitted on training data

The last two matter most. CAMS reproduces Delhi's diurnal shape well but runs
about 40% low (observed mean 169 ug/m3 against 102), so a correction fitted in
one line removes most of the error. A trained model must beat *that*, not raw
CAMS, or it has added nothing.

Every correction is fitted on the training window only and applied unchanged to
the test window. Fitting on the full record would leak the answer.

Usage:
    python ml_pipeline/scripts/14_baselines.py
    python ml_pipeline/scripts/14_baselines.py --origin-stride 3
"""
from __future__ import annotations

import argparse
import glob
import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import observation_qc  # noqa: E402  - path set above

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("baselines")

DATA = REPO_ROOT / "ml_pipeline" / "data"
OUT_DIR = DATA / "processed"

HORIZON = 72          # forecast out to +72 h, matching the model
TRAIN_END = "2025-11-30"   # climatology and bias factors fitted on or before this
TEST_START = "2025-12-01"


def load_pairs(season: int) -> pd.DataFrame:
    """Observed and CAMS PM2.5 on a common (station, hour) index."""
    files = glob.glob(str(DATA / "raw" / "observations" / f"season={season}" / "pm25_*.parquet"))
    if not files:
        raise SystemExit(f"no pm25 observations for season {season}")
    obs = pd.concat(
        [pd.read_parquet(f, columns=["timestamp_utc", "location_id", "value"]) for f in files]
    ).dropna(subset=["value"]).rename(columns={"value": "obs"})
    obs["timestamp_utc"] = pd.to_datetime(obs.timestamp_utc, utc=True).dt.floor("h")
    obs = obs.groupby(["location_id", "timestamp_utc"], as_index=False)["obs"].mean()

    # The same network-contradiction filter the service applies, so the score
    # describes the data that is actually served. Without this the two diverge
    # silently: the API drops a 7080 ug/m3 sensor fault and this script keeps
    # it, and the published RMSE then belongs to a dataset nobody uses.
    wide = obs.pivot_table(index="timestamp_utc", columns="location_id", values="obs")
    cleaned = observation_qc.despike(wide.to_numpy(dtype=np.float32), f"pm25 season {season}")
    # dropna is load-bearing: stack() keeps NaN cells in this pandas version, so
    # without it the frame comes back as the full time x station grid - 925,344
    # rows where the observations are 743,682 - and the 181,662 empty ones ride
    # into the CAMS scale fit as extra denominator. That alone moved the fitted
    # scale from 0.937 to 0.707 and would have biased every forecast, from a
    # filter that was only supposed to remove 394 readings.
    obs = (
        pd.DataFrame(cleaned, index=wide.index, columns=wide.columns)
        .stack()
        .rename("obs")
        .reset_index()
        .dropna(subset=["obs"])
    )

    fc_path = DATA / "raw" / "forecast" / f"forecast_{season}.parquet"
    fc = pd.read_parquet(fc_path, columns=["timestamp_utc", "location_id", "cams_pm2_5"])
    fc["timestamp_utc"] = pd.to_datetime(fc.timestamp_utc, utc=True).dt.floor("h")

    df = obs.merge(fc, on=["location_id", "timestamp_utc"], how="left")
    df["hour_ist"] = df.timestamp_utc.dt.tz_convert("Asia/Kolkata").dt.hour
    return df.sort_values(["location_id", "timestamp_utc"]).reset_index(drop=True)


def fit_corrections(train: pd.DataFrame) -> dict:
    """Climatology and CAMS bias factors, fitted on the training window only."""
    clim = train.groupby("hour_ist")["obs"].mean().to_dict()

    ok = train.dropna(subset=["cams_pm2_5"])
    ok = ok[ok.cams_pm2_5 > 0]
    global_scale = float(ok.obs.sum() / ok.cams_pm2_5.sum()) if len(ok) else 1.0

    hourly = {}
    for h, g in ok.groupby("hour_ist"):
        hourly[int(h)] = float(g.obs.sum() / g.cams_pm2_5.sum()) if g.cams_pm2_5.sum() > 0 else global_scale

    return {"climatology": clim, "global_scale": global_scale, "hourly_scale": hourly}


def build_samples(df: pd.DataFrame, corr: dict, stride: int) -> pd.DataFrame:
    """One row per (station, origin, lead) with every baseline's prediction."""
    rows = []
    for loc, g in df.groupby("location_id", sort=False):
        g = g.set_index("timestamp_utc").sort_index()
        full = pd.date_range(g.index.min(), g.index.max(), freq="h", tz="UTC")
        g = g.reindex(full)
        obs = g["obs"].to_numpy(dtype="float64")
        cams = g["cams_pm2_5"].to_numpy(dtype="float64")
        hours = pd.Series(full).dt.tz_convert("Asia/Kolkata").dt.hour.to_numpy()
        n = len(full)

        test_mask = full >= pd.Timestamp(TEST_START, tz="UTC")
        origins = np.where(test_mask)[0]
        origins = origins[(origins >= 24) & (origins + HORIZON < n)][::stride]

        for t in origins:
            if not np.isfinite(obs[t]):
                continue                      # an origin needs a known current value
            leads = np.arange(1, HORIZON + 1)
            idx = t + leads
            truth = obs[idx]
            valid = np.isfinite(truth)
            if not valid.any():
                continue
            hr = hours[idx]
            rows.append(pd.DataFrame({
                "location_id": loc,
                "origin": full[t],
                "lead": leads[valid],
                "truth": truth[valid],
                "persistence": obs[t],
                "diurnal_persistence": obs[idx - 24][valid],
                "climatology": [corr["climatology"].get(int(h), np.nan) for h in hr[valid]],
                "cams_raw": cams[idx][valid],
                "cams_bias": cams[idx][valid] * corr["global_scale"],
                "cams_bias_hourly": cams[idx][valid]
                                    * np.array([corr["hourly_scale"].get(int(h), corr["global_scale"])
                                                for h in hr[valid]]),
            }))
    if not rows:
        raise SystemExit("no evaluable samples - check the test window")
    s = pd.concat(rows, ignore_index=True)

    # Combinations. The blend is the honest bar: persistence wins the first few
    # hours and diurnal persistence wins afterwards, so switching between them
    # beats either. The mean of diurnal persistence and bias-corrected CAMS is
    # stronger still — their errors are largely uncorrelated, so averaging cancels
    # part of both. Any trained model has to clear this, not raw CAMS.
    s["blend_persist_diurnal"] = np.where(s.lead <= 6, s.persistence, s.diurnal_persistence)
    s["blend_diurnal_cams"] = (s.diurnal_persistence + s.cams_bias) / 2.0
    return s


METHODS = ["persistence", "diurnal_persistence", "climatology",
           "cams_raw", "cams_bias", "cams_bias_hourly",
           "blend_persist_diurnal", "blend_diurnal_cams"]


def score(samples: pd.DataFrame) -> pd.DataFrame:
    out = []
    for m in METHODS:
        d = samples[["truth", m, "lead"]].dropna()
        err = d[m] - d["truth"]
        out.append({
            "method": m,
            "n": len(d),
            "rmse": float(np.sqrt((err ** 2).mean())),
            "mae": float(err.abs().mean()),
            "bias": float(err.mean()),
        })
    return pd.DataFrame(out).sort_values("rmse").reset_index(drop=True)


def score_by_lead(samples: pd.DataFrame, buckets=((1, 6), (7, 24), (25, 48), (49, 72))) -> pd.DataFrame:
    out = []
    for lo, hi in buckets:
        s = samples[(samples.lead >= lo) & (samples.lead <= hi)]
        row = {"lead": f"+{lo}-{hi}h"}
        for m in METHODS:
            d = s[["truth", m]].dropna()
            row[m] = float(np.sqrt(((d[m] - d["truth"]) ** 2).mean())) if len(d) else np.nan
        out.append(row)
    return pd.DataFrame(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--origin-stride", type=int, default=6,
                    help="hours between forecast origins (6 = four per day)")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    df = load_pairs(args.season)
    train = df[df.timestamp_utc <= pd.Timestamp(TRAIN_END, tz="UTC")]
    logger.info("season %d: %d station-hours (%d stations)", args.season, len(df),
                df.location_id.nunique())
    logger.info("fitting corrections on <= %s (%d rows), testing from %s",
                TRAIN_END, len(train), TEST_START)

    corr = fit_corrections(train)
    logger.info("CAMS global scale factor: %.3f  (>1 means CAMS runs low)", corr["global_scale"])

    samples = build_samples(df, corr, args.origin_stride)
    logger.info("evaluable forecasts: %d rows from %d origins",
                len(samples), samples.origin.nunique())

    overall = score(samples)
    by_lead = score_by_lead(samples)

    print("\nOVERALL (all leads +1..+72h), RMSE ug/m3 - lower is better")
    print(overall.to_string(index=False, float_format=lambda x: f"{x:8.2f}"))
    print("\nRMSE BY LEAD TIME")
    print(by_lead.to_string(index=False, float_format=lambda x: f"{x:8.2f}"))

    best = overall.iloc[0]
    print(f"\nBar to beat: {best['method']}  RMSE {best['rmse']:.2f} ug/m3")

    args.out.mkdir(parents=True, exist_ok=True)
    overall.to_csv(args.out / "baselines_overall.csv", index=False)
    by_lead.to_csv(args.out / "baselines_by_lead.csv", index=False)
    (args.out / "baseline_corrections.json").write_text(json.dumps(corr, indent=2))
    logger.info("wrote baselines_overall.csv, baselines_by_lead.csv, baseline_corrections.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
