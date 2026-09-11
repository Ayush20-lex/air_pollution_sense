"""
Gridded dataset verification - Air Pollution Sense
SIH26082 - checks that gridded_dataset.npy encodes the atmosphere and not just
the right shape. A tensor can pass a shape assertion and still be useless.

Run: python ml_pipeline/scripts/test_gridded_dataset.py
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from channel_spec import (  # noqa: E402
    CHANNEL_NAMES,
    CH_PBL,
    CH_PM25,
    CH_U,
    CH_V,
    denormalise,
)

PASS, FAIL = 'PASS', 'FAIL'
_results: list[tuple[str, bool, str]] = []
_notes: list[str] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    _results.append((name, bool(condition), detail))


PROC = REPO_ROOT / 'ml_pipeline' / 'data' / 'processed'
arr = np.load(PROC / 'gridded_dataset.npy')
manifest = json.loads((PROC / 'gridded_dataset_manifest.json').read_text('utf-8'))
times = pd.to_datetime(manifest['times'], utc=True)

# ── shape and range ───────────────────────────────────────────────────────────

check('shape matches the manifest', list(arr.shape) == manifest['shape'], str(arr.shape))
check('stored as float16', arr.dtype == np.float16, str(arr.dtype))
check('time axis matches the index', len(times) == arr.shape[0])
check('no NaN or infinity', bool(np.isfinite(arr).all()))
check('every value inside the sigmoid range',
      float(arr.min()) >= 0.0 and float(arr.max()) <= 1.0,
      f'[{float(arr.min()):.3f}, {float(arr.max()):.3f}]')

phys = denormalise(arr.astype(np.float32))

# ── the bug this normalisation exists to fix ──────────────────────────────────
# Signed wind must survive the round trip. Under the legacy scale-only vector
# every negative component would have been unrepresentable.

u, v = phys[:, CH_U], phys[:, CH_V]
check('u keeps both signs', bool((u < 0).any() and (u > 0).any()),
      f'{float((u < 0).mean()) * 100:.0f}% negative')
check('v keeps both signs', bool((v < 0).any() and (v > 0).any()),
      f'{float((v < 0).mean()) * 100:.0f}% negative')

speed = np.sqrt(u ** 2 + v ** 2)
# Delhi's 10 m winter wind averages under 3 m/s. A mean near 6 means the
# km/h-read-as-m/s mistake has come back.
check('wind speed is physically plausible for Delhi',
      0.5 < float(speed.mean()) < 4.0, f'mean {float(speed.mean()):.2f} m/s')
_notes.append(f'wind: mean {float(speed.mean()):.2f} m/s, max {float(speed.max()):.1f}, '
              f'v negative {float((v < 0).mean()) * 100:.0f}% of the time')

# ── concentrations land where Delhi actually sits ─────────────────────────────

pm25 = phys[:, CH_PM25]
med = float(np.median(pm25))
check('PM2.5 median is in Delhi winter range', 80.0 < med < 300.0, f'{med:.1f} ug/m3')
check('PM2.5 reaches severe levels', float(pm25.max()) > 400.0, f'max {float(pm25.max()):.0f}')
check('PM2.5 is never negative', float(pm25.min()) >= 0.0, f'min {float(pm25.min()):.1f}')
_notes.append(f'PM2.5: median {med:.0f}, p99 {float(np.percentile(pm25, 99)):.0f}, '
              f'max {float(pm25.max()):.0f} ug/m3')

# ── the time axis is not scrambled ────────────────────────────────────────────
# Delhi PM2.5 has a hard diurnal signature: the nocturnal inversion traps it
# overnight and the afternoon mixed layer flushes it. If the hours were shuffled
# this collapses to noise, so it is the cheapest possible proof of ordering.

ist_hour = (times.hour + times.minute / 60 + 5.5) % 24
field_mean = pm25.reshape(len(times), -1).mean(axis=1)
climatology = np.array([field_mean[np.floor(ist_hour) == h].mean() for h in range(24)])
trough = int(np.argmin(climatology))
check('PM2.5 troughs in the afternoon, when the mixed layer is deepest',
      13 <= trough <= 18, f'minimum at {trough:02d}:00 IST')
check('the diurnal cycle has real amplitude',
      (climatology.max() - climatology.min()) > 15.0,
      f'{climatology.max() - climatology.min():.0f} ug/m3 peak-to-trough')
_notes.append(f'PM2.5 diurnal: trough {trough:02d}:00 IST ({climatology.min():.0f}), '
              f'peak {int(np.argmax(climatology)):02d}:00 IST ({climatology.max():.0f})')

# ── the grid carries spatial structure ────────────────────────────────────────
# IDW over 68 stations must not collapse to a flat field.

spatial_sd = pm25.reshape(len(times), -1).std(axis=1)
check('PM2.5 varies across the grid', float(spatial_sd.mean()) > 1.0,
      f'mean spatial sd {float(spatial_sd.mean()):.1f} ug/m3')

# ── blocks ────────────────────────────────────────────────────────────────────

blocks = manifest['blocks']
check('two blocks recorded', len(blocks) == 2, str(len(blocks)))
check('blocks tile the time axis without overlap',
      blocks[0]['start_index'] == 0
      and blocks[0]['end_index'] == blocks[1]['start_index']
      and blocks[1]['end_index'] == arr.shape[0])

for b in blocks:
    seg = times[b['start_index']:b['end_index']]
    check(f'block {b["season"]} holds only its own season',
          bool((seg.year == b['season']).all()),
          str(sorted(set(seg.year))))
    check(f'block {b["season"]} is contiguous hourly',
          bool((seg.to_series().diff().dropna() == pd.Timedelta('1h')).all()))

seam = blocks[1]['start_index']
gap_years = (times[seam] - times[seam - 1]).days / 365.25
check('the seam between blocks is a real discontinuity', gap_years > 2.5,
      f'{gap_years:.1f} years')
_notes.append(f'seam at index {seam}: {times[seam - 1].date()} -> {times[seam].date()}')

# A sampler that ignores blocks would emit windows spanning that gap.
CONTEXT, HORIZON = 6, 72
span = CONTEXT + HORIZON
naive = arr.shape[0] - span
legal = sum(max(0, (b['end_index'] - b['start_index']) - span) for b in blocks)
check('block-aware sampling drops the windows that straddle the seam',
      legal < naive, f'{legal} legal vs {naive} naive')
_notes.append(f'training windows (context {CONTEXT} + horizon {HORIZON}): '
              f'{legal} legal, {naive - legal} rejected at the seam')

# ── declared-absent channels really are absent ────────────────────────────────

for b in blocks:
    for name, prov in b['channels'].items():
        ch = CHANNEL_NAMES.index(name)
        seg = arr[b['start_index']:b['end_index'], ch]
        if prov['source'] == 'absent':
            check(f'block {b["season"]}: {name} declared absent and is zero',
                  float(np.abs(seg).max()) == 0.0, f'max {float(np.abs(seg).max())}')
        else:
            check(f'block {b["season"]}: {name} declared real and carries signal',
                  float(seg.astype(np.float32).std()) > 0.0)

check('2022 PBL is absent, as the forecast archive has no column for it',
      float(np.abs(arr[:blocks[1]['start_index'], CH_PBL]).max()) == 0.0)
check('2025 PBL is present', float(arr[blocks[1]['start_index']:, CH_PBL].max()) > 0.0)

# ── round trip ────────────────────────────────────────────────────────────────

rt = denormalise(arr.astype(np.float32))
check('denormalise is the inverse of the stored values',
      float(np.abs(rt - phys).max()) < 1e-3, f'{float(np.abs(rt - phys).max()):.2e}')

_notes.append(f'file {arr.nbytes / 2**20:.0f} MiB, {arr.shape[0]} hours, '
              f'{sum(b["stations"] for b in blocks)} station-seasons')

# ── report ────────────────────────────────────────────────────────────────────
print('\nGridded dataset - ml_pipeline/data/processed/gridded_dataset.npy')
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
print('-' * 68)
for note in _notes:
    print(f'      {note}')
print('=' * 68)
print(f'{len(_results) - failed}/{len(_results)} passed')
sys.exit(1 if failed else 0)
