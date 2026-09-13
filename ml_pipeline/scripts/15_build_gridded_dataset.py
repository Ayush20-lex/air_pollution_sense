"""
Build the gridded training tensor - Air Pollution Sense
SIH26082 - MoES / NCMRWF

Turns the station archive into the (T, 12, 70, 80) tensor the coupled model
trains on, normalised by backend/channel_spec.py.

    python ml_pipeline/scripts/15_build_gridded_dataset.py

What the archive actually supports
----------------------------------
Only two stretches of the record have enough stations to grid:

    2022  Oct 1 - Oct 31    744 h    48 stations
    2025  Oct 1 - Dec 31   2208 h    68 stations

2023 and 2024 have 1 and 3 stations - the OpenAQ CPCB outage between
2022-10-31 and 2025-02-18, which only the AirNow embassy monitor spans. They are
skipped rather than interpolated across; three years of invented field is not
training data.

The two blocks are three years apart, so they are stored as one array with
explicit block boundaries in the manifest. A training window must never straddle
them: hour 743 is 2022-10-31T23:00 and hour 744 is 2025-10-01T00:00, and a model
asked to roll forward across that seam is being taught a discontinuity that does
not exist in the atmosphere.

Channel provenance
------------------
    0-3   pm25, pm10, o3, no2      station observations, IDW to the grid
    4-9   u, v, temp, rh, solar,   Open-Meteo per-station forecast archive
          pbl                      (ERA5 covers one week; this covers both
                                    seasons)
    10-11 frp, smoke               zero - FIRMS only covers 2023-11-01..07

Sensor units come from the station catalogue and are converted per sensor, not
per parameter: no2 is reported in ppb by 61 sensors and ug/m3 by 56, and mixing
them understates the channel by nearly half.
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

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from aqi_cpcb import to_cpcb_units  # noqa: E402
from channel_spec import (  # noqa: E402
    CHANNEL_NAMES,
    CH_NOX,
    CH_O3,
    CH_PBL,
    CH_PM10,
    CH_PM25,
    CH_RH,
    CH_SOLAR,
    CH_TEMP,
    CH_U,
    CH_V,
    GRID_H,
    GRID_W,
    N_CHANNELS,
    normalise,
    spec_as_dict,
)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger('build_gridded')

DATA = REPO_ROOT / 'ml_pipeline' / 'data'
OUT_DIR = DATA / 'processed'

#: Default pair, kept so an argument-free run still reproduces the pilot
#: dataset exactly. The extended record is fetched under season 2026.
SEASONS = (2022, 2025)
CATALOG_DEFAULT = 'catalog.json'

LAT_MIN, LAT_MAX = 28.20, 28.90
LON_MIN, LON_MAX = 76.80, 77.60

#: Observation parameter feeding each observed channel. Channel 3 is named NOx
#: in channel_schema.json but is populated from NO2 - see channel_spec.py.
OBS_PARAM: dict[int, str] = {
    CH_PM25: 'pm25',
    CH_PM10: 'pm10',
    CH_O3: 'o3',
    CH_NOX: 'no2',
}

#: Forecast-archive column feeding each meteorological channel.
MET_COLUMN: dict[int, str] = {
    CH_TEMP: 'fcst_temperature_2m',
    CH_RH: 'fcst_relative_humidity_2m',
    CH_SOLAR: 'fcst_shortwave_radiation',
    CH_PBL: 'fcst_boundary_layer_height',
}

#: Open-Meteo returns wind speed in km/h unless asked otherwise.
KMH_TO_MS = 3.6

IDW_K = 8
IDW_POWER = 2.0
TIME_CHUNK = 240        # hours gridded at once; caps peak memory


# ── catalogue ─────────────────────────────────────────────────────────────────

def load_catalog(catalog: str = CATALOG_DEFAULT) -> tuple[dict[int, tuple[float, float]], dict[int, str]]:
    """Returns station coordinates and each sensor's reported unit.

    Defaults to the pilot catalogue so callers that predate the extended
    record - 17_spatial_validation.py imports this - keep working unchanged.
    """
    cat = json.loads((DATA / 'raw' / 'stations' / catalog).read_text('utf-8'))

    coords: dict[int, tuple[float, float]] = {}
    units: dict[int, str] = {}
    for s in cat['stations']:
        lat, lon = s.get('latitude'), s.get('longitude')
        if lat is None or lon is None:
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        coords[s['location_id']] = (lat, lon)
        for sensors in (s.get('sensors') or {}).values():
            for sn in sensors:
                if sn.get('sensor_id') is not None and sn.get('units'):
                    units[sn['sensor_id']] = sn['units']
    return coords, units


# ── observations ──────────────────────────────────────────────────────────────

def load_observations(season: int, param: str, units: dict[int, str]) -> pd.DataFrame:
    """Hourly station values for one parameter, converted to ug/m3.

    Returns an empty frame when the season has no sensors for this parameter,
    which is how 2022 reports having no nox files.
    """
    files = sorted(glob.glob(str(DATA / 'raw' / 'observations' / f'season={season}' / f'{param}_*.parquet')))
    if not files:
        return pd.DataFrame(columns=['timestamp_utc', 'location_id', 'value'])

    frames = []
    unknown_units = 0
    for f in files:
        df = pd.read_parquet(f, columns=['timestamp_utc', 'location_id', 'sensor_id', 'value'])
        df = df.dropna(subset=['value'])
        if df.empty:
            continue

        # One unit per sensor file, so convert once rather than per row.
        sensor_id = int(df.sensor_id.iloc[0])
        unit = units.get(sensor_id)
        if unit is None:
            unknown_units += 1
            continue
        try:
            factor = to_cpcb_units(param if param != 'no2' else 'no2', 1.0, unit)
        except ValueError:
            unknown_units += 1
            continue
        df['value'] = df['value'].astype('float32') * np.float32(factor)
        frames.append(df[['timestamp_utc', 'location_id', 'value']])

    if unknown_units:
        logger.warning('%s %d: skipped %d sensor files with no usable unit',
                       param, season, unknown_units)
    if not frames:
        return pd.DataFrame(columns=['timestamp_utc', 'location_id', 'value'])

    obs = pd.concat(frames, ignore_index=True)
    obs['timestamp_utc'] = pd.to_datetime(obs.timestamp_utc, utc=True).dt.floor('h')
    return obs.groupby(['location_id', 'timestamp_utc'], as_index=False)['value'].mean()


# ── gridding ──────────────────────────────────────────────────────────────────

def precompute_idw(lats: np.ndarray, lons: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Neighbour indices and weights for every grid cell.

    Station positions are fixed for a season, so this is computed once and every
    hour is then a weighted sum. Distances are metric (UTM 43N), not degrees -
    a degree of longitude at 28.5N is 12% shorter than a degree of latitude, and
    using raw lat/lon would stretch every plume east-west.
    """
    from pyproj import Transformer
    from scipy.spatial import cKDTree

    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32643', always_xy=True)
    glon, glat = np.meshgrid(
        np.linspace(LON_MIN, LON_MAX, GRID_W),
        np.linspace(LAT_MIN, LAT_MAX, GRID_H),
    )
    ge, gn = to_utm.transform(glon.ravel(), glat.ravel())
    se, sn = to_utm.transform(lons, lats)

    tree = cKDTree(np.column_stack([se, sn]))
    dist, idx = tree.query(np.column_stack([ge, gn]), k=min(IDW_K, len(lats)))
    if idx.ndim == 1:                       # k == 1
        idx, dist = idx[:, None], dist[:, None]
    dist = np.where(dist == 0, 1e-10, dist)
    w = (1.0 / dist ** IDW_POWER).astype(np.float32)
    return idx.astype(np.int32), w


def grid_series(values: np.ndarray, idx: np.ndarray, w: np.ndarray) -> np.ndarray:
    """(T, S) station values -> (T, H, W), renormalising over reporting stations.

    A station that did not report in a given hour is dropped from that hour's
    weighting rather than filled first. Filling before the weights are built -
    what the baseline does, deliberately, to keep its weights constant - would
    let a station that has been offline for a week keep voting with the value it
    last reported.

    Hours where no station reported at all come back as NaN for the caller to
    interpolate over.
    """
    T = values.shape[0]
    out = np.empty((T, GRID_H * GRID_W), dtype=np.float32)

    for lo in range(0, T, TIME_CHUNK):
        hi = min(lo + TIME_CHUNK, T)
        chunk = values[lo:hi][:, idx]                  # (t, G, k)
        valid = np.isfinite(chunk)
        weights = np.where(valid, w[None, :, :], 0.0)
        total = weights.sum(axis=-1)
        num = (np.where(valid, chunk, 0.0) * weights).sum(axis=-1)
        out[lo:hi] = np.where(total > 0, num / np.where(total > 0, total, 1.0), np.nan)

    return out.reshape(T, GRID_H, GRID_W)


def fill_time_gaps(field: np.ndarray) -> tuple[np.ndarray, dict]:
    """Interpolate along time the cells no station covered.

    Gaps are per cell, not per hour. grid_series marks a cell NaN when all k of
    its nearest stations were silent that hour, and which stations are nearest
    differs across the grid - so a corner of the domain can go blind while the
    centre stays fully covered. Treating this as a whole-hour problem leaves
    NaN behind in exactly the sparse corners that matter most.
    """
    T = field.shape[0]
    flat = field.reshape(T, -1)
    n_nan = int((~np.isfinite(flat)).sum())
    if n_nan == 0:
        return field, {'cells_interpolated': 0, 'percent_of_cells': 0.0}

    filled = (pd.DataFrame(flat)
                .interpolate(axis=0, limit_direction='both')
                .to_numpy(dtype=np.float32))

    # A cell that no station ever reached has nothing to interpolate between;
    # fall back to that hour's spatial mean so the field stays continuous.
    still = ~np.isfinite(filled)
    n_still = int(still.sum())
    if n_still:
        hourly = np.nan_to_num(np.nanmean(np.where(np.isfinite(filled), filled, np.nan),
                                          axis=1))
        filled = np.where(still, hourly[:, None], filled)

    return filled.reshape(field.shape), {
        'cells_interpolated': n_nan - n_still,
        'cells_from_hourly_mean': n_still,
        'percent_of_cells': round(100.0 * n_nan / flat.size, 3),
    }


# ── per-season build ──────────────────────────────────────────────────────────

def build_season(season: int, coords, units) -> tuple[np.ndarray, pd.DatetimeIndex, dict]:
    fc_path = DATA / 'raw' / 'forecast' / f'forecast_{season}.parquet'
    fc = pd.read_parquet(fc_path)
    fc['timestamp_utc'] = pd.to_datetime(fc.timestamp_utc, utc=True).dt.floor('h')

    observations = {ch: load_observations(season, p, units) for ch, p in OBS_PARAM.items()}

    obs_ids: set[int] = set()
    for df in observations.values():
        obs_ids |= set(df.location_id.unique().tolist()) if not df.empty else set()
    ids = sorted(set(coords) & set(fc.location_id.unique()) & obs_ids)
    if not ids:
        raise RuntimeError(f'season {season}: no station appears in catalogue, forecast and observations')

    times = pd.date_range(fc.timestamp_utc.min(), fc.timestamp_utc.max(), freq='h', tz='UTC')
    lats = np.array([coords[i][0] for i in ids], dtype=np.float64)
    lons = np.array([coords[i][1] for i in ids], dtype=np.float64)
    idx, w = precompute_idw(lats, lons)

    def pivot(df: pd.DataFrame, col: str) -> np.ndarray:
        """(T, S) with gaps left as NaN so grid_series can drop them."""
        wide = (df.pivot_table(index='timestamp_utc', columns='location_id',
                               values=col, aggfunc='mean')
                  .reindex(index=times, columns=ids))
        return wide.to_numpy(dtype=np.float32)

    tensor = np.zeros((len(times), N_CHANNELS, GRID_H, GRID_W), dtype=np.float32)
    provenance: dict[str, dict] = {}

    for ch, param in OBS_PARAM.items():
        df = observations[ch]
        if df.empty:
            provenance[CHANNEL_NAMES[ch]] = {'source': 'absent', 'parameter': param}
            logger.warning('season %d: no %s observations, channel %d left at zero',
                           season, param, ch)
            continue
        series = pivot(df, 'value')
        field, gaps = fill_time_gaps(grid_series(series, idx, w))
        tensor[:, ch] = field
        provenance[CHANNEL_NAMES[ch]] = {
            'source': 'station observations (IDW)',
            'parameter': param,
            'stations_reporting': int(np.isfinite(series).any(axis=0).sum()),
            'gap_fill': gaps,
        }

    for ch, col in MET_COLUMN.items():
        if col not in fc.columns or fc[col].isna().all():
            provenance[CHANNEL_NAMES[ch]] = {'source': 'absent', 'column': col}
            logger.warning('season %d: %s is entirely null, channel %d left at zero',
                           season, col, ch)
            continue
        field, gaps = fill_time_gaps(grid_series(pivot(fc, col), idx, w))
        tensor[:, ch] = field
        provenance[CHANNEL_NAMES[ch]] = {
            'source': 'open-meteo forecast archive',
            'column': col,
            'gap_fill': gaps,
        }

    # Wind speed and direction -> signed components. Meteorological convention:
    # direction names where the wind comes FROM, so the vector points opposite.
    if {'fcst_wind_speed_10m', 'fcst_wind_direction_10m'} <= set(fc.columns):
        # 12_fetch_openmeteo_forecast.py sends no wind_speed_unit, so Open-Meteo
        # answered in its default km/h. Reading that as m/s inflates every wind
        # by 3.6x - it puts Delhi's winter mean at 6.3 m/s instead of 1.7.
        spd = pivot(fc, 'fcst_wind_speed_10m') / KMH_TO_MS
        rad = np.deg2rad(pivot(fc, 'fcst_wind_direction_10m'))
        for ch, comp in ((CH_U, -spd * np.sin(rad)), (CH_V, -spd * np.cos(rad))):
            field, gaps = fill_time_gaps(grid_series(comp.astype(np.float32), idx, w))
            tensor[:, ch] = field
            provenance[CHANNEL_NAMES[ch]] = {
                'source': 'open-meteo forecast archive',
                'column': 'fcst_wind_speed_10m + fcst_wind_direction_10m',
                'gap_fill': gaps,
            }

    for ch in (10, 11):
        provenance[CHANNEL_NAMES[ch]] = {
            'source': 'absent',
            'note': 'FIRMS archive covers 2023-11-01..07 only; left at zero',
        }

    meta = {
        'season': season,
        'hours': len(times),
        'stations': len(ids),
        'station_ids': ids,
        'first_hour': times[0].isoformat(),
        'last_hour': times[-1].isoformat(),
        'channels': provenance,
    }
    return tensor, times, meta


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seasons', type=int, nargs='+', default=list(SEASONS),
                    help='seasons to grid (default: the 2022/2025 pilot pair)')
    ap.add_argument('--catalog', default=CATALOG_DEFAULT,
                    help='catalogue filename under data/raw/stations')
    ap.add_argument('--name', default='gridded_dataset',
                    help='output stem; the pilot dataset is never overwritten '
                         'unless this is left at its default')
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    coords, units = load_catalog(args.catalog)
    logger.info('catalogue: %d stations inside the grid, %d sensor units',
                len(coords), len(units))

    blocks, tensors, all_times = [], [], []
    cursor = 0
    for season in args.seasons:
        tensor, times, meta = build_season(season, coords, units)
        logger.info('season %d: %d h x %d stations gridded', season, len(times), meta['stations'])
        tensors.append(tensor)
        all_times.append(times)
        meta['start_index'] = cursor
        meta['end_index'] = cursor + len(times)
        blocks.append(meta)
        cursor += len(times)

    physical = np.concatenate(tensors, axis=0)
    times = all_times[0].append(all_times[1:]) if len(all_times) > 1 else all_times[0]

    # Report clipping before it happens - a scale that clips a real episode is a
    # bug in channel_spec.py, not a rounding detail.
    clipped = {}
    spec = spec_as_dict()
    for ch in range(N_CHANNELS):
        raw = (physical[:, ch] + spec['channels'][ch]['offset']) / spec['channels'][ch]['scale']
        frac = float((raw > 1.0).mean() + (raw < 0.0).mean())
        if frac > 0:
            clipped[CHANNEL_NAMES[ch]] = round(frac * 100, 4)
    if clipped:
        logger.warning('cells clipped by the normalisation (%%): %s', clipped)

    normalised = normalise(physical).astype(np.float16)

    out_path = OUT_DIR / f'{args.name}.npy'
    np.save(out_path, normalised)

    manifest = {
        'shape': list(normalised.shape),
        'dtype': 'float16',
        'layout': '(time, channel, lat, lon)',
        'note': (
            'float16 in [0, 1]; cast to float32 on load. Resolution near 1.0 is '
            '~5e-4, which on the PM2.5 scale is 0.5 ug/m3 - below sensor noise.'
        ),
        'bytes': int(normalised.nbytes),
        'grid': {'h': GRID_H, 'w': GRID_W,
                 'lat_bounds': [LAT_MIN, LAT_MAX], 'lon_bounds': [LON_MIN, LON_MAX]},
        'normalisation': spec,
        'clipped_percent': clipped,
        'idw': {'k': IDW_K, 'power': IDW_POWER, 'crs': 'EPSG:32643'},
        'blocks': blocks,
        'sampling_rule': (
            'A window [t, t + context + horizon) must lie inside one block. '
            'Blocks are three years apart and the seam is not physical.'
        ),
        'times': [t.isoformat() for t in times],
    }
    (OUT_DIR / f'{args.name}_manifest.json').write_text(
        json.dumps(manifest, indent=2), encoding='utf-8'
    )

    print()
    print('=' * 68)
    print(f'  shape      {normalised.shape}  {normalised.nbytes / 2**20:.0f} MiB on disk')
    for b in blocks:
        real = sum(1 for c in b['channels'].values() if c['source'] != 'absent')
        print(f'  block {b["season"]}  hours {b["start_index"]:5d}..{b["end_index"]:<5d} '
              f'{b["stations"]:2d} stations  {real}/12 channels real')
    print(f'  written    {out_path}')
    print('=' * 68)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
