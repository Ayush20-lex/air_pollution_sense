"""
Module: CPCB National Air Quality Index
SIH26082 · MoES / NCMRWF

Implements the full Indian National AQI (CPCB, 2014) rather than the PM2.5-only
conversion in grap_policy.py:

  * eight pollutant sub-indices, each with its own breakpoint table
  * two averaging windows — 24-hourly for PM2.5, PM10, NO2, SO2, NH3 and Pb;
    maximum 8-hourly rolling mean for CO and O3
  * AQI = max(sub-indices), and the pollutant that set it (CPCB publishes this
    alongside the number as the "prominent pollutant")
  * the validity rules: at least three pollutants, of which PM2.5 or PM10 must
    be one, and at least 16 hourly values before a 24-hourly sub-index counts

Nothing here replaces grap_policy.calculate_indian_aqi_pm25 — that function is
still the PM2.5 path used by the GRAP engine. This module is additive.

Units
-----
The breakpoint tables are in µg/m³, except CO which CPCB tabulates in mg/m³.
Station feeds are not consistent: the OpenAQ mirror of the CPCB network reports
NO2 in both ppb and µg/m³ and O3 in both ppm and µg/m³ depending on the sensor.
Feeding ppb into a µg/m³ table understates NO2 by ~1.9x and O3 by ~1960x, so
`to_cpcb_units` is not optional — call it, or pass values already converted.

Reference: CPCB, "National Air Quality Index" (2014), Table 2 (breakpoints) and
the accompanying computation rules. Verify the tables against that document
before any published result depends on them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Literal, Sequence

Pollutant = Literal['pm25', 'pm10', 'no2', 'so2', 'nh3', 'pb', 'co', 'o3']

ALL_POLLUTANTS: tuple[Pollutant, ...] = ('pm25', 'pm10', 'no2', 'so2', 'nh3', 'pb', 'co', 'o3')

#: Sub-index requires PM2.5 or PM10 to be present — CPCB will not publish an AQI
#: from gaseous pollutants alone.
MANDATORY_ANY_OF: tuple[Pollutant, ...] = ('pm25', 'pm10')

#: Minimum distinct pollutants before an AQI may be reported.
MIN_POLLUTANTS = 3

#: Averaging window per pollutant, in hours.
AVERAGING_HOURS: dict[Pollutant, int] = {
    'pm25': 24, 'pm10': 24, 'no2': 24, 'so2': 24, 'nh3': 24, 'pb': 24,
    'co': 8, 'o3': 8,
}

#: Minimum valid hourly samples before a window average is trusted.
#: CPCB states 16 of 24 for the daily pollutants. It does not state a figure for
#: the 8-hourly ones in the same table, so 6 of 8 is applied here as the same
#: two-thirds proportion — adjust if your reference says otherwise.
MIN_VALID_HOURS: dict[int, int] = {24: 16, 8: 6}

#: (concentration_low, concentration_high, index_low, index_high).
#: Bands are contiguous — CPCB prints them as 0-30 / 31-60, which as literal
#: numeric bounds leaves 30.0-31.0 unmapped. grap_policy.py has that gap and
#: returns 0 for a PM2.5 of 30.5; these bounds touch so no value falls through.
BREAKPOINTS: dict[Pollutant, list[tuple[float, float, int, int]]] = {
    # µg/m³, 24-hourly
    'pm25': [(0, 30, 0, 50), (30, 60, 51, 100), (60, 90, 101, 200),
             (90, 120, 201, 300), (120, 250, 301, 400), (250, 500, 401, 500)],
    'pm10': [(0, 50, 0, 50), (50, 100, 51, 100), (100, 250, 101, 200),
             (250, 350, 201, 300), (350, 430, 301, 400), (430, 600, 401, 500)],
    'no2':  [(0, 40, 0, 50), (40, 80, 51, 100), (80, 180, 101, 200),
             (180, 280, 201, 300), (280, 400, 301, 400), (400, 1000, 401, 500)],
    'so2':  [(0, 40, 0, 50), (40, 80, 51, 100), (80, 380, 101, 200),
             (380, 800, 201, 300), (800, 1600, 301, 400), (1600, 2400, 401, 500)],
    'nh3':  [(0, 200, 0, 50), (200, 400, 51, 100), (400, 800, 101, 200),
             (800, 1200, 201, 300), (1200, 1800, 301, 400), (1800, 2400, 401, 500)],
    'pb':   [(0, 0.5, 0, 50), (0.5, 1.0, 51, 100), (1.0, 2.0, 101, 200),
             (2.0, 3.0, 201, 300), (3.0, 3.5, 301, 400), (3.5, 5.0, 401, 500)],
    # µg/m³, maximum 8-hourly
    'o3':   [(0, 50, 0, 50), (50, 100, 51, 100), (100, 168, 101, 200),
             (168, 208, 201, 300), (208, 748, 301, 400), (748, 1000, 401, 500)],
    # mg/m³, maximum 8-hourly — note the unit differs from every other row
    'co':   [(0, 1.0, 0, 50), (1.0, 2.0, 51, 100), (2.0, 10, 101, 200),
             (10, 17, 201, 300), (17, 34, 301, 400), (34, 50, 401, 500)],
}

#: (upper_bound_inclusive, label). CPCB's six bands.
CATEGORIES: list[tuple[int, str]] = [
    (50, 'Good'), (100, 'Satisfactory'), (200, 'Moderate'),
    (300, 'Poor'), (400, 'Very Poor'), (500, 'Severe'),
]

DISPLAY_NAME: dict[Pollutant, str] = {
    'pm25': 'PM2.5', 'pm10': 'PM10', 'no2': 'NO2', 'so2': 'SO2',
    'nh3': 'NH3', 'pb': 'Pb', 'co': 'CO', 'o3': 'O3',
}

# ── unit handling ─────────────────────────────────────────────────────────────

#: Molecular weights (g/mol) for the gaseous species, used for ppb -> µg/m³.
_MOLECULAR_WEIGHT: dict[Pollutant, float] = {
    'no2': 46.0055, 'so2': 64.066, 'o3': 47.997, 'co': 28.010, 'nh3': 17.031,
}

#: Molar volume of an ideal gas at 25 °C and 760 mm Hg, in L/mol — the reference
#: state CPCB uses for its conversions.
_MOLAR_VOLUME_L = 24.45


#: Matched on structure rather than an exact string. The live feed sends
#: 'µg/m³' with U+00B5 and U+00B3, but 'ug/m3', 'ug/m^3' and spaced variants all
#: appear across providers; only the prefix decides the scale, so that is all
#: these look at. U+03BC (Greek mu) is included because some feeds use it in
#: place of the micro sign.
_MICRO_PREFIX = re.compile(r'^[uµμ]\s*g\s*/\s*m')
_MILLI_PREFIX = re.compile(r'^m\s*g\s*/\s*m')


def to_cpcb_units(pollutant: Pollutant, value: float, unit: str) -> float:
    """Convert a concentration into the unit its breakpoint table expects.

    Target is µg/m³ for everything except CO, which CPCB tabulates in mg/m³.
    Accepts µg/m³, mg/m³, ppb and ppm in any casing or spacing.
    """
    u = unit.strip().lower()
    is_co = pollutant == 'co'

    if 'ppb' in u or 'ppm' in u:
        mw = _MOLECULAR_WEIGHT.get(pollutant)
        if mw is None:
            raise ValueError(f'{pollutant} is particulate; it has no ppb/ppm form')
        ppb = value * 1000.0 if 'ppm' in u else value
        ugm3 = ppb * mw / _MOLAR_VOLUME_L
        return ugm3 / 1000.0 if is_co else ugm3

    if _MILLI_PREFIX.match(u):
        return value if is_co else value * 1000.0

    if _MICRO_PREFIX.match(u):
        return value / 1000.0 if is_co else value

    raise ValueError(f'unrecognised unit {unit!r} for {pollutant}')


# ── sub-index ─────────────────────────────────────────────────────────────────

def sub_index(pollutant: Pollutant, concentration: float) -> int | None:
    """Piecewise-linear sub-index for one pollutant at its window average.

    Concentration must already be in the pollutant's CPCB unit (see
    `to_cpcb_units`). Returns None for a negative or missing reading; caps at
    500, which is where the published scale ends.
    """
    if concentration is None or concentration < 0:
        return None

    table = BREAKPOINTS[pollutant]
    for c_lo, c_hi, i_lo, i_hi in table:
        if c_lo <= concentration <= c_hi:
            index = (i_hi - i_lo) / (c_hi - c_lo) * (concentration - c_lo) + i_lo
            return int(round(index))

    # Above the tabulated maximum. CPCB's scale stops at 500; report the cap
    # rather than extrapolating an unpublished number.
    return 500


def category_for(aqi: int) -> str:
    for upper, label in CATEGORIES:
        if aqi <= upper:
            return label
    return CATEGORIES[-1][1]


# ── window averaging ──────────────────────────────────────────────────────────

def window_average(
    pollutant: Pollutant,
    hourly: Sequence[float | None],
) -> tuple[float | None, int]:
    """Reduce an hourly series to the value its sub-index is computed from.

    24-hourly pollutants take the plain mean of the valid samples. CO and O3
    take the *maximum* 8-hourly rolling mean across the series, which is what
    CPCB specifies — the daily mean would understate an afternoon ozone peak.

    Returns (value, n_valid). `value` is None when there are too few valid
    samples for the window; `n_valid` is still returned so a caller can report
    exactly why the pollutant was dropped.
    """
    window = AVERAGING_HOURS[pollutant]
    need = MIN_VALID_HOURS[window]
    valid = [v for v in hourly if v is not None]
    n_valid = len(valid)

    if n_valid < need:
        return None, n_valid

    if window == 24:
        return sum(valid) / n_valid, n_valid

    # 8-hourly: slide an 8-wide window over the series in original order,
    # keeping windows that themselves hold enough valid samples.
    best: float | None = None
    for start in range(0, max(1, len(hourly) - window + 1)):
        chunk = [v for v in hourly[start:start + window] if v is not None]
        if len(chunk) < need:
            continue
        mean = sum(chunk) / len(chunk)
        if best is None or mean > best:
            best = mean
    return best, n_valid


# ── result ────────────────────────────────────────────────────────────────────

@dataclass
class SubIndex:
    pollutant: Pollutant
    value: int
    concentration: float
    window_hours: int
    n_valid_hours: int


@dataclass
class AqiResult:
    """Outcome of one AQI computation.

    `valid` False means CPCB's rules forbid publishing a number for this input;
    `aqi` is then None and `reasons` says what was missing. Callers should
    surface the reason rather than substituting a zero.
    """
    valid: bool
    aqi: int | None = None
    category: str | None = None
    prominent: Pollutant | None = None
    sub_indices: dict[str, SubIndex] = field(default_factory=dict)
    dropped: dict[str, str] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            'valid': self.valid,
            'aqi': self.aqi,
            'category': self.category,
            'prominent_pollutant': DISPLAY_NAME[self.prominent] if self.prominent else None,
            'sub_indices': {
                DISPLAY_NAME[p]: {
                    'sub_index': s.value,
                    'concentration': round(s.concentration, 3),
                    'window_hours': s.window_hours,
                    'valid_hours': s.n_valid_hours,
                }
                for p, s in self.sub_indices.items()
            },
            'dropped': {DISPLAY_NAME[p]: why for p, why in self.dropped.items()},
            'reasons': self.reasons,
        }


def compute_aqi(series: dict[str, Sequence[float | None]]) -> AqiResult:
    """Compute the National AQI from hourly series, one per pollutant.

    `series` maps a pollutant key ('pm25', 'co', ...) to its hourly readings for
    the period, already in CPCB units. Missing hours should be present as None
    rather than omitted, so the validity count reflects real coverage.

    The AQI is the worst sub-index, and the pollutant responsible is reported
    with it. A pollutant with too few hours is dropped and recorded in
    `dropped`; it does not count toward the three-pollutant minimum.
    """
    result = AqiResult(valid=False)

    for key, hourly in series.items():
        if key not in BREAKPOINTS:
            result.dropped[key] = 'not a CPCB AQI pollutant'
            continue
        pollutant: Pollutant = key  # type: ignore[assignment]

        window = AVERAGING_HOURS[pollutant]
        value, n_valid = window_average(pollutant, hourly)
        if value is None:
            result.dropped[pollutant] = (
                f'{n_valid} valid hours, needs {MIN_VALID_HOURS[window]} for a '
                f'{window}-hourly average'
            )
            continue

        idx = sub_index(pollutant, value)
        if idx is None:
            result.dropped[pollutant] = 'no sub-index for that concentration'
            continue

        result.sub_indices[pollutant] = SubIndex(
            pollutant=pollutant, value=idx, concentration=value,
            window_hours=window, n_valid_hours=n_valid,
        )

    present = set(result.sub_indices)

    if len(present) < MIN_POLLUTANTS:
        result.reasons.append(
            f'{len(present)} usable pollutant(s); CPCB requires {MIN_POLLUTANTS}'
        )
    if not present & set(MANDATORY_ANY_OF):
        result.reasons.append('neither PM2.5 nor PM10 is available')

    if result.reasons:
        return result

    worst = max(result.sub_indices.values(), key=lambda s: s.value)
    result.valid = True
    result.aqi = worst.value
    result.category = category_for(worst.value)
    result.prominent = worst.pollutant
    return result


def compute_aqi_from_readings(
    readings: Iterable[tuple[str, float | None, str]],
) -> AqiResult:
    """Convenience wrapper for feeds that carry their own units.

    Takes (pollutant, value, unit) triples — the shape the OpenAQ/CPCB mirror
    returns — converts each into its CPCB unit and groups them into series.
    """
    grouped: dict[str, list[float | None]] = {}
    for pollutant, value, unit in readings:
        if pollutant not in BREAKPOINTS:
            continue
        if value is None:
            grouped.setdefault(pollutant, []).append(None)
            continue
        grouped.setdefault(pollutant, []).append(
            to_cpcb_units(pollutant, value, unit)  # type: ignore[arg-type]
        )
    return compute_aqi(grouped)
