"""
Channel normalisation contract - Air Pollution Sense
SIH26082 - MoES / NCMRWF

One definition of how a physical field becomes a number the network sees, and
how it comes back. Every producer of a (T, 12, 70, 80) tensor and every consumer
of one must agree on this, or the numbers on the dashboard are wrong in a way
nothing will flag.

    normalised = (physical + offset) / scale
    physical   = normalised * scale - offset

Why an offset at all
--------------------
The decoder in coupled_model.py ends in nn.Sigmoid(), so every channel the
model emits is confined to [0, 1]. The legacy vector (LEGACY_NORMS below, still
used by api_server and baseline_forecaster) is scale-only, which is fine for
concentrations but silently breaks the wind components: u and v are signed, and
in the 2025 archive 74% of v values are negative. Divided by 20 they land in
[-1, 0), which a sigmoid cannot produce at all. The model would be driven to its
floor on most of the season and the recirculated wind field - the rollout feeds
its own prediction back in - would carry a one-directional bias. Offsetting the
signed channels puts them inside the reachable range.

Why these scales
----------------
Taken from the archive rather than guessed, because a scale below the data
clips: the legacy PM2.5 scale of 500 would flatten 1.35% of readings to exactly
1.0, and those readings are the severe episodes this project exists to forecast.
Each scale here covers the observed maximum with headroom, measured over
ml_pipeline/data/raw (2022 and 2025 seasons):

    channel   observed max        scale
    pm25      1000 ug/m3          1000
    pm10      1500 ug/m3          1500
    o3         494 ug/m3           500
    no2        495 ug/m3           400    (p99 = 184 after unit conversion)
    u, v       -5.3 ..  5.7 m/s     20    offset 10
    temp       5.6 .. 34.6 C        60    offset 10, covers -10 .. 50
    rh          19 .. 100 %        100
    solar        0 .. 778 W/m2    1200
    pbl         10 .. 3920 m      4000

NO2 stands in the NOx slot. channel_schema.json names channel 3 "NOx", but the
nox sensors are catalogued as ppb while reporting a median of 0.04 - three
orders of magnitude below anything physical for Delhi, so the unit label cannot
be trusted. The no2 sensors report a coherent median of 46 ug/m3 and cover both
seasons, so the channel is populated from those.

A note on the wind scale: these are m/s. The Open-Meteo archive stores km/h,
because 12_fetch_openmeteo_forecast.py sends no wind_speed_unit and km/h is
that API's default. 15_build_gridded_dataset.py divides by 3.6 on the way in.
baseline_forecaster.py does not, so the wind it reports is 3.6x too large -
display only, since the PM2.5 blend never reads those channels.
"""
from __future__ import annotations

import numpy as np

N_CHANNELS = 12
GRID_H, GRID_W = 70, 80

CH_PM25, CH_PM10, CH_O3, CH_NOX = 0, 1, 2, 3
CH_U, CH_V, CH_TEMP, CH_RH, CH_SOLAR, CH_PBL = 4, 5, 6, 7, 8, 9
CH_FRP, CH_SMOKE = 10, 11

CHANNEL_NAMES: tuple[str, ...] = (
    'pm25', 'pm10', 'o3', 'no2',
    'u_wind', 'v_wind', 'temperature', 'humidity', 'solar', 'pbl',
    'frp', 'smoke',
)

CHANNEL_UNITS: tuple[str, ...] = (
    'ug/m3', 'ug/m3', 'ug/m3', 'ug/m3',
    'm/s', 'm/s', 'C', '%', 'W/m2', 'm',
    'MW', 'index',
)

#: Added before scaling, so signed fields land inside the sigmoid's range.
CHANNEL_OFFSET = np.array(
    [0, 0, 0, 0, 10, 10, 10, 0, 0, 0, 0, 0], dtype=np.float32
)

#: Divides after the offset. Chosen to cover the observed maximum.
CHANNEL_SCALE = np.array(
    [1000, 1500, 500, 400, 20, 20, 60, 100, 1200, 4000, 200, 300], dtype=np.float32
)

#: What api_server._tensor_to_geojson and baseline_forecaster currently use.
#: Kept for reference and for reading tensors written before this module; it is
#: scale-only, so it cannot round-trip u, v or sub-zero temperatures.
LEGACY_NORMS = np.array(
    [500, 700, 120, 250, 20, 20, 40, 100, 1200, 3000, 200, 300], dtype=np.float32
)


def _shape_for(arr: np.ndarray, vec: np.ndarray) -> np.ndarray:
    """Broadcast a per-channel vector against an array whose axis -3 is channel."""
    if arr.shape[-3] != N_CHANNELS:
        raise ValueError(
            f'expected {N_CHANNELS} channels on axis -3, got shape {arr.shape}'
        )
    return vec.reshape((N_CHANNELS, 1, 1))


def normalise(physical: np.ndarray, clip: bool = True) -> np.ndarray:
    """Physical units -> [0, 1]. Channel axis is -3, so (..., 12, H, W)."""
    out = (physical.astype(np.float32) + _shape_for(physical, CHANNEL_OFFSET))
    out /= _shape_for(physical, CHANNEL_SCALE)
    return np.clip(out, 0.0, 1.0) if clip else out


def denormalise(normalised: np.ndarray) -> np.ndarray:
    """[0, 1] -> physical units. Inverse of normalise() up to clipping."""
    out = normalised.astype(np.float32) * _shape_for(normalised, CHANNEL_SCALE)
    return out - _shape_for(normalised, CHANNEL_OFFSET)


def spec_as_dict() -> dict:
    """Serialisable form, written into every dataset manifest."""
    return {
        'n_channels': N_CHANNELS,
        'grid': {'h': GRID_H, 'w': GRID_W},
        'formula': 'normalised = (physical + offset) / scale',
        'channels': [
            {
                'index': i,
                'name': CHANNEL_NAMES[i],
                'unit': CHANNEL_UNITS[i],
                'offset': float(CHANNEL_OFFSET[i]),
                'scale': float(CHANNEL_SCALE[i]),
            }
            for i in range(N_CHANNELS)
        ],
    }
