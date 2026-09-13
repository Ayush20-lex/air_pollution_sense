"""
Spatial validation - Air Pollution Sense
SIH26082 - MoES / NCMRWF

    python ml_pipeline/scripts/17_spatial_validation.py

Answers the question a reviewer will actually ask: the grid claims a value in
every one of 5,600 cells, but only 68 of them contain an instrument. How
accurate is the field where nothing is measuring?

Withholding time cannot answer that. A temporal split still interpolates from
every station, so it measures "can we predict tomorrow", never "can we predict
somewhere". This withholds *stations*: the field is rebuilt from a subset and
scored at the coordinates that were removed - locations the interpolator has
never seen, which is exactly the situation of an unmonitored cell.

Three results come out of it:

  1. Leave-one-station-out. Each station predicted from the other 67, scored
     against its own readings. The headline number.
  2. Error against distance to the nearest contributing station. This is what
     turns one global RMSE into a per-cell confidence: a cell 2 km from Anand
     Vihar is not the same claim as one 18 km into Jhajjar.
  3. A network-density sweep. Rebuild from 75%, 50% and 25% of the network and
     watch the error grow. That measures what each station is worth, and it is
     the honest form of the scaling argument - it says what accuracy a new city
     buys with n stations rather than asserting coverage is free.

Reference points, so the numbers mean something:
  - spatial mean: predict every held-out station with the domain average of the
    reporting stations. The floor. Beating it is the minimum bar.
  - nearest station: copy the single closest reporting station. The naive
     method IDW has to justify itself against.

CPU only, no torch - it is designed to run while the GPU is training.
"""
from __future__ import annotations

import importlib.util
import json
import logging
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

# Reuse the builder's catalogue and observation loaders rather than copying
# them. The per-sensor unit conversion in particular must not drift: no2 comes
# in ppb from 61 sensors and ug/m3 from 56, and a second implementation that
# forgets that would quietly report a different pollutant.
_spec = importlib.util.spec_from_file_location(
    'build_gridded', Path(__file__).with_name('15_build_gridded_dataset.py'))
_build = importlib.util.module_from_spec(_spec)
sys.modules['build_gridded'] = _build
_spec.loader.exec_module(_build)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger('spatial_validation')

OUT_DIR = REPO_ROOT / 'ml_pipeline' / 'data' / 'processed'
SEASON = 2025
PARAM = 'pm25'
IDW_K = _build.IDW_K
IDW_POWER = _build.IDW_POWER
RNG_SEED = 0

#: Bin edges for the error-against-distance table, in kilometres.
DISTANCE_BINS = [0, 3, 6, 10, 15, 25, 1e9]


# ── geometry ──────────────────────────────────────────────────────────────────

def to_metres(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Lat/lon -> UTM 43N easting/northing, so distances are in metres.

    Degrees would distort: at 28.5 N a degree of longitude is 12% shorter than
    a degree of latitude, which would bias every weight along the east-west axis.
    """
    from pyproj import Transformer
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32643', always_xy=True)
    e, n = to_utm.transform(lons, lats)
    return np.column_stack([e, n])


def idw_predict(values: np.ndarray, src: np.ndarray, dst: np.ndarray,
                k: int = IDW_K, power: float = IDW_POWER) -> tuple[np.ndarray, np.ndarray]:
    """Interpolate to dst points from src stations, hour by hour.

    values : (T, n_src) with NaN where a station did not report
    Returns (T, n_dst) predictions and (n_dst,) distance in km to the nearest
    source station, whether or not that station was reporting.
    """
    from scipy.spatial import cKDTree

    tree = cKDTree(src)
    kk = min(k, len(src))
    dist, idx = tree.query(dst, k=kk)
    if idx.ndim == 1:
        idx, dist = idx[:, None], dist[:, None]

    safe = np.where(dist == 0, 1e-6, dist)
    w = (1.0 / safe ** power).astype(np.float64)

    gathered = values[:, idx]                       # (T, n_dst, k)
    valid = np.isfinite(gathered)
    weights = np.where(valid, w[None, :, :], 0.0)
    total = weights.sum(axis=-1)
    num = (np.where(valid, gathered, 0.0) * weights).sum(axis=-1)

    pred = np.where(total > 0, num / np.where(total > 0, total, 1.0), np.nan)
    return pred, dist[:, 0] / 1000.0


# ── scoring ───────────────────────────────────────────────────────────────────

def score(pred: np.ndarray, truth: np.ndarray) -> dict:
    """RMSE, MAE, bias and correlation over the finite pairs only."""
    ok = np.isfinite(pred) & np.isfinite(truth)
    n = int(ok.sum())
    if n == 0:
        return {'n': 0, 'rmse': float('nan'), 'mae': float('nan'),
                'bias': float('nan'), 'corr': float('nan')}
    p, t = pred[ok], truth[ok]
    d = p - t
    corr = float(np.corrcoef(p, t)[0, 1]) if n > 2 and p.std() > 0 and t.std() > 0 else float('nan')
    return {
        'n': n,
        'rmse': float(np.sqrt((d ** 2).mean())),
        'mae': float(np.abs(d).mean()),
        'bias': float(d.mean()),
        'corr': corr,
    }


def spatial_mean_reference(values: np.ndarray, held: np.ndarray) -> np.ndarray:
    """Predict every held-out station with the mean of the reporting stations."""
    keep = np.setdiff1d(np.arange(values.shape[1]), held)
    # Hours where no station reported are legitimately undefined, not an error.
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        m = np.nanmean(values[:, keep], axis=1)
    return np.repeat(m[:, None], len(held), axis=1)


def nearest_station_reference(values: np.ndarray, src_pts: np.ndarray,
                              dst_pts: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Copy the closest station that actually reported in each hour."""
    from scipy.spatial import cKDTree
    tree = cKDTree(src_pts)
    kk = min(IDW_K, len(src_pts))
    _, idx = tree.query(dst_pts, k=kk)
    if idx.ndim == 1:
        idx = idx[:, None]
    gathered = values[:, keep][:, idx]                    # (T, n_dst, k)
    valid = np.isfinite(gathered)
    first = np.argmax(valid, axis=-1)                     # nearest reporting
    took = np.take_along_axis(gathered, first[..., None], axis=-1)[..., 0]
    return np.where(valid.any(axis=-1), took, np.nan)


# ── experiments ───────────────────────────────────────────────────────────────

def leave_one_out(values: np.ndarray, pts: np.ndarray) -> tuple[dict, pd.DataFrame]:
    """Predict each station from every other station."""
    n_st = values.shape[1]
    preds = np.full_like(values, np.nan, dtype=np.float64)
    nearest_km = np.zeros(n_st)

    for s in range(n_st):
        keep = np.setdiff1d(np.arange(n_st), s)
        p, d = idw_predict(values[:, keep], pts[keep], pts[s:s + 1])
        preds[:, s] = p[:, 0]
        nearest_km[s] = d[0]

    overall = score(preds, values)

    rows = []
    for s in range(n_st):
        st = score(preds[:, s], values[:, s])
        st['station_index'] = s
        st['nearest_km'] = round(float(nearest_km[s]), 2)
        st['observed_mean'] = float(np.nanmean(values[:, s])) if np.isfinite(values[:, s]).any() else float('nan')
        rows.append(st)
    return overall, pd.DataFrame(rows),


def by_distance(per_station: pd.DataFrame) -> pd.DataFrame:
    """Group station errors by how far the nearest other station sits."""
    labels = []
    for lo, hi in zip(DISTANCE_BINS[:-1], DISTANCE_BINS[1:]):
        labels.append(f'{lo}-{hi} km' if hi < 1e8 else f'{lo}+ km')
    cut = pd.cut(per_station.nearest_km, bins=DISTANCE_BINS, labels=labels, right=False)

    out = []
    for label, grp in per_station.groupby(cut, observed=True):
        if grp.empty:
            continue
        # Pool by observation count so a station with few hours cannot dominate.
        w = grp.n.to_numpy(dtype=float)
        rmse = float(np.sqrt(np.average(grp.rmse.to_numpy() ** 2, weights=w)))
        out.append({
            'distance_band': str(label),
            'stations': int(len(grp)),
            'observations': int(grp.n.sum()),
            'rmse': round(rmse, 2),
            'bias': round(float(np.average(grp.bias.to_numpy(), weights=w)), 2),
        })
    return pd.DataFrame(out)


def density_sweep(values: np.ndarray, pts: np.ndarray,
                  fractions=(0.75, 0.50, 0.25), repeats: int = 5) -> pd.DataFrame:
    """Rebuild the field from a fraction of the network and score the remainder.

    This is the scaling argument in measurable form: it says what a new city
    with n stations would actually get, instead of asserting that coverage is
    free.
    """
    rng = np.random.default_rng(RNG_SEED)
    n_st = values.shape[1]
    rows = []

    for frac in fractions:
        n_keep = max(IDW_K, int(round(n_st * frac)))
        if n_keep >= n_st:
            continue
        trial = []
        for _ in range(repeats):
            keep = rng.choice(n_st, size=n_keep, replace=False)
            held = np.setdiff1d(np.arange(n_st), keep)
            pred, _ = idw_predict(values[:, keep], pts[keep], pts[held])
            trial.append(score(pred, values[:, held])['rmse'])
        rows.append({
            'network_fraction': f'{frac:.0%}',
            'stations_used': n_keep,
            'stations_scored': n_st - n_keep,
            'rmse_mean': round(float(np.mean(trial)), 2),
            'rmse_sd': round(float(np.std(trial)), 2),
        })
    return pd.DataFrame(rows)


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    coords, units = _build.load_catalog()
    obs = _build.load_observations(SEASON, PARAM, units)
    if obs.empty:
        logger.error('no %s observations for season %d', PARAM, SEASON)
        return 1

    ids = sorted(set(coords) & set(obs.location_id.unique()))
    times = pd.date_range(obs.timestamp_utc.min(), obs.timestamp_utc.max(),
                          freq='h', tz='UTC')
    wide = (obs.pivot_table(index='timestamp_utc', columns='location_id',
                            values='value', aggfunc='mean')
               .reindex(index=times, columns=ids))
    values = wide.to_numpy(dtype=np.float64)

    lats = np.array([coords[i][0] for i in ids])
    lons = np.array([coords[i][1] for i in ids])
    pts = to_metres(lats, lons)

    logger.info('%d stations, %d hours, %d observations',
                len(ids), len(times), int(np.isfinite(values).sum()))

    overall, per_station = leave_one_out(values, pts)

    # References, scored on the same held-out points.
    all_idx = np.arange(len(ids))
    mean_pred = np.column_stack([
        spatial_mean_reference(values, np.array([s]))[:, 0] for s in all_idx])
    mean_ref = score(mean_pred, values)

    near_pred = np.full_like(values, np.nan)
    for s in all_idx:
        keep = np.setdiff1d(all_idx, s)
        near_pred[:, s] = nearest_station_reference(
            values, pts[keep], pts[s:s + 1], keep)[:, 0]
    near_ref = score(near_pred, values)

    bands = by_distance(per_station)
    sweep = density_sweep(values, pts)

    # ── report ────────────────────────────────────────────────────────────────
    print()
    print('=' * 70)
    print(f'  Leave-one-station-out - PM2.5, season {SEASON}')
    print('=' * 70)
    print(f'{"method":<26}{"RMSE":>9}{"MAE":>9}{"bias":>9}{"corr":>8}')
    for name, m in (('IDW from other stations', overall),
                    ('nearest station', near_ref),
                    ('spatial mean (floor)', mean_ref)):
        print(f'{name:<26}{m["rmse"]:9.2f}{m["mae"]:9.2f}{m["bias"]:9.2f}{m["corr"]:8.3f}')
    print(f'\n  scored on {overall["n"]:,} station-hours the interpolator never saw')

    print()
    print('  Error against distance to the nearest other station')
    print('  ' + '-' * 62)
    print(f'  {"band":<12}{"stations":>10}{"obs":>12}{"RMSE":>10}{"bias":>10}')
    for _, r in bands.iterrows():
        print(f'  {r.distance_band:<12}{r.stations:>10}{r.observations:>12,}'
              f'{r.rmse:>10.2f}{r.bias:>10.2f}')

    print()
    print('  Network density: rebuild from a fraction, score the rest')
    print('  ' + '-' * 62)
    print(f'  {"network":<12}{"used":>8}{"scored":>9}{"RMSE":>10}{"sd":>8}')
    print(f'  {"100%":<12}{len(ids) - 1:>8}{1:>9}{overall["rmse"]:>10.2f}{"-":>8}')
    for _, r in sweep.iterrows():
        print(f'  {r.network_fraction:<12}{r.stations_used:>8}{r.stations_scored:>9}'
              f'{r.rmse_mean:>10.2f}{r.rmse_sd:>8.2f}')
    print('=' * 70)

    worst = per_station.nlargest(3, 'rmse')
    print('  Hardest stations to predict from their neighbours:')
    for _, r in worst.iterrows():
        print(f'    {ids[int(r.station_index)]:>10}  RMSE {r.rmse:7.2f}  '
              f'nearest {r.nearest_km:5.1f} km  mean {r.observed_mean:6.1f} ug/m3')
    print('=' * 70)

    result = {
        'season': SEASON,
        'parameter': PARAM,
        'stations': len(ids),
        'hours': len(times),
        'method': f'leave-one-station-out, IDW k={IDW_K} power={IDW_POWER}, UTM 43N',
        'leave_one_out': {k: (round(v, 4) if isinstance(v, float) else v)
                          for k, v in overall.items()},
        'reference_nearest_station': {k: (round(v, 4) if isinstance(v, float) else v)
                                      for k, v in near_ref.items()},
        'reference_spatial_mean': {k: (round(v, 4) if isinstance(v, float) else v)
                                   for k, v in mean_ref.items()},
        'by_distance': bands.to_dict('records'),
        'density_sweep': sweep.to_dict('records'),
        'station_ids': [int(i) for i in ids],
    }
    (OUT_DIR / 'spatial_validation.json').write_text(
        json.dumps(result, indent=2, default=str), encoding='utf-8')
    per_station.assign(location_id=[ids[i] for i in per_station.station_index]) \
               .to_csv(OUT_DIR / 'spatial_validation_by_station.csv', index=False)
    print(f'  written  {OUT_DIR / "spatial_validation.json"}')
    print(f'           {OUT_DIR / "spatial_validation_by_station.csv"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
