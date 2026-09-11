"""
Module: Blend Baseline Forecaster
SIH26082 · MoES / NCMRWF

Produces a real 72-hour forecast tensor without a trained network, so the API can
serve something defensible while the coupled model is still being trained.

Why this exists
---------------
`api_server._generate_forecast_tensor` currently builds its input from mock CPCB
data, mock FIRMS data and `np.random.uniform` meteorology, then runs it through a
network whose weights were never trained. Every number it returns is noise. This
module replaces the *values* with measurements and a scored forecast, using the
same tensor contract, so no endpoint or frontend code has to change.

The method
----------
Scored over 480,283 forecasts from 112 origins across 68 CPCB stations
(ml_pipeline/scripts/14_baselines.py), December 2025 held out:

    mean(diurnal_persistence, bias-corrected CAMS)   RMSE  84.89 ug/m3   <- this
    diurnal persistence alone                        RMSE  99.34
    bias-corrected CAMS alone                        RMSE 113.81
    raw CAMS                                         RMSE 120.81
    persistence                                      RMSE 123.48

CAMS reproduces Delhi's diurnal shape but runs ~42% low, so it is rescaled by a
factor fitted on October-November only. On its own it is the weaker signal, but
its errors are largely uncorrelated with persistence, so the mean of the two
beats both parents by 15% and beats raw CAMS by 30%.

Honesty of the output
---------------------
PM2.5 comes from the blend. PM10, O3 and NO2 come from CAMS. Temperature, RH,
shortwave, PBL and the wind components come from the archived weather forecast.
FRP and smoke are zero — there is no live FIRMS feed, and a fabricated fire field
would be exactly the kind of number this module exists to remove. `describe()`
reports which channels are real so the caller can surface it.

This replays a real period from the archive rather than fetching live data, so
`meta['mode']` is 'archive_replay'. That is a demo posture, not a live one, and
callers should say so.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger("baseline_forecaster")

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA = REPO_ROOT / "ml_pipeline" / "data"

GRID_H, GRID_W = 70, 80
N_CHANNELS = 12
HORIZON = 72

#: Denormalisation vector used by api_server._tensor_to_geojson. The tensor this
#: module returns must be in the same normalised space as the model's output.
CHANNEL_NORMS = np.array(
    [500, 700, 120, 250, 20, 20, 40, 100, 1200, 3000, 200, 300], dtype=np.float32
)

CH_PM25, CH_PM10, CH_O3, CH_NOX = 0, 1, 2, 3
CH_U, CH_V, CH_TEMP, CH_RH, CH_SOLAR, CH_PBL = 4, 5, 6, 7, 8, 9
CH_FRP, CH_SMOKE = 10, 11

#: Forecast-parquet column feeding each channel. PM2.5 is absent because it is
#: produced by the blend rather than copied from any single source.
CHANNEL_SOURCE: dict[int, str] = {
    CH_PM10: "cams_pm10",
    CH_O3: "cams_ozone",
    CH_NOX: "cams_nitrogen_dioxide",
    CH_TEMP: "fcst_temperature_2m",
    CH_RH: "fcst_relative_humidity_2m",
    CH_SOLAR: "fcst_shortwave_radiation",
    CH_PBL: "fcst_boundary_layer_height",
}

REAL_CHANNELS = sorted({CH_PM25, CH_U, CH_V, *CHANNEL_SOURCE})
SYNTHETIC_CHANNELS = [CH_FRP, CH_SMOKE]


@dataclass
class ForecastResult:
    tensor: np.ndarray          # (HORIZON, 12, 70, 80), normalised
    origin: pd.Timestamp
    meta: dict


class BlendBaselineForecaster:
    """Gridded 72-hour forecast from station observations plus archived CAMS."""

    def __init__(self, season: int = 2025, data_dir: Path | None = None) -> None:
        self.season = season
        self.data = data_dir or DATA
        self._load()
        self._precompute_idw()

    # ── loading ───────────────────────────────────────────────────────────────

    def _load(self) -> None:
        cat_path = self.data / "raw" / "stations" / "catalog.json"
        catalog = json.loads(cat_path.read_text(encoding="utf-8"))
        coords = {
            s["location_id"]: (s["latitude"], s["longitude"])
            for s in catalog["stations"]
            if s.get("latitude") is not None
        }

        fc_path = self.data / "raw" / "forecast" / f"forecast_{self.season}.parquet"
        fc = pd.read_parquet(fc_path)
        fc["timestamp_utc"] = pd.to_datetime(fc.timestamp_utc, utc=True).dt.floor("h")

        obs_files = sorted(
            (self.data / "raw" / "observations" / f"season={self.season}").glob("pm25_*.parquet")
        )
        obs = pd.concat(
            [pd.read_parquet(f, columns=["timestamp_utc", "location_id", "value"]) for f in obs_files]
        ).dropna(subset=["value"])
        obs["timestamp_utc"] = pd.to_datetime(obs.timestamp_utc, utc=True).dt.floor("h")
        obs = obs.groupby(["location_id", "timestamp_utc"], as_index=False)["value"].mean()

        # Stations present in the forecast, the observations and the catalogue.
        ids = sorted(set(coords) & set(fc.location_id) & set(obs.location_id))
        if not ids:
            raise RuntimeError("no station overlaps observations, forecast and catalogue")
        self.station_ids = ids
        self.lats = np.array([coords[i][0] for i in ids], dtype=np.float64)
        self.lons = np.array([coords[i][1] for i in ids], dtype=np.float64)

        self.times = pd.date_range(fc.timestamp_utc.min(), fc.timestamp_utc.max(),
                                   freq="h", tz="UTC")
        self._t_index = {t: i for i, t in enumerate(self.times)}

        def pivot(df: pd.DataFrame, col: str) -> np.ndarray:
            """(n_times, n_stations), gaps filled so IDW weights stay constant."""
            w = (df.pivot_table(index="timestamp_utc", columns="location_id", values=col,
                                aggfunc="mean")
                   .reindex(index=self.times, columns=ids))
            return w.ffill().bfill().to_numpy(dtype=np.float32)

        self.obs_pm25 = pivot(obs.rename(columns={"value": "pm25"}), "pm25")
        self.fields = {ch: pivot(fc, col) for ch, col in CHANNEL_SOURCE.items()
                       if col in fc.columns}
        self.cams_pm25 = pivot(fc, "cams_pm2_5")

        # Wind speed/direction -> u, v components (meteorological convention:
        # direction is where the wind blows FROM).
        if {"fcst_wind_speed_10m", "fcst_wind_direction_10m"} <= set(fc.columns):
            spd = pivot(fc, "fcst_wind_speed_10m")
            drc = np.deg2rad(pivot(fc, "fcst_wind_direction_10m"))
            self.u = (-spd * np.sin(drc)).astype(np.float32)
            self.v = (-spd * np.cos(drc)).astype(np.float32)
        else:
            self.u = self.v = None

        corr_path = self.data / "processed" / "baseline_corrections.json"
        if corr_path.exists():
            self.scale = float(json.loads(corr_path.read_text())["global_scale"])
        else:
            # Fit here if 14_baselines.py has not been run.
            ok = np.isfinite(self.obs_pm25) & np.isfinite(self.cams_pm25) & (self.cams_pm25 > 0)
            self.scale = float(self.obs_pm25[ok].sum() / self.cams_pm25[ok].sum()) if ok.any() else 1.0
            logger.warning("baseline_corrections.json missing; fitted scale in-place (%.3f)",
                           self.scale)

        logger.info("baseline forecaster ready: %d stations, %d hours, CAMS scale %.3f",
                    len(ids), len(self.times), self.scale)

    # ── gridding ──────────────────────────────────────────────────────────────

    def _precompute_idw(self, k: int = 8, power: float = 2.0) -> None:
        """Station positions are fixed, so the IDW weights are computed once.

        Gridding any hour then costs one weighted sum instead of rebuilding a
        KD-tree 720 times per forecast.
        """
        from pyproj import Transformer
        from scipy.spatial import cKDTree

        lat_min, lat_max = 28.20, 28.90
        lon_min, lon_max = 76.80, 77.60
        to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)

        glon, glat = np.meshgrid(
            np.linspace(lon_min, lon_max, GRID_W),
            np.linspace(lat_min, lat_max, GRID_H),
        )
        ge, gn = to_utm.transform(glon.ravel(), glat.ravel())
        se, sn = to_utm.transform(self.lons, self.lats)

        tree = cKDTree(np.column_stack([se, sn]))
        dist, idx = tree.query(np.column_stack([ge, gn]), k=min(k, len(self.lats)))
        dist = np.where(dist == 0, 1e-10, dist)
        w = 1.0 / dist ** power
        self._idw_idx = idx
        self._idw_w = (w / w.sum(axis=1, keepdims=True)).astype(np.float32)

    def _to_grid(self, values: np.ndarray) -> np.ndarray:
        """(n_stations,) station values -> (70, 80) field."""
        return (values[self._idw_idx] * self._idw_w).sum(axis=1).reshape(GRID_H, GRID_W)

    # ── forecasting ───────────────────────────────────────────────────────────

    def valid_origins(self) -> pd.DatetimeIndex:
        """Origins with 24 h of history behind and 72 h of forecast ahead."""
        return self.times[24: len(self.times) - HORIZON]

    def forecast(self, origin: pd.Timestamp | None = None) -> ForecastResult:
        origins = self.valid_origins()
        if origin is None:
            origin = origins[-1]
        origin = pd.Timestamp(origin).tz_convert("UTC").floor("h")
        if origin not in self._t_index:
            raise ValueError(f"origin {origin} outside the archive")
        t0 = self._t_index[origin]
        if t0 < 24 or t0 + HORIZON >= len(self.times):
            raise ValueError(f"origin {origin} lacks 24 h history or 72 h lead")

        out = np.zeros((HORIZON, N_CHANNELS, GRID_H, GRID_W), dtype=np.float32)

        for lead in range(1, HORIZON + 1):
            t = t0 + lead
            # PM2.5: mean of "same hour yesterday" and rescaled CAMS.
            diurnal = self.obs_pm25[t - 24]
            cams = self.cams_pm25[t] * self.scale
            blend = np.where(np.isfinite(diurnal) & np.isfinite(cams),
                             (diurnal + cams) / 2.0,
                             np.where(np.isfinite(diurnal), diurnal, cams))
            out[lead - 1, CH_PM25] = self._to_grid(np.nan_to_num(blend))

            for ch, series in self.fields.items():
                out[lead - 1, ch] = self._to_grid(np.nan_to_num(series[t]))

            if self.u is not None:
                out[lead - 1, CH_U] = self._to_grid(np.nan_to_num(self.u[t]))
                out[lead - 1, CH_V] = self._to_grid(np.nan_to_num(self.v[t]))
            # FRP and smoke stay zero: no live fire feed, and inventing one is
            # precisely what this module exists to avoid.

        out /= CHANNEL_NORMS[None, :, None, None]

        meta = {
            "method": "blend(diurnal_persistence, cams_bias)",
            "mode": "archive_replay",
            "season": self.season,
            "origin": origin.isoformat(),
            "cams_scale": round(self.scale, 4),
            "stations": len(self.station_ids),
            "validated_rmse_ugm3": 84.89,
            "beats_raw_cams_by": "30%",
            "real_channels": REAL_CHANNELS,
            "synthetic_channels": SYNTHETIC_CHANNELS,
        }
        return ForecastResult(tensor=out, origin=origin, meta=meta)

    def describe(self) -> dict:
        return {
            "stations": len(self.station_ids),
            "hours_available": len(self.times),
            "first_origin": str(self.valid_origins()[0]),
            "last_origin": str(self.valid_origins()[-1]),
            "cams_scale": round(self.scale, 4),
            "real_channels": REAL_CHANNELS,
            "synthetic_channels": SYNTHETIC_CHANNELS,
        }


_singleton: BlendBaselineForecaster | None = None


def get_forecaster(season: int = 2025) -> BlendBaselineForecaster:
    """Process-wide instance — loading the archive takes a moment."""
    global _singleton
    if _singleton is None or _singleton.season != season:
        _singleton = BlendBaselineForecaster(season=season)
    return _singleton
