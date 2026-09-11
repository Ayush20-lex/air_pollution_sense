"""
Train the coupled forecaster - Air Pollution Sense
SIH26082 - MoES / NCMRWF

    python ml_pipeline/scripts/16_train_coupled.py --epochs 30
    python ml_pipeline/scripts/16_train_coupled.py --smoke      # 2 min sanity run

Reads ml_pipeline/data/processed/gridded_dataset.npy (built by script 15) and
writes weights that backend/api_server.py can load directly.

Sampling
--------
A window is `context` hours of history followed by `horizon` hours to predict,
and it must lie inside a single block of the dataset. The blocks are 2022-10 and
2025-10..12, three years apart; a window spanning the seam would be teaching a
jump that never happened.

Only the 2025 block is used by default, and not for lack of appetite for data.
The 2022 forecast archive has no boundary-layer-height column, so PBL is zero
across those 744 hours while it is real across 2025. Feeding both to the network
does not merely add noise - it presents identical pollution states with and
without a PBL signal, which teaches the model that PBL is uninformative. PBL
driving the nocturnal inversion is the physical mechanism this architecture
exists to capture, so the 25% extra data is not worth breaking it. Pass
--blocks 2022,2025 to try anyway.

Validation
----------
The split is temporal, never random. Consecutive windows overlap by
context+horizon-1 hours, so a random split puts near-duplicates of training
windows into validation and reports a score that means nothing. Validation is
the last --val-fraction of the block, separated from training by a full window
so the two never share an hour.

Scoring
-------
Reported in ug/m3, not in normalised units, and next to persistence measured on
the same windows - a model that cannot beat "tomorrow looks like today" has not
learned anything, and normalised MSE hides that.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import Tensor

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from channel_spec import (  # noqa: E402
    CHANNEL_SCALE,
    CH_PBL,
    CH_PM25,
    N_CHANNELS,
)
from coupled_model import AirPollutionCoupledForecaster  # noqa: E402
from physics_loss import AtmosphericInversionLoss  # noqa: E402

PROC = REPO_ROOT / 'ml_pipeline' / 'data' / 'processed'
DATASET = PROC / 'gridded_dataset.npy'
MANIFEST = PROC / 'gridded_dataset_manifest.json'
DEFAULT_OUT = REPO_ROOT / 'backend' / 'weights'

PM25_SCALE = float(CHANNEL_SCALE[CH_PM25])
PBL_SCALE = float(CHANNEL_SCALE[CH_PBL])


# ── windows ───────────────────────────────────────────────────────────────────

@dataclass
class WindowSet:
    """Start indices of legal windows, plus the block each came from."""
    starts: np.ndarray
    context: int
    horizon: int
    label: str = ''

    def __len__(self) -> int:
        return len(self.starts)


def legal_windows(blocks: list[dict], context: int, horizon: int,
                  stride: int) -> np.ndarray:
    """Every start index whose whole window fits inside one block."""
    span = context + horizon
    starts: list[np.ndarray] = []
    for b in blocks:
        last = b['end_index'] - span
        if last >= b['start_index']:
            starts.append(np.arange(b['start_index'], last + 1, stride))
    return np.concatenate(starts) if starts else np.empty(0, dtype=np.int64)


def temporal_split(starts: np.ndarray, val_fraction: float,
                   span: int) -> tuple[np.ndarray, np.ndarray]:
    """Latest windows to validation, with a full window of separation.

    The gap matters more than it looks: without it the last training window and
    the first validation window share up to span-1 hours, and the validation
    score quietly becomes a training score.
    """
    if val_fraction <= 0 or len(starts) < 4:
        return starts, np.empty(0, dtype=starts.dtype)

    order = np.sort(starts)
    cut = int(len(order) * (1.0 - val_fraction))
    val = order[cut:]
    train = order[:cut]
    if len(val):
        train = train[train + span <= val[0]]
    return train, val


class GriddedWindows(torch.utils.data.Dataset):
    """Windows cut from the memory-mapped tensor.

    The file is mmap'd rather than loaded: 379 MiB would fit in RAM, but mmap
    keeps the option open for a longer archive and costs nothing here.
    """

    def __init__(self, path: Path, windows: WindowSet) -> None:
        self.path = path
        self.w = windows
        self._mm: np.ndarray | None = None

    def _array(self) -> np.ndarray:
        # Opened lazily so each dataloader worker gets its own handle.
        if self._mm is None:
            self._mm = np.load(self.path, mmap_mode='r')
        return self._mm

    def __len__(self) -> int:
        return len(self.w)

    def __getitem__(self, i: int) -> tuple[Tensor, Tensor]:
        arr = self._array()
        s = int(self.w.starts[i])
        c, h = self.w.context, self.w.horizon
        x = np.asarray(arr[s:s + c], dtype=np.float32)
        y = np.asarray(arr[s + c:s + c + h], dtype=np.float32)
        return torch.from_numpy(x), torch.from_numpy(y)


# ── scoring ───────────────────────────────────────────────────────────────────

def pm25_rmse_ugm3(pred: Tensor, target: Tensor) -> Tensor:
    """RMSE on the PM2.5 channel in ug/m3.

    The offset cancels in a difference, so only the scale is applied. Reporting
    in physical units is the point: normalised MSE is not comparable to the
    84.89 ug/m3 the blend baseline scored.
    """
    diff = (pred[:, :, CH_PM25] - target[:, :, CH_PM25]) * PM25_SCALE
    return torch.sqrt((diff ** 2).mean())


@torch.no_grad()
def evaluate(model, loader, device, amp: bool) -> dict:
    """Validation RMSE overall, by lead-time band, and against persistence."""
    model.eval()
    sq_err = 0.0
    sq_persist = 0.0
    n = 0
    by_lead: dict[str, list[float]] = {}
    lead_sums: np.ndarray | None = None
    lead_counts = 0

    for x, y in loader:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        with torch.autocast('cuda', dtype=torch.float16,
                            enabled=amp and device.type == 'cuda'):
            pred = model(x)
        pred = pred.float()

        d = (pred[:, :, CH_PM25] - y[:, :, CH_PM25]) * PM25_SCALE
        sq_err += float((d ** 2).sum())

        # Persistence: the last observed frame held flat across the horizon.
        last = x[:, -1, CH_PM25].unsqueeze(1)
        dp = (last - y[:, :, CH_PM25]) * PM25_SCALE
        sq_persist += float((dp ** 2).sum())

        n += d.numel()

        per_lead = (d ** 2).mean(dim=(0, 2, 3)).cpu().numpy()
        lead_sums = per_lead if lead_sums is None else lead_sums + per_lead
        lead_counts += 1

    rmse = math.sqrt(sq_err / max(n, 1))
    rmse_p = math.sqrt(sq_persist / max(n, 1))

    if lead_sums is not None:
        lead_rmse = np.sqrt(lead_sums / lead_counts)
        h = len(lead_rmse)
        for name, lo, hi in (('0-24h', 0, min(24, h)),
                             ('24-48h', 24, min(48, h)),
                             ('48-72h', 48, h)):
            if lo < hi:
                by_lead[name] = round(float(lead_rmse[lo:hi].mean()), 2)

    return {
        'pm25_rmse_ugm3': round(rmse, 2),
        'persistence_rmse_ugm3': round(rmse_p, 2),
        'skill_vs_persistence': round(1.0 - rmse / rmse_p, 4) if rmse_p > 0 else 0.0,
        'by_lead': by_lead,
    }


# ── training ──────────────────────────────────────────────────────────────────

def teacher_forcing_ratio(epoch: int, epochs: int, start: float, end: float) -> float:
    """Linear decay from start to end.

    Held high early so the rollout sees real states while the weights are noise,
    then withdrawn so the model learns to survive its own errors - which is the
    regime it runs in at inference.
    """
    if epochs <= 1:
        return end
    t = epoch / (epochs - 1)
    return start + (end - start) * t


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--blocks', default='2025',
                   help='comma-separated seasons to train on (default: 2025)')
    p.add_argument('--context', type=int, default=24, help='hours of history')
    p.add_argument('--horizon', type=int, default=72, help='hours to forecast')
    p.add_argument('--stride', type=int, default=3,
                   help='hours between window starts; 1 is every hour (default 3, '
                        'since adjacent windows share 95 of 96 hours)')
    p.add_argument('--epochs', type=int, default=30,
                   help='total epochs in the PLAN. Drives the cosine LR curve and '
                        'the teacher-forcing decay, so it must stay the same '
                        'across every chunk of a split run.')
    p.add_argument('--stop-after', type=int, default=0,
                   help='train at most this many epochs this invocation, then '
                        'save and exit (0 = run to --epochs). Splits a long run '
                        'across sessions without distorting either schedule.')
    p.add_argument('--batch-size', type=int, default=1,
                   help='1 is the only size that fits 6 GB at horizon 72')
    p.add_argument('--lr', type=float, default=3e-4)
    p.add_argument('--hidden-dim', type=int, default=64)
    p.add_argument('--no-residual', action='store_true',
                   help='use the original absolute-output decoder instead of '
                        'predicting each frame as the previous one plus a delta')
    p.add_argument('--graph-window', type=int, default=10,
                   help='0 restores the original all-pairs attention')
    p.add_argument('--val-fraction', type=float, default=0.15)
    p.add_argument('--tf-start', type=float, default=0.8, help='teacher forcing at epoch 0')
    p.add_argument('--tf-end', type=float, default=0.0, help='teacher forcing at the last epoch')
    p.add_argument('--amp', action='store_true', help='fp16 autocast')
    p.add_argument('--grad-clip', type=float, default=1.0)
    p.add_argument('--workers', type=int, default=0)
    p.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    p.add_argument('--out', default=str(DEFAULT_OUT))
    p.add_argument('--resume', default='', help='checkpoint to continue from')
    p.add_argument('--seed', type=int, default=0)
    p.add_argument('--smoke', action='store_true',
                   help='tiny run that exercises every path in ~2 min')
    args = p.parse_args()

    if args.smoke:
        args.epochs, args.horizon, args.context, args.stride = 2, 6, 6, 97
        args.hidden_dim, args.val_fraction = 16, 0.3

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device)

    if not DATASET.exists():
        print(f'missing {DATASET}\nrun: python ml_pipeline/scripts/15_build_gridded_dataset.py')
        return 1

    manifest = json.loads(MANIFEST.read_text('utf-8'))
    wanted = {int(b) for b in args.blocks.split(',') if b.strip()}
    blocks = [b for b in manifest['blocks'] if b['season'] in wanted]
    if not blocks:
        print(f'no block matches --blocks {args.blocks}; '
              f'available: {[b["season"] for b in manifest["blocks"]]}')
        return 1

    # Refuse to silently train on a block whose channels disagree with the rest.
    absent = {b['season']: sorted(n for n, prov in b['channels'].items()
                                  if prov['source'] == 'absent')
              for b in blocks}
    if len({tuple(v) for v in absent.values()}) > 1:
        print('[warn] blocks disagree on which channels are real:')
        for season, names in absent.items():
            print(f'       {season}: absent {names}')
        print('       identical states with and without those signals teach the '
              'model to ignore them.')

    span = args.context + args.horizon
    starts = legal_windows(blocks, args.context, args.horizon, args.stride)
    train_starts, val_starts = temporal_split(starts, args.val_fraction, span)
    if len(train_starts) == 0:
        print('no training windows; lower --context/--horizon or --stride')
        return 1

    train_ds = GriddedWindows(DATASET, WindowSet(train_starts, args.context, args.horizon, 'train'))
    val_ds = GriddedWindows(DATASET, WindowSet(val_starts, args.context, args.horizon, 'val'))

    train_loader = torch.utils.data.DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True,
        num_workers=args.workers, pin_memory=device.type == 'cuda', drop_last=False)
    val_loader = torch.utils.data.DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False,
        num_workers=args.workers, pin_memory=device.type == 'cuda')

    model = AirPollutionCoupledForecaster(
        in_channels=N_CHANNELS,
        hidden_dim=args.hidden_dim,
        n_steps=args.horizon,
        graph_window=args.graph_window or None,
        residual=not args.no_residual,
    ).to(device)

    # physics_loss defaults predate channel_spec; feed it the live scales so its
    # de-normalisation inside the penalties matches the data.
    criterion = AtmosphericInversionLoss(pm25_norm=PM25_SCALE, pbl_norm=PBL_SCALE).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(args.epochs, 1))
    scaler = torch.amp.GradScaler('cuda', enabled=args.amp and device.type == 'cuda')

    start_epoch, best = 0, float('inf')
    if args.resume:
        ckpt = torch.load(args.resume, map_location=device, weights_only=False)
        model.load_state_dict(ckpt['model'])
        opt.load_state_dict(ckpt['optimizer'])
        sched.load_state_dict(ckpt['scheduler'])
        start_epoch = ckpt['epoch'] + 1
        best = ckpt.get('best_rmse', float('inf'))
        print(f'resumed from {args.resume} at epoch {start_epoch} (best {best:.2f})')

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / 'training_log.csv'
    new_log = not log_path.exists()

    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print('=' * 70)
    print(f'  blocks      {[b["season"] for b in blocks]}')
    print(f'  windows     {len(train_starts)} train / {len(val_starts)} val '
          f'(context {args.context} h, horizon {args.horizon} h, stride {args.stride})')
    print(f'  model       {n_params:,} params, hidden {args.hidden_dim}, '
          f'graph window {args.graph_window or "all-pairs"}, '
          f'head {"absolute" if args.no_residual else "residual"}')
    print(f'  device      {device}  amp={args.amp}')
    print('=' * 70)

    trained_this_run = 0
    for epoch in range(start_epoch, args.epochs):
        model.train()
        model.teacher_force_ratio = teacher_forcing_ratio(
            epoch, args.epochs, args.tf_start, args.tf_end)

        running = 0.0
        seen = 0
        t0 = time.perf_counter()

        for step, (x, y) in enumerate(train_loader):
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)

            with torch.autocast('cuda', dtype=torch.float16,
                                enabled=args.amp and device.type == 'cuda'):
                pred = model(x, target_seq=y)
                loss, parts = criterion(pred.float(), y)

            if not torch.isfinite(loss):
                print(f'  [warn] non-finite loss at step {step}; skipping batch')
                opt.zero_grad(set_to_none=True)
                continue

            scaler.scale(loss).backward()
            if args.grad_clip > 0:
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
            scaler.step(opt)
            scaler.update()
            opt.zero_grad(set_to_none=True)

            running += float(loss.detach()) * x.shape[0]
            seen += x.shape[0]

            if step % 50 == 0:
                done = step + 1
                rate = (time.perf_counter() - t0) / done
                eta = rate * (len(train_loader) - done)
                print(f'  epoch {epoch:3d}  step {done:4d}/{len(train_loader)}  '
                      f'loss {running / max(seen, 1):8.4f}  '
                      f'{rate:5.2f}s/step  eta {eta / 60:5.1f}m', flush=True)

        sched.step()
        train_loss = running / max(seen, 1)
        metrics = evaluate(model, val_loader, device, args.amp) if len(val_ds) else {}
        dt = time.perf_counter() - t0

        rmse = metrics.get('pm25_rmse_ugm3', float('nan'))
        print(f'[epoch {epoch:3d}] loss {train_loss:8.4f}  '
              f'val PM2.5 RMSE {rmse:7.2f} ug/m3  '
              f'persistence {metrics.get("persistence_rmse_ugm3", float("nan")):7.2f}  '
              f'tf {model.teacher_force_ratio:.2f}  {dt / 60:.1f}m')
        if metrics.get('by_lead'):
            print(f'            by lead: {metrics["by_lead"]}')

        with log_path.open('a', newline='', encoding='utf-8') as f:
            wr = csv.writer(f)
            if new_log:
                wr.writerow(['epoch', 'train_loss', 'val_pm25_rmse_ugm3',
                             'persistence_rmse_ugm3', 'skill', 'teacher_forcing',
                             'lr', 'seconds'])
                new_log = False
            wr.writerow([epoch, round(train_loss, 6), rmse,
                         metrics.get('persistence_rmse_ugm3', ''),
                         metrics.get('skill_vs_persistence', ''),
                         round(model.teacher_force_ratio, 3),
                         round(sched.get_last_lr()[0], 8), round(dt, 1)])

        # Decide the new best BEFORE writing last.pt. Saving the pre-update
        # value leaves the checkpoint one epoch stale, and a resumed run then
        # accepts a worse epoch as an improvement and overwrites good weights.
        improved = bool(metrics) and rmse == rmse and rmse < best
        if improved:
            best = rmse

        ckpt = {
            'model': model.state_dict(),
            'optimizer': opt.state_dict(),
            'scheduler': sched.state_dict(),
            'epoch': epoch,
            'best_rmse': best,
            'args': vars(args),
            'metrics': metrics,
            'normalisation': manifest['normalisation'],
        }
        torch.save(ckpt, out_dir / 'last.pt')

        if improved:
            torch.save(ckpt, out_dir / 'best.pt')
            # Bare state_dict, which is what api_server loads with weights_only.
            torch.save(model.state_dict(), out_dir / 'forecaster_v1.pt')
            print(f'            new best {best:.2f} ug/m3 -> forecaster_v1.pt')

        trained_this_run += 1
        if args.stop_after and trained_this_run >= args.stop_after and epoch + 1 < args.epochs:
            print('-' * 70)
            print(f'  stopped after {trained_this_run} epochs; {args.epochs - epoch - 1} '
                  f'of the {args.epochs}-epoch plan remain.')
            print('  The laptop is free now. Resume with:')
            print(f'    python ml_pipeline/scripts/16_train_coupled.py --epochs {args.epochs} '
                  f'--stop-after {args.stop_after} --resume "{out_dir / "last.pt"}"')
            break

    print('=' * 70)
    print(f'  best val PM2.5 RMSE  {best:.2f} ug/m3')
    print(f'  blend baseline       84.89 ug/m3  (script 14, station-space - see note)')
    print(f'  weights              {out_dir / "forecaster_v1.pt"}')
    print('=' * 70)
    print('  Note: 84.89 was scored on station points over 480,283 forecasts, not')
    print('  on these gridded windows. Script 17 scores the baseline on exactly')
    print('  these windows for a comparison that means something.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
