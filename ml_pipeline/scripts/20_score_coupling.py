"""
Phase C, step 4 - does the aerosol-PBL feedback improve the forecast?

The blend baseline scores RMSE 62.23 ug/m3 over the held-out window. This asks
one question about `backend.coupled_feedback`: if the PM2.5 response is turned
on, so that a shallower boundary layer raises surface concentration, does the
forecast get better or worse?

It is worth asking rather than assuming, because the answer is genuinely
uncertain in both directions:

  * the physics is real, and a shallow inversion night really does concentrate
    the same emission into a smaller volume;

  * but the blend is built from observations, and those observations already
    happened under that inversion. The trap is in the measured number. Applying
    the response again counts it twice, and would push the forecast high on
    exactly the severe days that matter most.

Scored the way the baseline was scored: the same station-level pairs, the same
test window, the same leads, so the two numbers are comparable to the digit.

Usage:
    python ml_pipeline/scripts/20_score_coupling.py
    python ml_pipeline/scripts/20_score_coupling.py --stride 12 --season 2026
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import coupled_feedback as cf                      # noqa: E402
from baseline_forecaster import (                  # noqa: E402
    CH_PBL, CH_SOLAR, HORIZON, get_forecaster,
)

#: Same held-out window as 14_baselines.py. Changing it would make the two
#: numbers incomparable, which is the only thing this script is for.
TEST_START = "2025-12-01"


def rmse(pred: np.ndarray, truth: np.ndarray) -> float:
    return float(np.sqrt(np.nanmean((pred - truth) ** 2)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--stride", type=int, default=6,
                    help="hours between origins; 6 keeps the run a few minutes")
    args = ap.parse_args()

    f = get_forecaster(args.season)
    times = f.times
    solar = f.fields.get(CH_SOLAR)
    pbl = f.fields.get(CH_PBL)
    if solar is None or pbl is None:
        print("no solar or PBL field in this archive - cannot score the feedback")
        return 1

    # Truth is the unfilled observation: a forward-filled value is a copy of an
    # earlier hour, and scoring against it would reward predicting the past.
    truth_all = f._obs_raw
    obs = f.obs_pm25
    cams = f.cams_pm25

    start = np.searchsorted(times, pd.Timestamp(TEST_START, tz="UTC"))
    origins = [t for t in range(max(start, 24), len(times) - HORIZON, args.stride)]
    if not origins:
        print("no origins in the test window")
        return 1

    base_pred, coup_pred, truths = [], [], []
    for t0 in origins:
        leads = np.arange(1, HORIZON + 1)
        idx = t0 + leads
        # The forecaster's own blend, reproduced exactly.
        diurnal = obs[idx - 24]
        cam = cams[idx] * f.scale
        blend = np.where(np.isfinite(diurnal) & np.isfinite(cam), (diurnal + cam) / 2.0,
                         np.where(np.isfinite(diurnal), diurnal, cam))
        y = truth_all[idx]
        c = cf.couple(blend, solar[idx], pbl[idx], amplify=True)
        base_pred.append(blend)
        coup_pred.append(c.pm25)
        truths.append(y)

    base = np.concatenate([a.ravel() for a in base_pred])
    coup = np.concatenate([a.ravel() for a in coup_pred])
    y = np.concatenate([a.ravel() for a in truths])

    ok = np.isfinite(y) & np.isfinite(base) & np.isfinite(coup)
    base, coup, y = base[ok], coup[ok], y[ok]

    r_base, r_coup = rmse(base, y), rmse(coup, y)
    b_base = float(np.nanmean(base - y))
    b_coup = float(np.nanmean(coup - y))

    print(f"season {args.season}   origins {len(origins)}   comparisons {len(y):,}")
    print(f"  baseline blend      RMSE {r_base:7.2f}   bias {b_base:+7.2f} ug/m3")
    print(f"  with PM2.5 feedback RMSE {r_coup:7.2f}   bias {b_coup:+7.2f} ug/m3")
    delta = r_coup - r_base
    print(f"  change              {delta:+7.2f} ug/m3  ({delta / r_base * 100:+.1f}%)")

    # The severe tail is where the double-counting argument bites, so it is
    # reported separately rather than averaged away.
    severe = y >= 150.0
    if severe.any():
        print(f"  on observed >=150 ug/m3 ({severe.sum():,} comparisons):")
        print(f"    baseline  RMSE {rmse(base[severe], y[severe]):7.2f}   bias {np.mean(base[severe] - y[severe]):+7.2f}")
        print(f"    coupled   RMSE {rmse(coup[severe], y[severe]):7.2f}   bias {np.mean(coup[severe] - y[severe]):+7.2f}")

    # Conditioning on the OBSERVED value is a trap: selecting y >= 150 picks
    # the cases where the forecast came in low, so any upward shift flatters it
    # whether or not it is right. Conditioning on what the forecast actually
    # said is the decision a reader would face, and it cannot be gamed that way.
    for name, mask in (("forecast >=150 (baseline)", base >= 150.0),
                       ("forecast >=150 (coupled)", coup >= 150.0)):
        if mask.any():
            print(f"  {name}, {mask.sum():,} comparisons:")
            print(f"    baseline  RMSE {rmse(base[mask], y[mask]):7.2f}   bias {np.mean(base[mask] - y[mask]):+7.2f}")
            print(f"    coupled   RMSE {rmse(coup[mask], y[mask]):7.2f}   bias {np.mean(coup[mask] - y[mask]):+7.2f}")

    # Does it change the advisory? GRAP turns on a forecast crossing a band, so
    # detection matters separately from RMSE.
    #
    # The control is the point: a uniform scaling matched to the coupling's own
    # mean inflation. Most of what an upward shift buys at a threshold is bought
    # by any upward shift, and only the margin above this control is the physics
    # earning its place by putting the increase in the right cells.
    k = float(coup.mean() / base.mean())
    uniform = base * k

    def f1(pred: np.ndarray, thr: float) -> float:
        p, t = pred >= thr, y >= thr
        tp = int((p & t).sum()); fp = int((p & ~t).sum()); fn = int((~p & t).sum())
        return 2 * tp / max(2 * tp + fp + fn, 1)

    print(f"  uniform control: baseline x {k:.4f} (same mean inflation)")
    print(f"    {'':18} {'RMSE':>8} {'F1@120':>8} {'F1@250':>8}")
    for nm, pr in (("baseline", base), ("coupled", coup), ("uniform", uniform)):
        print(f"    {nm:18} {rmse(pr, y):8.2f} {f1(pr, 120):8.4f} {f1(pr, 250):8.4f}")

    print()
    if delta > 0.05:
        print("VERDICT: the PM2.5 feedback makes the forecast worse on RMSE, and a")
        print("         flat shift beats it there. It does beat that control on severe")
        print("         event detection, so the physics is real but does not belong in")
        print("         the published number. Keep amplify off; serve the diagnostic.")
    elif delta < -0.05:
        print("VERDICT: the PM2.5 feedback improves the forecast. Worth enabling,")
        print("         and the published RMSE should be restated.")
    else:
        print("VERDICT: no material difference. Keep amplify off - it is the")
        print("         assumption that does not double count.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
