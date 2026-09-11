"""
Training harness tests - Air Pollution Sense
SIH26082 - the sampler decides what the model is shown. A leak here does not
crash anything; it produces a validation score that looks good and means
nothing, which is worse.

Run: python ml_pipeline/scripts/test_training_harness.py
"""
from __future__ import annotations
import gc
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

# The trainer's filename starts with a digit, so it cannot be imported by name.
_spec = importlib.util.spec_from_file_location(
    'train_coupled', Path(__file__).with_name('16_train_coupled.py'))
train = importlib.util.module_from_spec(_spec)
# @dataclass resolves annotations through sys.modules, so register before exec.
sys.modules['train_coupled'] = train
_spec.loader.exec_module(train)

from channel_spec import CH_PM25, CHANNEL_SCALE, N_CHANNELS  # noqa: E402

PASS, FAIL = 'PASS', 'FAIL'
_results: list[tuple[str, bool, str]] = []
_notes: list[str] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    _results.append((name, bool(condition), detail))


BLOCKS = [
    {'season': 2022, 'start_index': 0, 'end_index': 744},
    {'season': 2025, 'start_index': 744, 'end_index': 2952},
]
CONTEXT, HORIZON = 24, 72
SPAN = CONTEXT + HORIZON

# ── windows stay inside one block ─────────────────────────────────────────────

starts = train.legal_windows(BLOCKS, CONTEXT, HORIZON, stride=1)
check('some windows are produced', len(starts) > 0, str(len(starts)))

straddles = 0
outside = 0
for s in starts:
    home = [b for b in BLOCKS if b['start_index'] <= s < b['end_index']]
    if not home:
        outside += 1
        continue
    if s + SPAN > home[0]['end_index']:
        straddles += 1
check('no window crosses a block boundary', straddles == 0, f'{straddles} straddle')
check('every window starts inside a block', outside == 0, f'{outside} outside')

expected = sum(max(0, (b['end_index'] - b['start_index']) - SPAN + 1) for b in BLOCKS)
check('window count matches the blocks', len(starts) == expected,
      f'{len(starts)} vs {expected}')
_notes.append(f'stride 1 over both blocks: {len(starts)} windows '
              f'(context {CONTEXT} + horizon {HORIZON})')

# A stride must thin the set, never change where it may start.
strided = train.legal_windows(BLOCKS, CONTEXT, HORIZON, stride=3)
check('stride subsets the stride-1 windows', set(strided.tolist()) <= set(starts.tolist()))
check('stride 3 yields roughly a third', abs(len(strided) - len(starts) / 3) < 5,
      f'{len(strided)} vs ~{len(starts) / 3:.0f}')

# ── the split does not leak ───────────────────────────────────────────────────
# Two windows share information if their hour ranges intersect at all.

tr, va = train.temporal_split(strided, val_fraction=0.15, span=SPAN)
check('both splits are non-empty', len(tr) > 0 and len(va) > 0, f'{len(tr)}/{len(va)}')
check('validation is the later period', int(va.min()) > int(tr.max()),
      f'train max {int(tr.max())}, val min {int(va.min())}')

train_hours = set()
for s in tr:
    train_hours.update(range(int(s), int(s) + SPAN))
val_hours = set()
for s in va:
    val_hours.update(range(int(s), int(s) + SPAN))
overlap = train_hours & val_hours
check('training and validation share no hour', len(overlap) == 0,
      f'{len(overlap)} hours shared')
_notes.append(f'split: {len(tr)} train / {len(va)} val windows, '
              f'{len(overlap)} shared hours')

# The separation must be a real gap, not a coincidence of rounding.
check('a full window separates the two sets',
      int(va.min()) - int(tr.max()) >= SPAN,
      f'gap {int(va.min()) - int(tr.max())} vs span {SPAN}')

# Asking for no validation must hand back everything rather than silently split.
all_tr, no_va = train.temporal_split(strided, val_fraction=0.0, span=SPAN)
check('val_fraction 0 keeps every window for training',
      len(all_tr) == len(strided) and len(no_va) == 0)

# ── the dataset hands back what the window promises ───────────────────────────

fake = np.arange(300 * N_CHANNELS * 4 * 5, dtype=np.float32)
fake = (fake / fake.max()).reshape(300, N_CHANNELS, 4, 5)
tmpdir = Path(tempfile.mkdtemp(prefix='harness_'))
tmp = tmpdir / 'window_source.npy'
np.save(tmp, fake.astype(np.float16))

try:
    ws = train.WindowSet(np.array([0, 100]), context=6, horizon=8)
    ds = train.GriddedWindows(tmp, ws)
    check('dataset length follows the window set', len(ds) == 2, str(len(ds)))

    x, y = ds[1]
    check('context has shape (context, C, H, W)', tuple(x.shape) == (6, N_CHANNELS, 4, 5),
          str(tuple(x.shape)))
    check('target has shape (horizon, C, H, W)', tuple(y.shape) == (8, N_CHANNELS, 4, 5),
          str(tuple(y.shape)))

    src = torch.from_numpy(fake.astype(np.float16).astype(np.float32))
    check('context is the hours before the target',
          torch.allclose(x, src[100:106]) and torch.allclose(y, src[106:114]))
    check('the target starts exactly where the context ends',
          torch.allclose(x[-1], src[105]) and torch.allclose(y[0], src[106]))
finally:
    # Windows keeps the file locked until the memmap itself is closed, so
    # dropping the reference is not enough.
    mm = getattr(ds, '_mm', None)
    if mm is not None and hasattr(mm, '_mmap'):
        mm._mmap.close()
    ds._mm = None
    del ds, mm
    gc.collect()
    shutil.rmtree(tmpdir, ignore_errors=True)

# ── scoring is in physical units ──────────────────────────────────────────────

pred = torch.zeros(2, 4, N_CHANNELS, 3, 3)
targ = torch.zeros(2, 4, N_CHANNELS, 3, 3)
pred[:, :, CH_PM25] = 0.30
targ[:, :, CH_PM25] = 0.20
rmse = float(train.pm25_rmse_ugm3(pred, targ))
expect = 0.10 * float(CHANNEL_SCALE[CH_PM25])
check('PM2.5 RMSE is reported in ug/m3', abs(rmse - expect) < 1e-3,
      f'{rmse:.2f} vs {expect:.2f}')
check('a perfect forecast scores zero',
      float(train.pm25_rmse_ugm3(targ, targ)) == 0.0)

# ── teacher forcing withdraws ─────────────────────────────────────────────────

ratios = [train.teacher_forcing_ratio(e, 10, 0.8, 0.0) for e in range(10)]
check('teacher forcing starts where asked', abs(ratios[0] - 0.8) < 1e-6, f'{ratios[0]}')
check('teacher forcing reaches zero by the last epoch', abs(ratios[-1]) < 1e-6,
      f'{ratios[-1]}')
check('teacher forcing decays monotonically',
      all(b <= a + 1e-9 for a, b in zip(ratios, ratios[1:])))
check('a single-epoch run uses the end ratio',
      abs(train.teacher_forcing_ratio(0, 1, 0.8, 0.0)) < 1e-6)

# ── the real manifest agrees with the assumptions above ───────────────────────

if train.MANIFEST.exists():
    manifest = json.loads(train.MANIFEST.read_text('utf-8'))
    real = train.legal_windows(manifest['blocks'], CONTEXT, HORIZON, stride=3)
    check('the real dataset yields training windows', len(real) > 100, str(len(real)))

    only_2025 = [b for b in manifest['blocks'] if b['season'] == 2025]
    r25 = train.legal_windows(only_2025, CONTEXT, HORIZON, stride=3)
    t25, v25 = train.temporal_split(r25, 0.15, SPAN)
    _notes.append(f'default run (2025, stride 3): {len(t25)} train / {len(v25)} val '
                  f'windows, ~{len(t25) * 1.31 / 60:.0f} min/epoch at 1.31 s/step')

    absent_2025 = sorted(n for n, p in only_2025[0]['channels'].items()
                         if p['source'] == 'absent')
    check('2025 is missing only the fire channels',
          absent_2025 == ['frp', 'smoke'], str(absent_2025))

    absent_2022 = sorted(n for n, p in manifest['blocks'][0]['channels'].items()
                         if p['source'] == 'absent')
    check('2022 additionally lacks PBL, which is why it is excluded by default',
          'pbl' in absent_2022, str(absent_2022))
else:
    _notes.append('gridded_dataset_manifest.json absent; manifest checks skipped')

# ── report ────────────────────────────────────────────────────────────────────
print('\nTraining harness - ml_pipeline/scripts/16_train_coupled.py')
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
