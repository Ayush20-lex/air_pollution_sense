"""
Observation QC - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Rejects station readings that the rest of the network contradicts.

The case that prompted this
--------------------------
Station 6359 (IHBAS, Dilshad Garden) reported 7080 ug/m3 at 17:00 on 14 May
2026. Every other station that hour had a median of 61 and a maximum of 174,
and the same sensor had read 114 two hours earlier. A 40x excursion at one site
while the city sits at 61 is an instrument fault; air does not do that.

Five such readings survive in season 2026 and they were reaching the forecast
untouched. One of them set the whole GRAP stage: the policy endpoint took the
maximum over the grid and the horizon, so a single faulty sensor decided what
the page told a reader to do.

The rule, and why it is this one
-------------------------------
A reading is dropped when it is high enough to matter and no other station in
the network saw anything close to it:

    value > MIN_ABSOLUTE   and   value > PEER_FACTOR x (that hour's second-highest)

Comparing against the second-highest station, rather than the median, is what
makes this safe. A median test sounds equivalent and is not: on 1 October 2025
one station read 819 while the median was 56, which looks like a 15x fault
until you notice the next station read 393. Two stations seeing the same thing
is weather, however far it sits above the city average, and a filter that
cannot tell a regional episode from a broken sensor is not one you can run over
Delhi. Using the second-highest keeps that reading and still removes 7080 ug/m3
at a site whose nearest peer read 174.

The second-highest is also naturally robust to the fault itself: one bad sensor
cannot inflate it, because it is by definition some other station.

Dropped values become NaN rather than being clipped to the ceiling. A clipped
7080 would still read as 1000 and still be wrong; a gap is honest and every
consumer here already handles gaps.
"""
from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger("observation_qc")

#: A reading below this is not worth judging. At low levels the ratio is
#: unstable - a peer reading 2 makes 25 look like a 12x excursion - and a spike
#: this small cannot move a 24-hour mean far enough to change an AQI band.
#:
#: An absolute ceiling alone does not work, which is what the first version of
#: this filter got wrong: set at 1000 it caught station 6359's 7080 and missed
#: station 3410004's 870, taken while the nearest peer read 174. The fault is in
#: the disagreement, not in the magnitude.
MIN_ABSOLUTE = 200.0

#: How far above its nearest peer a reading may sit before the network is taken
#: to contradict it. Three is deliberately loose - real spatial contrast across
#: NCR reaches about 4x the city average on a bad inversion night, but that
#: shows up as several stations elevated together, not as one station alone.
PEER_FACTOR = 3.0

#: A reading this low is not a measurement of urban air. NCR's cleanest
#: monsoon hours sit in the teens; single digits sustained over hours are the
#: instrument, not the atmosphere. Used only as a gate on the stuck-value test
#: below, never on its own - one genuinely clean hour is not a fault.
IMPLAUSIBLE_LOW = 5.0

#: Consecutive byte-identical hourly readings taken to mean the instrument has
#: stopped reporting and started repeating. Real PM2.5 never holds exactly the
#: same value for hours: even a flat night wanders by a few tenths. Six is
#: chosen to be past any rounding coincidence while still catching a fault
#: inside the 24-hour indexing window.
#:
#: This is the fault that motivated the test. Anand Vihar on 2026-09-04 ran
#: 28.5, 55.5, 75.0, 51.0, 35.5, 34.7, 17.5, 1.7 and then sixteen consecutive
#: hours of exactly 1.0. Read as measurements those hours pulled the 24-hour
#: mean from about 42 to 13.14, took the PM2.5 sub-index from roughly 100 to
#: 22, and published Delhi's worst-known station as "Satisfactory" with a 67%
#: improvement over the previous day. Every step downstream was arithmetically
#: correct; the input was not a measurement.
STUCK_RUN = 6



def despike(obs: np.ndarray, label: str = "pm25") -> np.ndarray:
    """Return `obs` with network-contradicted readings set to NaN.

    `obs` is (n_times, n_stations). The comparison is against the second-highest
    station in the same hour, so a fault is judged against what the rest of the
    network saw at that moment rather than against a seasonal average.
    """
    if obs.size == 0:
        return obs

    out = np.asarray(obs, dtype=np.float32).copy()
    with np.errstate(invalid="ignore"):
        # Second-highest station per hour. An hour with fewer than two valid
        # readings yields NaN, and every comparison against NaN is False, so
        # such an hour is left alone rather than emptied - with one station
        # reporting there is no network to contradict it.
        ordered = np.sort(out, axis=1)          # NaNs sort to the end
        valid = np.isfinite(out).sum(axis=1)
        rows = np.arange(out.shape[0])
        second = np.full(out.shape[0], np.nan, dtype=np.float32)
        has_two = valid >= 2
        second[has_two] = ordered[rows[has_two], valid[has_two] - 2]
        suspect = (out > MIN_ABSOLUTE) & (out > PEER_FACTOR * second[:, None])

    n = int(np.count_nonzero(suspect))
    if n:
        worst = float(np.nanmax(out[suspect]))
        out[suspect] = np.nan
        logger.warning(
            "%s: dropped %d reading(s) contradicted by the network (max %.0f ug/m3)",
            label, n, worst,
        )
    return out


def drop_stuck(obs: np.ndarray, label: str = "pm25") -> np.ndarray:
    """Return `obs` with flatlined runs set to NaN.

    A run is flagged when a station repeats one value for `STUCK_RUN`
    consecutive hours and that value is below `IMPLAUSIBLE_LOW`. Both halves
    matter: the repetition identifies the instrument as stuck, and the
    magnitude gate keeps the test off a genuinely steady reading at a level the
    atmosphere can actually produce.

    Unlike `despike` this cannot consult the network, because a stuck sensor
    fails alone and silently - there is no contradiction to find, only a value
    that never moves.
    """
    if obs.size == 0:
        return obs

    out = np.asarray(obs, dtype=np.float32).copy()
    n_times, n_stations = out.shape
    dropped = 0

    for col in range(n_stations):
        series = out[:, col]
        run_start = 0
        for i in range(1, n_times + 1):
            same = (
                i < n_times
                and np.isfinite(series[i])
                and np.isfinite(series[i - 1])
                and series[i] == series[i - 1]
            )
            if same:
                continue
            run_len = i - run_start
            value = series[run_start]
            if (
                run_len >= STUCK_RUN
                and np.isfinite(value)
                and value < IMPLAUSIBLE_LOW
            ):
                series[run_start:i] = np.nan
                dropped += run_len
            run_start = i

    if dropped:
        logger.warning(
            "%s: dropped %d reading(s) from stuck sensors (runs of >=%d identical values below %.0f ug/m3)",
            label, dropped, STUCK_RUN, IMPLAUSIBLE_LOW,
        )
    return out
