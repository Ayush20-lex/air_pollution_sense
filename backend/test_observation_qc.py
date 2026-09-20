"""
Tests for observation_qc.

Run: python test_observation_qc.py

Both filters here decide what a published AQI is built from, and neither had a
test. They are the last thing standing between a broken instrument and a number
the page tells a reader to act on: `despike` removed the 7,080 ug/m3 reading
that was setting the GRAP stage for the whole grid, and `drop_stuck` removed the
sixteen flat hours that published Delhi's worst station as "Satisfactory".

The fixtures are the incidents the module's own docstrings cite, because those
are the cases the thresholds were chosen against. Two of them are near misses -
a real regional episode that must survive, and a fault just under the old
ceiling that must not - and they are the reason the rules are shaped the way
they are rather than something simpler.
"""
from __future__ import annotations

import numpy as np

import observation_qc as qc

passed = 0
failed = 0


def check(label: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"[PASS] {label}")
    else:
        failed += 1
        print(f"[FAIL] {label}")


def hour(*values: float) -> np.ndarray:
    """One hour across several stations, shaped (1, n)."""
    return np.array([list(values)], dtype=np.float32)


NAN = np.nan


# ── despike: the network contradicts a reading ──────────────────────────────

# Station 6359, 17:00 on 14 May 2026. Every other station that hour had a
# median of 61 and a maximum of 174.
out = qc.despike(hour(7080.0, 61.0, 58.0, 174.0, 63.0))
check("a 7080 reading beside a peak of 174 is dropped", np.isnan(out[0, 0]))
check("the stations that contradicted it are untouched",
      np.allclose(out[0, 1:], [61.0, 58.0, 174.0, 63.0]))

# 1 October 2025: one station read 819 while the median was 56 - which looks
# like a 15x fault until the next station reads 393. Two stations seeing the
# same thing is weather. This is the case a median-based rule got wrong.
out = qc.despike(hour(819.0, 393.0, 56.0, 48.0, 61.0))
check("a regional episode survives, because a second station saw it",
      out[0, 0] == 819.0 and out[0, 1] == 393.0)

# Station 3410004 read 870 while its nearest peer read 174. An absolute ceiling
# of 1000 - the first version of this filter - let it through.
out = qc.despike(hour(870.0, 174.0, 60.0, 55.0))
check("870 against a peer of 174 is dropped, which a 1000 ceiling missed",
      np.isnan(out[0, 0]))

# Below MIN_ABSOLUTE the ratio is unstable and the spike cannot move a 24-hour
# mean far enough to change a band.
out = qc.despike(hour(150.0, 2.0, 3.0, 2.5))
check("a low reading is kept however extreme its ratio", out[0, 0] == 150.0)

check("a reading exactly at MIN_ABSOLUTE is kept",
      qc.despike(hour(qc.MIN_ABSOLUTE, 1.0, 1.0))[0, 0] == qc.MIN_ABSOLUTE)
check("a reading exactly PEER_FACTOR x the second-highest is kept",
      qc.despike(hour(900.0, 300.0, 10.0))[0, 0] == 900.0)
check("just past PEER_FACTOR x the second-highest is dropped",
      np.isnan(qc.despike(hour(901.0, 300.0, 10.0))[0, 0]))

# With one station reporting there is no network to contradict it.
out = qc.despike(hour(7080.0, NAN, NAN))
check("a lone station is left alone - nothing can contradict it", out[0, 0] == 7080.0)
check("an hour with no readings does not crash", np.isnan(qc.despike(hour(NAN, NAN))).all())

# Each hour is judged against its own network, not a seasonal average.
two = np.array([[7080.0, 61.0, 58.0], [300.0, 280.0, 260.0]], dtype=np.float32)
out = qc.despike(two)
check("hours are judged independently", np.isnan(out[0, 0]) and out[1, 0] == 300.0)

src = hour(7080.0, 61.0, 58.0)
qc.despike(src)
check("despike does not mutate its input", src[0, 0] == 7080.0)
check("an empty array is returned unchanged", qc.despike(np.empty((0, 0), np.float32)).size == 0)


# ── drop_stuck: the instrument stopped moving ───────────────────────────────

def column(values: list[float]) -> np.ndarray:
    return np.array(values, dtype=np.float32).reshape(-1, 1)


# Anand Vihar, 4 September 2026: a real day, then sixteen hours of exactly 1.0.
REAL = [28.5, 55.5, 75.0, 51.0, 35.5, 34.7, 17.5, 1.7]
STUCK = [1.0] * 16
out = qc.drop_stuck(column(REAL + STUCK))
check("sixteen identical hours below the floor are dropped",
      np.isnan(out[8:, 0]).all())
check("the real readings before the fault are kept",
      np.allclose(out[:8, 0], REAL))

# What the fault did to the number the page published.
before = float(np.mean(REAL + STUCK))
after = float(np.nanmean(out[:, 0]))
check("the stuck hours were dragging the 24-hour mean down", before < 14.0)
check("removing them restores it", after > 35.0)
check("the mean moves out of the band the fault put it in",
      before <= 30.0 < after)   # CPCB PM2.5: 0-30 Good, 31-60 Satisfactory

# Both halves of the rule matter.
check("a run one short of the threshold is kept",
      not np.isnan(qc.drop_stuck(column([1.0] * (qc.STUCK_RUN - 1) + [9.0]))).any())
check("a run exactly at the threshold is dropped",
      np.isnan(qc.drop_stuck(column([1.0] * qc.STUCK_RUN + [9.0]))[: qc.STUCK_RUN, 0]).all())
check("a long steady run at a plausible level is kept",
      np.allclose(qc.drop_stuck(column([40.0] * 20))[:, 0], 40.0))
check("a run exactly at IMPLAUSIBLE_LOW is kept",
      np.allclose(qc.drop_stuck(column([qc.IMPLAUSIBLE_LOW] * 10))[:, 0], qc.IMPLAUSIBLE_LOW))

# Boundaries of the scan.
check("a stuck run that ends the series is dropped",
      np.isnan(qc.drop_stuck(column([50.0, 60.0] + [0.5] * 8))[2:, 0]).all())
check("a stuck run that starts the series is dropped",
      np.isnan(qc.drop_stuck(column([0.5] * 8 + [50.0, 60.0]))[:8, 0]).all())
check("the whole series being stuck is dropped",
      np.isnan(qc.drop_stuck(column([1.0] * 24))).all())

# A gap breaks a run: two short runs either side of it are not one long one.
broken = column([1.0, 1.0, 1.0, NAN, 1.0, 1.0, 1.0])
out = qc.drop_stuck(broken)
check("a gap breaks a run rather than joining it",
      np.allclose(out[[0, 1, 2, 4, 5, 6], 0], 1.0))

# Values that merely look similar are not a run.
check("near-identical values are not a repeat",
      not np.isnan(qc.drop_stuck(column([1.0, 1.0001, 1.0, 1.0001, 1.0, 1.0001]))).any())

# Stations are independent.
pair = np.array([[1.0, 40.0]] * 8, dtype=np.float32)
out = qc.drop_stuck(pair)
check("a stuck station does not take a healthy one with it",
      np.isnan(out[:, 0]).all() and np.allclose(out[:, 1], 40.0))

src = column([1.0] * 8)
qc.drop_stuck(src)
check("drop_stuck does not mutate its input", src[0, 0] == 1.0)
check("an empty array is returned unchanged", qc.drop_stuck(np.empty((0, 0), np.float32)).size == 0)


# ── composed, the way the forecaster applies them ───────────────────────────
# A spike the network contradicts and a flatline in the same frame. The two
# faults are independent and each pass must leave the other's work alone.
frame = np.array(
    [[7080.0, 61.0], [70.0, 1.0], [65.0, 1.0], [80.0, 1.0],
     [75.0, 1.0], [68.0, 1.0], [72.0, 1.0]],
    dtype=np.float32,
)
out = qc.drop_stuck(qc.despike(frame))
check("the spike is gone after both passes", np.isnan(out[0, 0]))
check("the flatline is gone after both passes", np.isnan(out[1:, 1]).all())
check("the healthy readings survive both passes",
      np.allclose(out[1:, 0], [70.0, 65.0, 80.0, 75.0, 68.0, 72.0]))

print("=" * 68)
print(f"{passed}/{passed + failed} passed")
raise SystemExit(1 if failed else 0)
