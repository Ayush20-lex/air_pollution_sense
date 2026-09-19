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
Scored by ml_pipeline/scripts/14_baselines.py over 3,891,185 comparisons from
1,157 origins across 68 CPCB stations, fitted on everything to 30 November 2025
and tested on December 2025 through September 2026 - a full annual cycle rather
than one winter month:

    mean(diurnal_persistence, bias-corrected CAMS)   RMSE  62.23 ug/m3   <- this
    diurnal persistence alone                        RMSE  67.15
    persistence                                      RMSE  82.65
    bias-corrected CAMS alone                        RMSE  83.41
    raw CAMS                                         RMSE  85.61

CAMS reproduces Delhi's diurnal shape but is biased, so it is rescaled by a
single factor fitted on the training window alone. The direction of that bias is
seasonal and is why the factor is stored per season: across the 2026 window it
fits 0.937 - CAMS runs slightly high - where the winter-only 2025 window fits
1.717, CAMS running badly low. On its own CAMS is the weaker parent, but its
errors are largely uncorrelated with persistence, so the mean of the two beats
both and beats raw CAMS by 25%.

The error barely moves with lead time, which is the part worth knowing: 63.3 at
+1-6h, 61.5 at +7-24h, 62.8 at +25-48h, 62.0 at +49-72h. Plain persistence
degrades from 65.5 to 86.8 over the same span. A 72-hour forecast that is no
worse than a 6-hour one is what makes it usable for a decision taken three days
out.

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
import pyarrow.parquet as pq

import observation_qc

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

#: What blend(diurnal_persistence, cams_bias) actually scored, per season, from
#: ml_pipeline/scripts/14_baselines.py. Keyed by season on purpose: this was a
#: bare 84.89 literal, measured on December 2025, sitting in a payload whose
#: season is configurable - point the service at another year and the figure
#: would have followed it unchanged and described nothing.
VALIDATED: dict[int, dict[str, object]] = {
    2025: {
        "validated_rmse_ugm3": 84.89,
        "beats_raw_cams_by": "30%",
        "scored_window": "December 2025",
        "scored_comparisons": 462_323,
    },
    2026: {
        "validated_rmse_ugm3": 62.23,
        "beats_raw_cams_by": "27%",
        # A full annual cycle rather than one winter month, which is the
        # stronger claim even though the number is lower: part of the drop is
        # simply that monsoon months are cleaner, not that the method improved.
        #
        # 66.35 before observation QC, 63.35 after, 62.23 once the archive was
        # topped up to 17 September. The QC step is the interesting one: dropping
        # 394 network-contradicted readings out of 925,344 moved it three points,
        # a reminder that a handful of faults can carry an error metric and that
        # the score has to be recomputed on the data actually served.
        "scored_window": "December 2025 - September 2026",
        "scored_comparisons": 3_891_185,
    },
}

#: Lowest boundary-layer height treated as physical, in metres.
PBL_FLOOR_M = 50.0

#: How much of a season the *service* loads, in days.
#:
#: Scoring reads the whole season; serving replays one origin and needs only a
#: 24-hour history behind it and a 72-hour lead ahead. Season 2026 spans 19
#: months, and loading all of it put the forecaster at 520 MB against Render's
#: 512 MB limit - every data endpoint returned 502 while /health, which loads
#: nothing, stayed green. Trimming to the tail keeps the same served origin and
#: the same numbers; it only discards history no request can reach.
SERVE_WINDOW_DAYS = 365

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

        # Columns and rows are both selected at read time, not after. The file
        # carries 21 columns over 925,344 rows and reading all of it cost 336 MB
        # - on its own two thirds of Render's 512 MB limit, and the reason every
        # data endpoint was returning 502 while /health stayed green. Twelve of
        # those columns are used.
        wanted = ["timestamp_utc", "location_id", "cams_pm2_5", *CHANNEL_SOURCE.values(),
                  "fcst_wind_speed_10m", "fcst_wind_direction_10m"]
        available = set(pq.ParquetFile(fc_path).schema.names)
        cols = [c for c in dict.fromkeys(wanted) if c in available]

        stamps = pd.read_parquet(fc_path, columns=["timestamp_utc"])
        last = pd.to_datetime(stamps.timestamp_utc, utc=True).max()
        del stamps
        cutoff = last.floor("h") - pd.Timedelta(days=SERVE_WINDOW_DAYS or 3650)

        fc = pd.read_parquet(fc_path, columns=cols,
                             filters=[("timestamp_utc", ">=", cutoff)])
        fc["timestamp_utc"] = pd.to_datetime(fc.timestamp_utc, utc=True).dt.floor("h")

        obs_files = sorted(
            (self.data / "raw" / "observations" / f"season={self.season}").glob("pm25_*.parquet")
        )
        # Filtered per file, then concatenated. Concatenating 68 whole-season
        # frames first and trimming after is what put the load at 520 MB against
        # Render's 512 MB limit: the peak is the intermediate, not what is kept.
        def _read_trimmed(path: Path) -> pd.DataFrame:
            d = pd.read_parquet(path, columns=["timestamp_utc", "location_id", "value"])
            d = d.dropna(subset=["value"])
            d["timestamp_utc"] = pd.to_datetime(d.timestamp_utc, utc=True).dt.floor("h")
            return d[d.timestamp_utc >= cutoff] if SERVE_WINDOW_DAYS else d

        obs = pd.concat([_read_trimmed(f) for f in obs_files], ignore_index=True)
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

        def pivot(df: pd.DataFrame, col: str, qc: bool = False) -> np.ndarray:
            """(n_times, n_stations), gaps filled so IDW weights stay constant.

            `qc` runs the network-contradiction filter before the gaps are
            closed, which is the only order that works: filling first would
            carry a faulty reading forward, and filtering after would leave a
            hole the fill had already papered over.
            """
            w = (df.pivot_table(index="timestamp_utc", columns="location_id", values=col,
                                aggfunc="mean")
                   .reindex(index=self.times, columns=ids))
            if qc:
                w = pd.DataFrame(
                    observation_qc.despike(w.to_numpy(dtype=np.float32), col),
                    index=w.index, columns=w.columns,
                )
            return w.ffill().bfill().to_numpy(dtype=np.float32)

        # Observations only. CAMS is a model field and has no faulty sensor.
        self.obs_pm25 = pivot(obs.rename(columns={"value": "pm25"}), "pm25", qc=True)
        self.fields = {ch: pivot(fc, col) for ch, col in CHANNEL_SOURCE.items()
                       if col in fc.columns}

        # The archive reports boundary-layer heights down to 10 m, which the
        # inversion endpoint was passing through as `pbl_min: 14.0`. A real
        # nocturnal layer over Delhi bottoms out near 50 m; below that the
        # reanalysis is reporting its own floor, not the atmosphere. Clamping
        # here keeps every consumer physical - ISI divides by this, so a 10 m
        # layer makes the inversion index saturate on a model artefact.
        if CH_PBL in self.fields:
            self.fields[CH_PBL] = np.maximum(self.fields[CH_PBL], PBL_FLOOR_M)
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

        # Per season first. The CAMS scale is fitted on one season's training
        # window and does not transfer: 2025 fits 1.717 (winter, CAMS runs low)
        # and 2026 fits 0.937. Serving one season under the other's correction
        # is an 83% error applied silently to every value, which is exactly
        # what a single shared file invites.
        corr_path = self.data / "processed" / f"baseline_corrections_{self.season}.json"
        if not corr_path.exists():
            corr_path = self.data / "processed" / "baseline_corrections.json"
            if corr_path.exists():
                logger.warning(
                    "no corrections for season %d; falling back to the shared file, "
                    "whose scale was fitted on a different window", self.season,
                )
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
            **VALIDATED.get(self.season, {}),
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
