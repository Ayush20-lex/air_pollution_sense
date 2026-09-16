"""
Module 5 — High-Performance FastAPI Inference Server
SIH26082 · MoES / NCMRWF

Run:
    uvicorn api_server:app --host 0.0.0.0 --port 8000 --workers 2

Endpoints:
    GET /api/v1/forecast/grid           → 72h spatial forecast GeoJSON
    GET /api/v1/forecast/station/{id}   → Station time-series vector
    GET /api/v1/alerts/inversion        → Active inversion risk zones
    GET /health                         → Liveness probe
    WS  /ws/live                        → 100ms push stream (delta)
"""
from __future__ import annotations

import asyncio
import gzip
import json
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

# Local modules
from spatial_fusion import (
    SpatialDataFusion,
    GridSpec,
    generate_mock_cpcb_df,
    fetch_live_cpcb_waqi_df,
    generate_mock_firms_df,
    NCR_LAT_MIN, NCR_LAT_MAX, NCR_LON_MIN, NCR_LON_MAX,
    GRID_H, GRID_W,
)
from coupled_model import (
    AirPollutionCoupledForecaster,
    N_CHANNELS, N_STEPS,
    CH_PM25, CH_PBL, CH_SOLAR, CH_TEMP, CH_UWIND, CH_VWIND,
)
from physics_loss import compute_isi
from grap_policy import calculate_indian_aqi_pm25, evaluate_grap_stage
import gfs_reader


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    redis_url:      str   = "redis://localhost:6379/0"
    db_url:         str   = "sqlite:///delhi_aqi.db"
    device:         str   = "cuda" if torch.cuda.is_available() else "cpu"
    cache_ttl_s:    int   = 900
    mock_mode:      bool  = False
    model_path:     str   = "weights/forecaster_v1.pt"
    log_level:      str   = "info"
    # ── REQUIRED: set AQICN_TOKEN in your .env file ──────────────────────────
    # Do NOT commit a real token value here.
    aqicn_token:    str   = ""
    # Serve the scored blend baseline while the network has no trained weights.
    # Its output is measurements and an evaluated forecast (RMSE 84.89 ug/m3,
    # 30% better than raw CAMS) instead of random-weight noise. Set false to see
    # the untrained model's raw output.
    use_baseline:   bool  = True
    baseline_season: int  = 2025

    class Config:
        env_file = ".env"
        extra   = "ignore"

@lru_cache
def get_settings() -> Settings:
    return Settings()


# ── App State ────────────────────────────────────────────────────────────────

import logging as _logging
_log = _logging.getLogger("api_server")

# Channel normalisation constants — MUST match FeedbackCouplingModule.*_NORM
# and coupled_model.py channel order: [pm25, pm10, o3, nox, u, v, temp, rh, solar, pbl, frp, smoke]
_CHANNEL_NORMS = np.array(
    [500.0, 700.0, 120.0, 250.0, 20.0, 20.0, 40.0, 100.0, 1200.0, 3000.0, 200.0, 300.0],
    dtype=np.float32,
)


class AppState:
    model:          AirPollutionCoupledForecaster | None = None
    fusion:         SpatialDataFusion | None = None
    cache:          dict[str, tuple[float, Any]] = {}   # key → (timestamp, value)
    # Weight / data-mode truth fields
    weights_loaded: bool = False   # True only when a real .pt file was loaded
    weights_path:   str  = ""
    started_at:     str  = ""
    data_mode:      str  = "unknown"  # "live", "synthetic", or "mixed"
    # Set when a forecast came from the blend baseline rather than the network,
    # so /api/v1/status can say which produced the numbers on screen.
    forecast_meta:  dict | None = None


_state = AppState()


# ── Synthetic History Builder (DEMO / PROTOTYPE) ───────────────────────────────

def _build_synthetic_history(
    frame_norm: np.ndarray,
    n_steps: int = 24,
    jitter_sigma: float = 0.02,
    seed: int = 99,
) -> np.ndarray:
    """
    Builds a SYNTHETIC (prototype / demo) n-step historical context by
    adding small Gaussian jitter to the current normalised observation frame.

    ⚠  DATA INTEGRITY WARNING:
        This is NOT real historical data.  The LSTM encoder receives
        near-identical frames and will not capture genuine temporal
        dynamics.  Outputs produced from this context MUST be treated as
        prototype / demonstration data, not operational forecasts.

    Future integration stub
    -----------------------
    Replace the return value of this function with a real (T, C, H, W)
    float32 array of normalised historical observations sorted oldest-first.
    The shape must be (n_steps, C, H, W) and values must be divided by
    _CHANNEL_NORMS before being passed here.

    Parameters
    ----------
    frame_norm   : Current-step normalised frame, shape (C, H, W).
    n_steps      : Context length (default 24 = 24-hour look-back).
    jitter_sigma : Noise std dev in normalised units (default 0.02).
    seed         : Fixed seed for reproducibility of the synthetic context.

    Returns
    -------
    history : float32 ndarray of shape (n_steps, C, H, W).
              Context source is always "synthetic" when this function is used.
    """
    rng = np.random.default_rng(seed=seed)
    return np.stack(
        [
            frame_norm + rng.normal(0, jitter_sigma, frame_norm.shape).astype(np.float32)
            for _ in range(n_steps)
        ],
        axis=0,
    )  # (n_steps, C, H, W)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    log = logging.getLogger("api_server")

    cfg = get_settings()
    _state.started_at = datetime.now(timezone.utc).isoformat()
    _state.fusion = SpatialDataFusion()
    _state.model  = AirPollutionCoupledForecaster(
        in_channels=N_CHANNELS, hidden_dim=64, n_steps=N_STEPS
    ).to(cfg.device)
    _state.model.eval()

    if not cfg.mock_mode:
        try:
            sd = torch.load(cfg.model_path, map_location=cfg.device, weights_only=True)
            _state.model.load_state_dict(sd)
            _state.weights_loaded = True
            _state.weights_path   = cfg.model_path
            log.info(f"[model] Weights loaded from {cfg.model_path} on {cfg.device}")
        except FileNotFoundError:
            _state.weights_loaded = False
            log.warning(
                f"[model] Weight file not found: {cfg.model_path}. "
                "Running with RANDOM (untrained) weights — outputs are SYNTHETIC."
            )
    else:
        _state.weights_loaded = False
        log.info("[model] MOCK_MODE=True — running with random weights.")

    # Determine data mode for status endpoint.
    #
    # This flag was written when there were only two possibilities: a trained
    # model on a live feed, or the synthetic generator. The scored blend
    # baseline is a third - real observations from 68 CPCB stations replayed
    # from the archive, with no trained model - and it was being reported as
    # "synthetic", which is the opposite of true. /health said synthetic while
    # /forecast/frames said is_synthetic: false, and anyone checking the
    # cheaper endpoint would have concluded the whole system was fabricated.
    if not cfg.mock_mode and cfg.aqicn_token and _state.weights_loaded:
        _state.data_mode = "live"
    elif cfg.use_baseline and not _state.weights_loaded:
        # The baseline loads lazily on the first forecast, so this states the
        # configured intent. _generate_forecast_tensor corrects it to
        # "synthetic" if the archive turns out to be unreadable.
        _state.data_mode = "archive_replay"
    else:
        _state.data_mode = "synthetic"

    yield
    _state.cache.clear()


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="SIH26082 — Air Pollution Coupled Forecast API",
    description="MoES / NCMRWF · Delhi NCR Physics-Informed Spatiotemporal Forecasting",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class ForecastMeta(BaseModel):
    issued_at:    str
    valid_from:   str
    valid_to:     str
    model_ver:    str = "ConvLSTM-SIH26082-v1"
    coupling:     str = "two-way-aerosol-met"
    grid_shape:   list[int] = Field(default=[GRID_H, GRID_W])
    n_steps:      int = N_STEPS
    bbox:         list[float] = Field(default=[NCR_LON_MIN, NCR_LAT_MIN, NCR_LON_MAX, NCR_LAT_MAX])


class StationForecast(BaseModel):
    station_id: str
    lat: float
    lon: float
    channel: str
    unit: str
    values: list[float]           # 72 hourly values
    timestamps: list[str]


class InversionAlert(BaseModel):
    zone_id: str
    severity: str                 # "MODERATE" | "SEVERE" | "EMERGENCY"
    isi_score: float
    lat_center: float
    lon_center: float
    lat_range: list[float]
    lon_range: list[float]
    pm25_peak: float
    pbl_min: float
    issued_at: str
    message: str


# ── Internal Utilities ────────────────────────────────────────────────────────

def _cache_get(key: str, ttl: int) -> Any | None:
    entry = _state.cache.get(key)
    if entry and (time.time() - entry[0]) < ttl:
        return entry[1]
    return None


def _cache_set(key: str, value: Any) -> None:
    _state.cache[key] = (time.time(), value)


_inference_lock = asyncio.Lock()

async def get_forecast_tensor() -> tuple[torch.Tensor, bool]:
    cfg = get_settings()
    cache_key = "global_forecast_tensor"
    
    async with _inference_lock:
        cached = _cache_get(cache_key, cfg.cache_ttl_s)
        if cached is not None:
            return cached
            
        loop = asyncio.get_event_loop()
        pred, is_synthetic = await loop.run_in_executor(None, _generate_forecast_tensor)
        _cache_set(cache_key, (pred, is_synthetic))
        return pred, is_synthetic


def _generate_forecast_tensor() -> tuple[torch.Tensor, bool]:
    """
    Builds input tensor from available data and runs coupled model inference.

    Returns
    -------
    (pred, is_synthetic) where:
        pred         : (1, 72, 12, 70, 80) prediction tensor on CPU
        is_synthetic : True if ANY input channel is synthetic/mock
    """
    import logging
    log = logging.getLogger("api_server")

    cfg = get_settings()
    is_synthetic = False

    # ── Blend baseline ────────────────────────────────────────────────────────
    # With no trained weights the network below emits noise, and the inputs it
    # would run on are mock CPCB, mock FIRMS and np.random meteorology. Prefer a
    # forecast whose error is known: the mean of diurnal persistence and
    # bias-corrected CAMS, scored at RMSE 84.89 ug/m3 against December 2025 —
    # 30% better than raw CAMS. Ten of the twelve channels are measurements or
    # archived forecast; FRP and smoke stay zero for want of a live fire feed.
    if cfg.use_baseline and not _state.weights_loaded:
        try:
            from baseline_forecaster import get_forecaster

            result = get_forecaster(cfg.baseline_season).forecast()
            _state.forecast_meta = result.meta
            log.info("forecast from blend baseline (origin %s, RMSE 84.89 ug/m3)",
                     result.meta["origin"])
            # Not synthetic: these are real observations and a scored forecast.
            return torch.from_numpy(result.tensor[None]).float(), False
        except Exception as exc:
            log.warning("blend baseline unavailable (%s); falling back to the "
                        "untrained model path, whose output is SYNTHETIC.", exc)
            _state.forecast_meta = None
            # Startup announced archive_replay on the strength of the config.
            # The archive is not readable, so withdraw that rather than let
            # /health keep asserting it.
            _state.data_mode = "synthetic"

    # ── CPCB / AQI data ───────────────────────────────────────────────────────
    if cfg.mock_mode or not cfg.aqicn_token:
        if not cfg.aqicn_token:
            log.warning(
                "AQICN_TOKEN not set — using SYNTHETIC CPCB data. "
                "Set AQICN_TOKEN in backend/.env for live station data."
            )
        cpcb_df = generate_mock_cpcb_df()
        is_synthetic = True
    else:
        cpcb_df = fetch_live_cpcb_waqi_df(cfg.aqicn_token)
        # fetch_live_cpcb_waqi_df falls back to mock internally if the API fails
        if cpcb_df.attrs.get("source") == "mock":
            is_synthetic = True

    # ── FIRMS fire data — always synthetic (no live FIRMS integration yet) ────
    firms_df = generate_mock_firms_df()
    is_synthetic = True   # FIRMS is always synthetic until live pipeline is wired

    # ── IMD meteorological grids — synthetic placeholders ─────────────────────
    # NOTE: Real IMD/WRF gridded data is NOT yet integrated.
    # These values are fixed/seeded estimates for demo purposes.
    # u_wind / v_wind: representative NW winter flow over Delhi NCR (m/s)
    imd_grids = {
        "u_wind":    np.full((GRID_H, GRID_W), -2.1, np.float32),   # synthetic
        "v_wind":    np.full((GRID_H, GRID_W),  3.4, np.float32),   # synthetic
        # Seeded random fields — deterministic but not from real IMD data
        "temp":      np.random.default_rng(seed=7).uniform(12, 24, (GRID_H, GRID_W)).astype(np.float32),
        "rh":        np.random.default_rng(seed=8).uniform(55, 85, (GRID_H, GRID_W)).astype(np.float32),
        "solar_irr": np.random.default_rng(seed=9).uniform(180, 600, (GRID_H, GRID_W)).astype(np.float32),
        "pbl":       np.random.default_rng(seed=10).uniform(280, 800, (GRID_H, GRID_W)).astype(np.float32),
    }

    fire_transport = _state.fusion.compute_fire_transport(
        firms_df, u_wind_ms=-2.1, v_wind_ms=3.4
    )
    frame = _state.fusion.build_channel_stack(cpcb_df, imd_grids, fire_transport)  # (12, 70, 80)

    # ── Normalise to model input space ────────────────────────────────────────
    frame_norm = (frame / _CHANNEL_NORMS[:, None, None]).astype(np.float32)

    # ── Historical context (SYNTHETIC — see _build_synthetic_history docstring)
    history = _build_synthetic_history(frame_norm, n_steps=24)
    is_synthetic = True   # context is always synthetic until real history integrated

    x = torch.tensor(history[None], dtype=torch.float32).to(cfg.device)  # (1, 24, 12, 70, 80)

    # ── Model inference ────────────────────────────────────────────────────────
    # Output domain: decoder has no output activation.  With trained weights
    # values are guided toward [0, 1] by normalised MSE loss.  With untrained
    # (random) weights outputs may be outside [0, 1] and denormalised values
    # will be physically unrealistic — reported via is_synthetic.
    with torch.inference_mode():
        pred = _state.model(x)   # (1, 72, 12, 70, 80)

    return pred.cpu(), is_synthetic


def _tensor_to_geojson(pred: torch.Tensor, step: int, channels: list[int]) -> dict:
    """
    Converts a single-step prediction grid to GeoJSON FeatureCollection.
    Each grid cell becomes a Point feature.

    Parameters
    ----------
    pred : (1, T, C, H, W) prediction tensor.
    step : Timestep index to extract.
    channels : List of channel indices to include as properties.
    """
    ch_names = ["pm25", "pm10", "o3", "nox", "u_wind", "v_wind",
                "temp", "rh", "solar_irr", "pbl", "frp", "smoke"]
    norms = [500, 700, 120, 250, 20, 20, 40, 100, 1200, 3000, 200, 300]

    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)

    frame = pred[0, step].numpy()   # (C, H, W)
    features = []

    # Subsample to 10×10 for fast GeoJSON (full grid = msgpack binary endpoint)
    step_h, step_w = GRID_H // 10, GRID_W // 10
    for i in range(0, GRID_H, step_h):
        for j in range(0, GRID_W, step_w):
            props = {ch_names[c]: round(float(frame[c, i, j]) * norms[c], 2) for c in channels}
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(lon_vec[j]), float(lat_vec[i])]},
                "properties": props,
            })

    return {"type": "FeatureCollection", "features": features}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    cfg = get_settings()
    return {
        "status": "ok",
        "model_loaded": _state.model is not None,
        "weights_loaded": _state.weights_loaded,
        "data_mode": _state.data_mode,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/status")
async def model_status():
    """
    Returns truthful model and data pipeline status.
    The frontend should display this to the user so they know
    whether outputs are from real trained weights or are SYNTHETIC.
    """
    cfg = get_settings()
    n_params = (
        sum(p.numel() for p in _state.model.parameters())
        if _state.model else 0
    )
    return {
        "model_name": "AirPollutionCoupledForecaster",
        "version": "ConvLSTM-SIH26082-v1",
        "architecture": "ConvLSTM ×2 + SpatialAttn + DynGNN + FeedbackCoupling",
        "parameters": n_params,
        "weights_loaded": _state.weights_loaded,
        "weights_path": _state.weights_path if _state.weights_loaded else None,
        "device": cfg.device,
        "forecast_horizon_hours": N_STEPS,
        "grid_shape": [GRID_H, GRID_W],
        "channels": N_CHANNELS,
        "data_mode": _state.data_mode,
        # Per-source data availability
        "sources": {
            "cpcb_waqi": (
                "archive" if _state.forecast_meta
                else "live" if (cfg.aqicn_token and not cfg.mock_mode) else "synthetic"
            ),
            "imd_met": "archive" if _state.forecast_meta else "synthetic",
            "nasa_firms": "synthetic",  # no live fire feed in either path
            # Read-only side channel from the partner ingestion pipeline. It
            # feeds no forecast: the blend baseline is validated at 84.89 and
            # adding an input would invalidate that number.
            "noaa_gfs": gfs_reader.describe(),
        },
        # Which engine produced the numbers being served.
        "forecast_engine": (
            "coupled_model" if _state.weights_loaded
            else "blend_baseline" if _state.forecast_meta
            else "untrained_model"
        ),
        "baseline": _state.forecast_meta,
        "started_at": _state.started_at,
        "queried_at": datetime.now(timezone.utc).isoformat(),
        # Honest note about what the outputs actually are.
        "warning": (
            None if _state.weights_loaded
            else (
                "Model weights not loaded. Forecasts come from the blend baseline "
                "(mean of diurnal persistence and bias-corrected CAMS), validated at "
                "RMSE 84.89 ug/m3 over December 2025 — 30% better than raw CAMS. "
                "Values are real; FRP and smoke channels are zero. Replayed from the "
                "archive, not a live feed."
            ) if _state.forecast_meta
            else "Model weights not loaded. Outputs are from RANDOM (untrained) weights and are SYNTHETIC."
        ),
    }


@app.get("/api/v1/forecast/grid")
async def forecast_grid(
    step: int = Query(default=0, ge=0, le=71, description="Forecast hour offset (0–71)"),
    channels: str = Query(default="0,6,9,8", description="Comma-separated channel indices"),
    compress: bool = Query(default=True, description="gzip compress response"),
):
    """
    Returns the 72-hour forecast spatial grid for Delhi NCR as GeoJSON.

    - `step`: Which forecast hour to return (0 = now, 71 = T+71h).
    - `channels`: Comma-separated channel indices (0=PM2.5, 6=Temp, 9=PBL, 8=Solar).
    - `compress`: Apply gzip compression (recommended for frontend).
    """
    cfg = get_settings()
    cache_key = f"grid:{step}:{channels}"
    cached = _cache_get(cache_key, cfg.cache_ttl_s)
    if cached:
        if compress:
            return Response(content=gzip.compress(cached), media_type="application/json",
                            headers={"Content-Encoding": "gzip", "X-Cache": "HIT"})
        return Response(content=cached, media_type="application/json", headers={"X-Cache": "HIT"})

    ch_list = [int(c.strip()) for c in channels.split(",") if c.strip().isdigit()]
    ch_list = [c for c in ch_list if 0 <= c < N_CHANNELS]
    if not ch_list:
        raise HTTPException(400, "Invalid channel indices")

    pred, is_synthetic = await get_forecast_tensor()

    now = datetime.now(timezone.utc)
    meta = ForecastMeta(
        issued_at=now.isoformat(),
        valid_from=now.isoformat(),
        valid_to=now.replace(hour=(now.hour + 71) % 24).isoformat(),
    )
    geojson = _tensor_to_geojson(pred, step, ch_list)
    geojson["meta"] = meta.model_dump()
    geojson["meta"]["data_mode"] = "synthetic" if is_synthetic else "live"
    geojson["meta"]["weights_loaded"] = _state.weights_loaded

    body = json.dumps(geojson, separators=(",", ":")).encode()
    _cache_set(cache_key, body)

    if compress:
        return Response(content=gzip.compress(body), media_type="application/json",
                        headers={"Content-Encoding": "gzip", "X-Cache": "MISS"})
    return Response(content=body, media_type="application/json", headers={"X-Cache": "MISS"})


@app.get("/api/v1/forecast/station/{station_id}", response_model=StationForecast)
async def forecast_station(
    station_id: str,
    channel: int = Query(default=0, ge=0, le=11, description="Channel index (0=PM2.5)"),
    lat: float  = Query(default=28.63, description="Latitude — clamped to NCR grid if out of bounds"),
    lon: float  = Query(default=77.22, description="Longitude — clamped to NCR grid if out of bounds"),
):
    """
    Returns 72-hour time-series forecast vector for a specific location.

    Bilinearly interpolates the spatial grid to the (lat, lon) coordinate.
    """
    cfg = get_settings()
    # Clamp out-of-NCR coordinates to grid edges (avoids 422 for Punjab/Haryana etc.)
    lat = float(np.clip(lat, NCR_LAT_MIN, NCR_LAT_MAX))
    lon = float(np.clip(lon, NCR_LON_MIN, NCR_LON_MAX))
    cache_key = f"station:{station_id}:{channel}:{lat:.3f}:{lon:.3f}"
    cached = _cache_get(cache_key, cfg.cache_ttl_s)
    if cached:
        return cached

    pred, _is_synthetic = await get_forecast_tensor()   # (1, 72, 12, 70, 80)

    # Bilinear grid lookup
    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)
    hi = int(np.clip(np.searchsorted(lat_vec, lat), 0, GRID_H - 1))
    wi = int(np.clip(np.searchsorted(lon_vec, lon), 0, GRID_W - 1))

    ch_norms  = [500, 700, 120, 250, 20, 20, 40, 100, 1200, 3000, 200, 300]
    ch_units  = ["µg/m³","µg/m³","µg/m³","µg/m³","m/s","m/s","°C","%","W/m²","m","MW/km²","µg/m³"]
    ch_names  = ["pm25","pm10","o3","nox","u_wind","v_wind","temp","rh","solar_irr","pbl","frp","smoke"]

    series = pred[0, :, channel, hi, wi].numpy()
    now = datetime.now(timezone.utc)
    timestamps = [
        (now + timedelta(hours=t)).strftime("%Y-%m-%dT%H:00:00Z")
        for t in range(N_STEPS)
    ]

    result = StationForecast(
        station_id=station_id,
        lat=lat, lon=lon,
        channel=ch_names[channel],
        unit=ch_units[channel],
        values=[round(float(v) * ch_norms[channel], 2) for v in series],
        timestamps=timestamps,
    )
    _cache_set(cache_key, result)
    return result


@app.get("/api/v1/alerts/inversion", response_model=list[InversionAlert])
async def alerts_inversion(
    isi_threshold: float = Query(default=0.75, ge=0.0, le=1.0),
    max_zones: int       = Query(default=10, ge=1, le=50),
):
    """
    Returns active thermal inversion trap risk zones where ISI > threshold.

    ISI (Inversion Severity Index) ∈ [0,1]:
        < 0.50  → Low
        0.50–0.65 → Moderate
        0.65–0.75 → Severe
        > 0.75  → EMERGENCY
    """
    cfg = get_settings()
    cache_key = f"alerts:inv:{isi_threshold:.2f}"
    cached = _cache_get(cache_key, 60)    # 60s TTL for alerts
    if cached:
        return cached

    pred, _is_synthetic = await get_forecast_tensor()   # (1, 72, 12, 70, 80)

    # Take worst-case step (max PM2.5 over forecast horizon)
    pm25_max = pred[0, :, CH_PM25].max(dim=0).values   # (H, W) normalised
    pbl_min  = pred[0, :, CH_PBL].min(dim=0).values    # (H, W) normalised
    wind_min = torch.hypot(
        pred[0, :, CH_UWIND], pred[0, :, CH_VWIND]
    ).min(dim=0).values                                 # (H, W) normalised

    isi_grid = compute_isi(pm25_max * 500, pbl_min * 3000, wind_min * 20)  # (H, W)

    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)

    # Find zones above threshold using 5×5 block aggregation
    block_h, block_w = 7, 8
    alerts: list[InversionAlert] = []
    now_str = datetime.now(timezone.utc).isoformat()

    for bi in range(0, GRID_H - block_h, block_h):
        for bj in range(0, GRID_W - block_w, block_w):
            block_isi  = isi_grid[bi:bi + block_h, bj:bj + block_w]
            block_pm25 = pm25_max[bi:bi + block_h, bj:bj + block_w]
            block_pbl  = pbl_min[bi:bi + block_h, bj:bj + block_w]

            mean_isi = block_isi.mean().item()
            if mean_isi < isi_threshold:
                continue

            if mean_isi > 0.85:
                severity = "EMERGENCY"
                msg = "CRITICAL inversion trap — GRADED-RESPONSE ACTION REQUIRED"
            elif mean_isi > 0.75:
                severity = "SEVERE"
                msg = "Severe inversion — restrict outdoor activity, notify SAFAR"
            else:
                severity = "MODERATE"
                msg = "Elevated inversion risk — enhanced monitoring recommended"

            ctr_lat = float(lat_vec[bi + block_h // 2])
            ctr_lon = float(lon_vec[bj + block_w // 2])

            alerts.append(InversionAlert(
                zone_id    = f"ISI_{bi//block_h}_{bj//block_w}",
                severity   = severity,
                isi_score  = round(mean_isi, 4),
                lat_center = round(ctr_lat, 4),
                lon_center = round(ctr_lon, 4),
                lat_range  = [round(float(lat_vec[bi]), 4), round(float(lat_vec[min(bi + block_h, GRID_H - 1)]), 4)],
                lon_range  = [round(float(lon_vec[bj]), 4), round(float(lon_vec[min(bj + block_w, GRID_W - 1)]), 4)],
                pm25_peak  = round(float(block_pm25.max()) * 500, 1),
                pbl_min    = round(float(block_pbl.min()) * 3000, 1),
                issued_at  = now_str,
                message    = msg,
            ))

            if len(alerts) >= max_zones:
                break
        if len(alerts) >= max_zones:
            break

    alerts.sort(key=lambda a: a.isi_score, reverse=True)
    _cache_set(cache_key, alerts)
    return alerts


@app.get("/api/v1/met/gfs")
async def met_gfs(response: Response):
    """
    NOAA GFS over the nine 0.25-degree cells inside the NCR domain.

    A side channel, not a forecast input. Temperature and wind here duplicate
    Open-Meteo at far lower density; the field worth having is precipitation,
    which none of the twelve channels carries and which scavenges PM2.5.

    204 when no usable extract is present. The file comes from a separate
    repository on someone else's schedule, so absence is an ordinary state and
    every consumer must treat it as one - nothing that works today depends on
    this returning content.
    """
    data = gfs_reader.load()
    if data is None:
        response.status_code = 204
        return None
    return data


@app.get("/api/v1/policy/grap")
async def policy_grap():
    """
    Evaluates the worst-case GRAP stage across the entire NCR spatial grid
    for the next 72-hour forecast horizon.
    """
    cfg = get_settings()
    cache_key = "policy:grap:worst_case"
    cached = _cache_get(cache_key, cfg.cache_ttl_s)
    if cached:
        return cached

    pred, _is_synthetic = await get_forecast_tensor()   # (1, 72, 12, 70, 80)
    
    # Evaluate worst-case PM2.5 across the entire grid and all 72 hours
    # pred shape: (1, 72, 12, 70, 80)
    pm25_max_norm = pred[0, :, CH_PM25].max().item()
    pm25_max_ugm3 = pm25_max_norm * 500.0
    
    # Calculate AQI
    aqi = calculate_indian_aqi_pm25(pm25_max_ugm3)
    
    # Get GRAP Stage
    grap_policy = evaluate_grap_stage(aqi)
    
    now = datetime.now(timezone.utc)
    
    response = {
        "timestamp": now.isoformat(),
        "worst_case_pm25": round(pm25_max_ugm3, 2),
        "worst_case_aqi": aqi,
        "grap": grap_policy,
        "message": "Evaluated across entire NCR spatial grid for the 72-hour forecast."
    }
    
    _cache_set(cache_key, response)
    return response


# ── Dashboard frames ──────────────────────────────────────────────────────────

#: The five NCR districts the console plots, mirroring DISTRICTS in the
#: frontend's lib/data.ts. Kept here so one request returns everything the UI
#: needs; sampling the grid per district per channel over the station endpoint
#: would take 35 round trips to draw a single frame.
_FRAME_DISTRICTS = [
    {"id": "delhi",     "lat": 28.6139, "lon": 77.2090},
    {"id": "noida",     "lat": 28.5355, "lon": 77.3910},
    {"id": "gurgaon",   "lat": 28.4595, "lon": 77.0266},
    {"id": "faridabad", "lat": 28.4089, "lon": 77.3178},
    {"id": "ghaziabad", "lat": 28.6692, "lon": 77.4538},
]


def _alert_level(pm25: float, inversion: float) -> str:
    """Mirrors alertLevel() in the frontend's lib/aqi.ts so badges agree."""
    score = pm25 / 120.0 + inversion * 0.75
    if score > 1.65:
        return "EMERGENCY"
    if score > 1.20:
        return "WARNING"
    if score > 0.80:
        return "ADVISORY"
    return "NOMINAL"


@app.get("/api/v1/forecast/frames")
async def forecast_frames():
    """
    The 72-hour forecast already shaped as the console's `Frame[]`.

    lib/data.ts builds this shape synthetically via buildForecast(); this returns
    the same shape from the forecast tensor so the frontend can swap the source
    without touching any panel, chart or map code. Field names match `Frame` and
    `CellSample` exactly.
    """
    cfg = get_settings()
    cache_key = "dashboard:frames"
    cached = _cache_get(cache_key, cfg.cache_ttl_s)
    if cached is not None:
        return cached

    pred, is_synthetic = await get_forecast_tensor()     # (1, 72, 12, 70, 80)
    arr = pred[0].numpy()

    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)
    norms = _CHANNEL_NORMS

    cells = []
    for d in _FRAME_DISTRICTS:
        hi = int(np.clip(np.searchsorted(lat_vec, d["lat"]), 0, GRID_H - 1))
        wi = int(np.clip(np.searchsorted(lon_vec, d["lon"]), 0, GRID_W - 1))
        cells.append((d["id"], hi, wi))

    meta = _state.forecast_meta or {}
    # Frame 0 is the origin hour; lead h is frame h.
    origin = meta.get("origin")
    base = datetime.fromisoformat(origin) if origin else datetime.now(timezone.utc)

    frames = []
    for t in range(N_STEPS):
        valid = base + timedelta(hours=t)
        local = valid + timedelta(hours=5, minutes=30)      # IST
        districts, pm_all, pbl_all, temp_all, solar_all, wind_all, inv_all = {}, [], [], [], [], [], []

        for did, hi, wi in cells:
            f = arr[t, :, hi, wi] * norms
            pm25, o3, nox = float(f[0]), float(f[2]), float(f[3])
            u, v = float(f[4]), float(f[5])
            temp, solar, pbl = float(f[6]), float(f[8]), float(f[9])
            wind = float(np.hypot(u, v))
            wind_dir = float((np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0)
            # Same proxy the console uses: a shallow layer with weak ventilation
            # traps pollution. 1 at a fully collapsed layer, 0 at 1000 m.
            inversion = float(np.clip(1.0 - pbl / 1000.0, 0.0, 1.0))

            districts[did] = {
                "districtId": did,
                "pm25": round(pm25, 1),
                "aqi": calculate_indian_aqi_pm25(pm25),
                "pbl": round(pbl, 1),
                "temp": round(temp, 1),
                "solar": round(solar, 1),
                "windSpeed": round(wind, 2),
                "windDir": round(wind_dir, 1),
                "o3": round(o3, 1),
                "nox": round(nox, 1),
                "inversion": round(inversion, 3),
                "alert": _alert_level(pm25, inversion),
            }
            pm_all.append(pm25); pbl_all.append(pbl); temp_all.append(temp)
            solar_all.append(solar); wind_all.append(wind); inv_all.append(inversion)

        avg_pm = float(np.mean(pm_all))
        avg_inv = float(np.mean(inv_all))
        frames.append({
            "hour": t,
            "label": ("NOW" if t == 0 else f"+{t}h"),
            "localHour": local.hour,
            "districts": districts,
            "avgPm25": round(avg_pm, 1),
            "avgAqi": calculate_indian_aqi_pm25(avg_pm),
            "avgPbl": round(float(np.mean(pbl_all))),
            "avgTemp": round(float(np.mean(temp_all)), 1),
            "avgSolar": round(float(np.mean(solar_all))),
            "avgWind": round(float(np.mean(wind_all)), 1),
            "inversionIndex": round(avg_inv, 2),
            "alert": _alert_level(avg_pm, avg_inv),
            "validTime": valid.isoformat(),
        })

    payload = {
        "frames": frames,
        "source": {
            "engine": (
                "coupled_model" if _state.weights_loaded
                else "blend_baseline" if _state.forecast_meta else "untrained_model"
            ),
            "is_synthetic": bool(is_synthetic),
            **meta,
        },
    }
    _cache_set(cache_key, payload)
    return payload


# ── WebSocket Live Push ────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """
    Pushes delta forecast updates every 100ms.
    Sends a compact JSON message: {"t": <step>, "pm25_mean": <val>, "pbl_mean": <val>}.
    """
    await websocket.accept()
    step = 0
    try:
        pred, _is_synthetic = await get_forecast_tensor()
        while True:
            frame = pred[0, step % N_STEPS]
            pm25_mean = round(float(frame[CH_PM25].mean()) * 500, 1)
            pbl_mean  = round(float(frame[CH_PBL].mean())  * 3000, 1)
            solar_mean= round(float(frame[CH_SOLAR].mean())* 1200, 1)
            await websocket.send_json({
                "t": step % N_STEPS,
                "pm25_mean": pm25_mean,
                "pbl_mean":  pbl_mean,
                "solar_mean": solar_mean,
                "ts": datetime.now(timezone.utc).strftime("%H:%M:%S"),
            })
            step += 1
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass


# ── Dev Entry Point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=False, workers=1)
