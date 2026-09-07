"""
CPCB National AQI correctness tests - Air Pollution Sense
SIH26082 - verifies aqi_cpcb.py against the published breakpoint tables

Run: cd backend && python test_aqi_cpcb.py
"""
from __future__ import annotations
import os
import sys

_BACKEND = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND)

from aqi_cpcb import (  # noqa: E402
    BREAKPOINTS,
    category_for,
    compute_aqi,
    compute_aqi_from_readings,
    sub_index,
    to_cpcb_units,
    window_average,
)

PASS = 'PASS'
FAIL = 'FAIL'

_results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    _results.append((name, bool(condition), detail))


def close(a, b, tol=0.51) -> bool:
    return a is not None and b is not None and abs(a - b) <= tol


# ── breakpoint anchors ────────────────────────────────────────────────────────
# At a band edge the sub-index must equal that band's published index bound.

for pollutant, table in BREAKPOINTS.items():
    ok = True
    detail = ''
    for c_lo, c_hi, i_lo, i_hi in table:
        lo, hi = sub_index(pollutant, c_lo), sub_index(pollutant, c_hi)
        if not close(hi, i_hi):
            ok, detail = False, f'{pollutant} at {c_hi} -> {hi}, expected {i_hi}'
            break
        # The lower edge is shared with the previous band's upper edge, so it may
        # legitimately read as either bound.
        if lo is None or not (min(i_lo, i_hi) - 1 <= lo <= i_hi + 1):
            ok, detail = False, f'{pollutant} at {c_lo} -> {lo}, expected ~{i_lo}'
            break
    check(f'breakpoints/{pollutant} anchors land on published bounds', ok, detail)

# Known-value spot checks from the CPCB scale.
check('PM2.5 60 ug/m3 -> 100 (Satisfactory ceiling)',
      sub_index('pm25', 60) == 100, f"got {sub_index('pm25', 60)}")
check('PM2.5 90 ug/m3 -> 200 (Moderate ceiling)',
      sub_index('pm25', 90) == 200, f"got {sub_index('pm25', 90)}")
check('PM10 100 ug/m3 -> 100',
      sub_index('pm10', 100) == 100, f"got {sub_index('pm10', 100)}")
check('CO 2 mg/m3 -> 100',
      sub_index('co', 2.0) == 100, f"got {sub_index('co', 2.0)}")
check('O3 168 ug/m3 -> 200',
      sub_index('o3', 168) == 200, f"got {sub_index('o3', 168)}")

# ── the gap that grap_policy.py has ───────────────────────────────────────────
# Its bands are (0, 30.0) then (30.1, 60.0), so 30.05 matches nothing and the
# function returns 0. Contiguous bands must not do that.
mid = sub_index('pm25', 30.05)
check('PM2.5 30.05 does not fall through the bands',
      mid is not None and 49 <= mid <= 52, f'got {mid}')

# Above the tabulated maximum the scale caps rather than extrapolating.
check('PM2.5 900 ug/m3 caps at 500', sub_index('pm25', 900) == 500,
      f"got {sub_index('pm25', 900)}")
check('negative concentration yields no sub-index', sub_index('pm25', -5) is None)

# ── categories ────────────────────────────────────────────────────────────────
for aqi, expected in [(0, 'Good'), (50, 'Good'), (51, 'Satisfactory'),
                      (200, 'Moderate'), (250, 'Poor'), (350, 'Very Poor'),
                      (500, 'Severe')]:
    check(f'category({aqi}) == {expected}', category_for(aqi) == expected,
          f'got {category_for(aqi)}')

# ── unit conversion ───────────────────────────────────────────────────────────
# The catalogue carries NO2 in ppb and ug/m3, and O3 in ppm and ug/m3, so these
# conversions decide whether a station is read correctly or off by ~1.9x/1960x.
check('NO2 1 ppb -> ~1.88 ug/m3', close(to_cpcb_units('no2', 1, 'ppb'), 1.88, 0.02),
      f"got {to_cpcb_units('no2', 1, 'ppb'):.3f}")
check('O3 1 ppm -> ~1963 ug/m3', close(to_cpcb_units('o3', 1, 'ppm'), 1963, 5),
      f"got {to_cpcb_units('o3', 1, 'ppm'):.1f}")
check('CO 1 ppm -> ~1.145 mg/m3', close(to_cpcb_units('co', 1, 'ppm'), 1.145, 0.01),
      f"got {to_cpcb_units('co', 1, 'ppm'):.4f}")
check('CO 1000 ug/m3 -> 1.0 mg/m3', close(to_cpcb_units('co', 1000, 'ug/m3'), 1.0, 1e-6))
check('PM2.5 ug/m3 passes through', close(to_cpcb_units('pm25', 42, 'ug/m3'), 42, 1e-6))

# The exact strings the station catalogue stores: U+00B5 MICRO SIGN and
# U+00B3 SUPERSCRIPT THREE. Built from codepoints so the assertion cannot be
# weakened by this file's own encoding.
_UGM3 = 'µg/m³'
check('catalogue unit string (U+00B5 g/m U+00B3) is understood',
      close(to_cpcb_units('pm25', 42, _UGM3), 42, 1e-6))
check('Greek mu variant is understood',
      close(to_cpcb_units('pm25', 42, 'μg/m³'), 42, 1e-6))
check('spaced and upper-case units are understood',
      close(to_cpcb_units('pm10', 42, ' UG / M3 '), 42, 1e-6))

try:
    to_cpcb_units('pm25', 1, 'ppb')
    check('particulate in ppb is rejected', False, 'no error raised')
except ValueError:
    check('particulate in ppb is rejected', True)

# ── averaging windows ─────────────────────────────────────────────────────────
check('24h mean of 24 equal samples', close(window_average('pm25', [100.0] * 24)[0], 100.0))
check('24h needs 16 valid hours - 15 is rejected',
      window_average('pm25', [100.0] * 15 + [None] * 9)[0] is None)
check('24h accepts exactly 16 valid hours',
      window_average('pm25', [100.0] * 16 + [None] * 8)[0] is not None)

# O3 takes the max 8-hourly mean, not the daily mean: a sharp afternoon peak
# must survive averaging or the sub-index understates the exposure.
o3_day = [20.0] * 16 + [200.0] * 8
mean_of_day = sum(o3_day) / len(o3_day)
o3_val, _ = window_average('o3', o3_day)
check('O3 uses max 8-hourly, not the daily mean',
      close(o3_val, 200.0, 1.0) and o3_val > mean_of_day,
      f'got {o3_val:.1f}, daily mean is {mean_of_day:.1f}')

# ── validity rules ────────────────────────────────────────────────────────────
full = {'pm25': [100.0] * 24, 'pm10': [180.0] * 24, 'no2': [50.0] * 24}
r = compute_aqi(full)
check('three pollutants incl. PM2.5 is valid', r.valid, str(r.reasons))
check('AQI is the worst sub-index',
      r.aqi == max(s.value for s in r.sub_indices.values()), f'aqi={r.aqi}')
check('prominent pollutant is the one that set it',
      r.prominent is not None
      and r.sub_indices[r.prominent].value == r.aqi, f'prominent={r.prominent}')

two = compute_aqi({'pm25': [100.0] * 24, 'no2': [50.0] * 24})
check('two pollutants is refused', not two.valid and two.aqi is None, str(two.reasons))

gases = compute_aqi({'no2': [50.0] * 24, 'so2': [30.0] * 24, 'o3': [80.0] * 24})
check('gases only, no PM, is refused', not gases.valid, str(gases.reasons))
check('refusal explains the missing PM',
      any('PM2.5 nor PM10' in x for x in gases.reasons), str(gases.reasons))

short = compute_aqi({
    'pm25': [100.0] * 10 + [None] * 14,   # only 10 valid hours
    'pm10': [180.0] * 24,
    'no2': [50.0] * 24,
})
check('pollutant under 16 hours is dropped', 'pm25' in short.dropped, str(short.dropped))
check('dropped pollutant does not set the AQI', 'pm25' not in short.sub_indices)
check('remaining two pollutants then fail the minimum', not short.valid, str(short.reasons))

check('invalid result carries no AQI number',
      two.aqi is None and two.category is None)

# ── end-to-end with mixed units ───────────────────────────────────────────────
readings: list[tuple[str, float | None, str]] = []
readings += [('pm25', 100.0, 'ug/m3')] * 24
readings += [('pm10', 180.0, 'ug/m3')] * 24
readings += [('no2', 40.0, 'ppb')] * 24          # ~75 ug/m3 once converted
mixed = compute_aqi_from_readings(readings)
check('mixed-unit feed produces a valid AQI', mixed.valid, str(mixed.reasons))
no2_conc = mixed.sub_indices['no2'].concentration if 'no2' in mixed.sub_indices else None
check('NO2 ppb was converted before indexing', close(no2_conc, 75.2, 1.0),
      f'got {no2_conc}')
check('as_dict is serialisable and names the prominent pollutant',
      isinstance(mixed.as_dict()['prominent_pollutant'], str))

# ── report ────────────────────────────────────────────────────────────────────
print('\nCPCB National AQI - aqi_cpcb.py')
print('=' * 68)
failed = 0
for name, ok, detail in _results:
    tag = PASS if ok else FAIL
    if not ok:
        failed += 1
    line = f'[{tag}] {name}'
    if detail and not ok:
        line += f'  ->  {detail}'
    print(line)
print('=' * 68)
print(f'{len(_results) - failed}/{len(_results)} passed')
sys.exit(1 if failed else 0)
