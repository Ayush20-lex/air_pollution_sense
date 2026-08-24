"""
Module 2 — Spatial Fusion & Interpolation Engine
SIH26082 · MoES / NCMRWF
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd
import geopandas as gpd
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
from pyproj import Transformer
from shapely.geometry import Point, MultiPoint

warnings.filterwarnings("ignore", category=FutureWarning)

# ── NCR Bounding Box ──────────────────────────────────────────────────────────
NCR_LAT_MIN, NCR_LAT_MAX = 28.20, 28.90
NCR_LON_MIN, NCR_LON_MAX = 76.80, 77.60
GRID_H, GRID_W = 70, 80          # ~1 km × 1 km cells
EARTH_R_KM = 6371.0

# WGS-84 → local Cartesian (UTM 43N covers Delhi NCR)
_WGS84_TO_UTM43N = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
_UTM43N_TO_WGS84 = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)


@dataclass
class GridSpec:
    """Immutable 70×80 grid definition for Delhi NCR."""
    lat_min: float = NCR_LAT_MIN
    lat_max: float = NCR_LAT_MAX
    lon_min: float = NCR_LON_MIN
    lon_max: float = NCR_LON_MAX
    h: int = GRID_H
    w: int = GRID_W

    @property
    def lat_vec(self) -> np.ndarray:
        return np.linspace(self.lat_min, self.lat_max, self.h)

    @property
    def lon_vec(self) -> np.ndarray:
        return np.linspace(self.lon_min, self.lon_max, self.w)

    @property
    def grid_lons(self) -> np.ndarray:          # (H, W)
        _, lons = np.meshgrid(self.lat_vec, self.lon_vec, indexing="ij")
        return lons

    @property
    def grid_lats(self) -> np.ndarray:          # (H, W)
        lats, _ = np.meshgrid(self.lat_vec, self.lon_vec, indexing="ij")
        return lats

    def to_utm(self) -> tuple[np.ndarray, np.ndarray]:
        """Return (easting, northing) grids in UTM 43N metres."""
        e, n = _WGS84_TO_UTM43N.transform(self.grid_lons, self.grid_lats)
        return e, n


_GRID = GridSpec()


class SpatialDataFusion:
    """
    Fuses heterogeneous geospatial pollution data onto a uniform 70×80 NCR grid.

    Parameters
    ----------
    grid : GridSpec
        Target grid definition.
    idw_power : float
        Power parameter for IDW (default 2.0 — quadratic decay).
    idw_smoothing : float
        Smoothing factor for RBFInterpolator fallback.
    """

    def __init__(
        self,
        grid: GridSpec = _GRID,
        idw_power: float = 2.0,
        idw_smoothing: float = 0.0,
    ) -> None:
        self.grid = grid
        self.idw_power = idw_power
        self.idw_smoothing = idw_smoothing

        # Pre-compute target grid in UTM (flat-Earth for interpolation accuracy)
        e, n = grid.to_utm()
        self._target_xy = np.column_stack([e.ravel(), n.ravel()])  # (H*W, 2)

    # ── IDW Interpolation ─────────────────────────────────────────────────────

    def idw_interpolate(
        self,
        obs_df: pd.DataFrame,
        value_col: str,
        lat_col: str = "lat",
        lon_col: str = "lon",
        n_neighbours: int = 8,
    ) -> np.ndarray:
        """
        Inverse Distance Weighting interpolation.

        Parameters
        ----------
        obs_df : DataFrame with columns [lat_col, lon_col, value_col].
        value_col : Column name of the scalar to interpolate.
        n_neighbours : Number of nearest stations used per target point.

        Returns
        -------
        grid : float32 ndarray of shape (H, W).
        """
        obs = obs_df.dropna(subset=[lat_col, lon_col, value_col]).copy()
        if len(obs) < 2:
            return np.full((self.grid.h, self.grid.w), np.nan, dtype=np.float32)

        src_e, src_n = _WGS84_TO_UTM43N.transform(obs[lon_col].values, obs[lat_col].values)
        src_xy = np.column_stack([src_e, src_n])
        values = obs[value_col].values.astype(np.float64)

        tree = cKDTree(src_xy)
        dists, idxs = tree.query(self._target_xy, k=min(n_neighbours, len(obs)))

        # Avoid division by zero for exact station hits
        dists = np.where(dists == 0, 1e-10, dists)
        weights = 1.0 / (dists ** self.idw_power)
        weighted_vals = (weights * values[idxs]).sum(axis=1) / weights.sum(axis=1)

        return weighted_vals.reshape(self.grid.h, self.grid.w).astype(np.float32)

    # ── Kriging via RBF (Ordinary Kriging approximation) ─────────────────────

    def kriging_interpolate(
        self,
        obs_df: pd.DataFrame,
        value_col: str,
        lat_col: str = "lat",
        lon_col: str = "lon",
        kernel: Literal["thin_plate_spline", "gaussian", "multiquadric"] = "thin_plate_spline",
    ) -> np.ndarray:
        """
        Ordinary Kriging via scipy RBFInterpolator.

        Returns
        -------
        grid : float32 ndarray of shape (H, W).
        """
        obs = obs_df.dropna(subset=[lat_col, lon_col, value_col]).copy()
        if len(obs) < 4:
            return self.idw_interpolate(obs_df, value_col, lat_col, lon_col)

        src_e, src_n = _WGS84_TO_UTM43N.transform(obs[lon_col].values, obs[lat_col].values)
        src_xy = np.column_stack([src_e, src_n])
        values = obs[value_col].values.astype(np.float64)

        rbf = RBFInterpolator(
            src_xy, values,
            kernel=kernel,
            smoothing=self.idw_smoothing,
            epsilon=1.0,
        )
        result = rbf(self._target_xy)
        return result.reshape(self.grid.h, self.grid.w).astype(np.float32)

    # ── NASA FIRMS Fire Transport Vectors ─────────────────────────────────────

    def compute_fire_transport(
        self,
        firms_df: pd.DataFrame,
        u_wind_ms: float,
        v_wind_ms: float,
        forecast_hours: int = 72,
        lat_col: str = "latitude",
        lon_col: str = "longitude",
        frp_col: str = "frp",
    ) -> dict[str, np.ndarray]:
        """
        Computes stubble smoke transport vectors from Punjab/Haryana fire pixels
        toward Delhi NCR for a given U/V wind field.

        Parameters
        ----------
        firms_df : NASA FIRMS DataFrame with lat, lon, FRP columns.
        u_wind_ms : Zonal wind (m/s), positive = eastward.
        v_wind_ms : Meridional wind (m/s), positive = northward.
        forecast_hours : Advection time window.

        Returns
        -------
        dict with keys:
            'frp_grid'      : (H, W) fire radiative power on NCR grid
            'plume_arrival' : (H, W) hours until plume arrives (inf = no arrival)
            'smoke_intensity': (H, W) PM2.5 contribution proxy (µg/m³)
        """
        if firms_df.empty:
            zeros = np.zeros((self.grid.h, self.grid.w), dtype=np.float32)
            return {"frp_grid": zeros, "plume_arrival": np.full_like(zeros, np.inf), "smoke_intensity": zeros}

        wind_speed = np.hypot(u_wind_ms, v_wind_ms)  # m/s
        wind_speed = max(wind_speed, 0.1)             # guard division by zero

        # Wind direction unit vector (toward which the plume travels)
        u_hat, v_hat = u_wind_ms / wind_speed, v_wind_ms / wind_speed

        ncr_center_lat = (NCR_LAT_MIN + NCR_LAT_MAX) / 2
        ncr_center_lon = (NCR_LON_MIN + NCR_LON_MAX) / 2

        fire_lats = firms_df[lat_col].values
        fire_lons = firms_df[lon_col].values
        fire_frp = firms_df[frp_col].fillna(0).values.astype(np.float32)

        # Haversine distance from each fire pixel to NCR centre
        dlat = np.radians(ncr_center_lat - fire_lats)
        dlon = np.radians(ncr_center_lon - fire_lons)
        a = (np.sin(dlat / 2) ** 2
             + np.cos(np.radians(fire_lats))
             * np.cos(np.radians(ncr_center_lat))
             * np.sin(dlon / 2) ** 2)
        dist_km = 2 * EARTH_R_KM * np.arcsin(np.sqrt(a))

        # Bearing from fire to NCR (deg clockwise from north)
        bearing = np.degrees(np.arctan2(
            np.sin(np.radians(ncr_center_lon - fire_lons))
            * np.cos(np.radians(ncr_center_lat)),
            np.cos(np.radians(fire_lats))
            * np.sin(np.radians(ncr_center_lat))
            - np.sin(np.radians(fire_lats))
            * np.cos(np.radians(ncr_center_lat))
            * np.cos(np.radians(ncr_center_lon - fire_lons))
        ))

        # Wind alignment score: cos(angle between wind direction and fire→NCR vector)
        wind_bearing = np.degrees(np.arctan2(u_hat, v_hat))
        alignment = np.cos(np.radians(bearing - wind_bearing))

        # Arrival time: only fires with positive alignment reach NCR
        wind_speed_km_h = wind_speed * 3.6
        arrival_h = np.where(
            alignment > 0.3,
            dist_km / (wind_speed_km_h * alignment + 1e-6),
            np.inf
        )

        # PM2.5 contribution proxy (dimensionless FRP-derived field).
        # frp_aligned_proxy = FRP (MW) × alignment_factor × Gaussian_decay
        # Units: proportional to MW, NOT µg/m³.
        # This field serves as a smoke transport signal for the model;
        # it cannot be interpreted as a physical PM2.5 concentration without
        # an emission factor calibration (future work).
        sigma_km = 80.0
        frp_aligned_proxy = (fire_frp * np.maximum(alignment, 0)
                             * np.exp(-0.5 * (dist_km / sigma_km) ** 2))

        # Interpolate FRP and smoke proxy onto NCR grid
        fire_df = pd.DataFrame({
            "lat": fire_lats, "lon": fire_lons,
            "frp": fire_frp, "frp_aligned_proxy": frp_aligned_proxy,
        })
        frp_grid   = self.idw_interpolate(fire_df, "frp")
        smoke_grid = self.idw_interpolate(fire_df, "frp_aligned_proxy")

        # Minimum arrival time field (select minimum across all fire sources)
        arrival_grid = np.full((self.grid.h, self.grid.w), np.inf, dtype=np.float32)
        if np.any(arrival_h < forecast_hours):
            active = fire_df.copy()
            active["arrival"] = arrival_h
            valid = active[active["arrival"] < forecast_hours]
            if not valid.empty:
                arr_idw = self.idw_interpolate(valid, "arrival")
                arrival_grid = np.where(arr_idw < arrival_grid, arr_idw, arrival_grid)

        return {
            "frp_grid":          frp_grid,
            "plume_arrival":     arrival_grid.astype(np.float32),
            "frp_aligned_proxy": smoke_grid.astype(np.float32),  # renamed from smoke_intensity
        }

    # ── Full Grid Tensor Builder ───────────────────────────────────────────────

    def build_channel_stack(
        self,
        cpcb_df: pd.DataFrame,
        imd_grids: dict[str, np.ndarray],
        firms_transport: dict[str, np.ndarray],
        method: Literal["idw", "kriging"] = "idw",
    ) -> np.ndarray:
        """
        Builds a single-timestep 12-channel feature tensor (C, H, W).

        Channel order:
            0: PM2.5      1: PM10       2: O3         3: NOx
            4: U-wind     5: V-wind     6: Temp       7: RH
            8: Solar Irr  9: PBL Height 10: FRP       11: Smoke Intensity

        Parameters
        ----------
        cpcb_df : Station obs with [lat, lon, pm25, pm10, o3, nox].
        imd_grids : Pre-gridded met fields keyed by channel name.
        firms_transport : Output from compute_fire_transport().

        Returns
        -------
        tensor : float32 ndarray shape (12, H, W).
        """
        interp = self.kriging_interpolate if method == "kriging" else self.idw_interpolate

        channels = [
            interp(cpcb_df, "pm25"),
            interp(cpcb_df, "pm10"),
            interp(cpcb_df, "o3"),
            interp(cpcb_df, "nox"),
            imd_grids.get("u_wind",    np.zeros((GRID_H, GRID_W), np.float32)),
            imd_grids.get("v_wind",    np.zeros((GRID_H, GRID_W), np.float32)),
            imd_grids.get("temp",      np.zeros((GRID_H, GRID_W), np.float32)),
            imd_grids.get("rh",        np.zeros((GRID_H, GRID_W), np.float32)),
            imd_grids.get("solar_irr", np.zeros((GRID_H, GRID_W), np.float32)),
            imd_grids.get("pbl",       np.zeros((GRID_H, GRID_W), np.float32)),
            firms_transport.get("frp_grid",          np.zeros((GRID_H, GRID_W), np.float32)),
            firms_transport.get("frp_aligned_proxy", np.zeros((GRID_H, GRID_W), np.float32)),
        ]
        stack = np.stack(channels, axis=0)  # (12, H, W)

        # NaN fill: nearest-neighbour propagation
        for c in range(stack.shape[0]):
            nan_mask = np.isnan(stack[c])
            if nan_mask.any():
                valid_y, valid_x = np.where(~nan_mask)
                if len(valid_y):
                    nan_y, nan_x = np.where(nan_mask)
                    tree = cKDTree(np.column_stack([valid_y, valid_x]))
                    _, nn_idx = tree.query(np.column_stack([nan_y, nan_x]))
                    stack[c][nan_y, nan_x] = stack[c][valid_y[nn_idx], valid_x[nn_idx]]
                else:
                    stack[c] = 0.0

        return stack.astype(np.float32)


# ── Mock data factory for jury demonstration ──────────────────────────────────

def generate_mock_cpcb_df(n_stations: int = 35, timestamp: str | None = None) -> pd.DataFrame:
    """Returns a realistic mock CPCB observation DataFrame for Delhi NCR."""
    rng = np.random.default_rng(seed=42)
    lats = rng.uniform(NCR_LAT_MIN + 0.05, NCR_LAT_MAX - 0.05, n_stations)
    lons = rng.uniform(NCR_LON_MIN + 0.05, NCR_LON_MAX - 0.05, n_stations)
    pm25 = rng.uniform(180, 480, n_stations)
    return pd.DataFrame({
        "station_id": [f"NCR_{i:03d}" for i in range(n_stations)],
        "lat": lats, "lon": lons,
        "pm25": pm25.astype(np.float32),
        "pm10": (pm25 * rng.uniform(1.4, 1.8, n_stations)).astype(np.float32),
        "o3": rng.uniform(20, 90, n_stations).astype(np.float32),
        "nox": rng.uniform(40, 200, n_stations).astype(np.float32),
        "timestamp": timestamp or pd.Timestamp.utcnow().isoformat(),
    })


def fetch_live_cpcb_waqi_df(token: str) -> pd.DataFrame:
    """Fetches real-time AQI data from WAQI (AQICN) API for Delhi NCR."""
    import urllib.request
    import json
    from concurrent.futures import ThreadPoolExecutor

    bounds_url = f"https://api.waqi.info/map/bounds?latlng={NCR_LAT_MIN},{NCR_LON_MIN},{NCR_LAT_MAX},{NCR_LON_MAX}&token={token}"
    
    try:
        req = urllib.request.urlopen(bounds_url)
        data = json.loads(req.read())
        stations = data.get("data", [])
        uids = [st["uid"] for st in stations if str(st.get("uid")).isdigit()]
    except Exception as e:
        print(f"WAQI bounds fetch failed: {e}")
        return generate_mock_cpcb_df()

    if not uids:
        return generate_mock_cpcb_df()

    def get_station(uid):
        try:
            url = f"https://api.waqi.info/feed/@{uid}/?token={token}"
            res = urllib.request.urlopen(url)
            return json.loads(res.read()).get("data", {})
        except Exception:
            return {}

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(get_station, uids))

    records = []
    for r in results:
        if not r or "iaqi" not in r or "city" not in r:
            continue
        
        geo = r["city"].get("geo", [0, 0])
        iaqi = r["iaqi"]
        
        # AQICN unit note:
        # iaqi.pm25.v is the PM2.5 AQI sub-index (0–500 dimensionless),
        # NOT a raw concentration in µg/m³.
        # We apply an approximate inverse of the Indian CPCB PM2.5 breakpoints
        # (piecewise linear) to recover a concentration estimate.
        # This is an approximation; accuracy depends on local AQI standard used.
        def aqi_to_pm25_approx(aqi_val: float) -> float:
            """Approximate inversion of Indian CPCB AQI → PM2.5 µg/m³."""
            # Breakpoints: (I_lo, I_hi, C_lo, C_hi)
            bp = [
                (0,   50,  0.0,  30.0),
                (51,  100, 30.1, 60.0),
                (101, 200, 60.1, 90.0),
                (201, 300, 90.1, 120.0),
                (301, 400, 120.1, 250.0),
                (401, 500, 250.1, 350.0),
            ]
            for I_lo, I_hi, C_lo, C_hi in bp:
                if I_lo <= aqi_val <= I_hi:
                    return C_lo + (aqi_val - I_lo) * (C_hi - C_lo) / (I_hi - I_lo)
            return 350.0  # above 500 AQI, cap at 350 µg/m³

        pm25_aqi = float(iaqi.get("pm25", {}).get("v", 0))
        pm25 = aqi_to_pm25_approx(pm25_aqi)   # convert AQI index → µg/m³

        pm10_aqi = float(iaqi.get("pm10", {}).get("v", 0))
        pm10 = pm25 * 1.5 if pm10_aqi == 0 else aqi_to_pm25_approx(pm10_aqi)

        o3 = float(iaqi.get("o3", {}).get("v", 40.0))    # O3 AQI as proxy
        nox = float(iaqi.get("no2", {}).get("v", 50.0))  # NO2 as NOx proxy
        
        records.append({
            "station_id": str(r.get("idx", "")),
            "lat": geo[0],
            "lon": geo[1],
            "pm25": float(pm25),
            "pm10": float(pm10),
            "o3": float(o3),
            "nox": float(nox),
            "timestamp": pd.Timestamp.utcnow().isoformat(),
        })

    if not records:
        return generate_mock_cpcb_df()

    return pd.DataFrame(records).astype({
        "pm25": np.float32, 
        "pm10": np.float32, 
        "o3": np.float32, 
        "nox": np.float32
    })


def generate_mock_firms_df(n_fires: int = 450) -> pd.DataFrame:
    """Returns mock NASA FIRMS fire pixel data for Punjab/Haryana."""
    rng = np.random.default_rng(seed=7)
    return pd.DataFrame({
        "latitude":  rng.uniform(29.5, 31.5, n_fires),
        "longitude": rng.uniform(74.5, 76.5, n_fires),
        "frp":       rng.exponential(scale=35, size=n_fires).astype(np.float32),
        "acq_date":  pd.Timestamp.utcnow().date(),
    })
