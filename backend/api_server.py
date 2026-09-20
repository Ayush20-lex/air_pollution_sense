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
import pandas as pd
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
import aqi_cpcb
import station_registry
import waqi_live
import cpcb_live
import live_history
import firms_fire
import coupled_feedback


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
    # Its output is measurements and an evaluated forecast (RMSE 62.23 ug/m3,
    # 30% better than raw CAMS) instead of random-weight noise. Set false to see
    # the untrained model's raw output.
    use_baseline:   bool  = True
    # 2026 runs to 2026-09-07 - eleven days behind today rather than nine
    # months. 2025 remains scored and servable; the season decides its own
    # CAMS correction and its own published RMSE, so switching back is safe.
    baseline_season: int  = 2026

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
    # The live-history recorder, held so shutdown can cancel it.
    recorder:       Any = None


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

#: How often the recorder samples the live mesh.
#:
#: WAQI publishes hourly, so anything under an hour is only insurance against
#: missing the moment a station updates. Fifteen minutes gives four chances an
#: hour, and because `waqi_live.mesh` caches for five it usually costs no
#: request at all - the recorder reads the same build a page request just paid
#: for. It also keeps the day's traffic near 2,400 requests, which matters on a
#: free token.
RECORD_EVERY_S = 900

#: Pruning is cheap and the table is small; once a day is plenty.
PRUNE_EVERY_S = 86_400


async def _record_live_history() -> None:
    """Keep every live mesh build, so the live stations accumulate a window.

    This runs for the life of the process rather than on the request path. The
    history has to be continuous to be worth anything, and a mesh recorded only
    when somebody happens to load the page would have a hole through every quiet
    night - exactly the hours a reader most wants to see.

    Nothing here is allowed to escape. A failure to record is a gap in a chart;
    a failure that propagates would take the task down permanently and every
    later hour with it, silently, because a dead asyncio task raises nowhere.
    """
    log = _logging.getLogger("api_server")
    since_prune = 0.0
    while True:
        try:
            await asyncio.sleep(RECORD_EVERY_S)
            mesh = await asyncio.to_thread(_live_mesh)
            if mesh:
                await asyncio.to_thread(live_history.record, mesh)
            since_prune += RECORD_EVERY_S
            if since_prune >= PRUNE_EVERY_S:
                since_prune = 0.0
                await asyncio.to_thread(live_history.prune)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a gap, never a dead recorder
            log.warning("live history: skipped a sample (%s)", exc)


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

    # Warm the live mesh off the request path. Building it costs a round trip
    # per station - about six seconds - and the dashboard gives up after eight,
    # so the first visitor after a restart would have raced it and lost, seeing
    # the archive and a DEMO badge with a live feed working perfectly behind it.
    #
    # Gated on either feed, not on WAQI alone: CPCB's bulletin became the
    # preferred source and a box configured for CPCB only would have skipped
    # both the warm and the recorder.
    if waqi_live.available() or cpcb_live.available():
        try:
            warm = await asyncio.to_thread(_live_mesh)
            if warm:
                log.info("live mesh warm: %d stations, %d indexable, as of %s",
                         warm["count"], warm["indexable"], warm["as_of"])
                await asyncio.to_thread(live_history.record, warm)
        except Exception as exc:  # noqa: BLE001 - never block startup on a feed
            log.warning("could not warm the live mesh (%s)", exc)

        _state.recorder = asyncio.create_task(_record_live_history())

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

    if _state.recorder is not None:
        _state.recorder.cancel()
        try:
            await _state.recorder
        except asyncio.CancelledError:
            pass
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
    #: When the worst hour lands, and how far ahead. An inversion is a thing
    #: that happens at a time; an alert that cannot say when is not actionable.
    peak_at: str
    lead_hours: int
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
    # bias-corrected CAMS, scored at RMSE 62.23 ug/m3 across Dec 2025-Sep 2026 —
    # 30% better than raw CAMS. Ten of the twelve channels are measurements or
    # archived forecast; FRP and smoke stay zero for want of a live fire feed.
    if cfg.use_baseline and not _state.weights_loaded:
        try:
            from baseline_forecaster import get_forecaster

            # Issued for today, not for the newest observed hour. The
            # archive lags about two days behind CPCB by way of OpenAQ, and
            # pinning the origin to it made a "72-hour forecast" that was
            # mostly hindcast: on 19 September the origin sat at the 17th, so
            # 53 of the 72 hours had already happened. CAMS runs days ahead,
            # so the lead is there; what changes is that leads past the
            # observations have no diurnal parent, which `forecast` records
            # per lead rather than papering over.
            fc = get_forecaster(cfg.baseline_season)
            result = fc.forecast(fc.latest_origin(), _live_diurnal_source(fc))
            _state.forecast_meta = result.meta
            log.info(
                "forecast from blend baseline (season %s, origin %s, RMSE %s ug/m3)",
                result.meta.get("season"),
                result.meta.get("origin"),
                result.meta.get("validated_rmse_ugm3"),
            )
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
            # Real VIIRS fire pixels over the Punjab/Haryana corridor, aligned
            # to the forecast origin. Outside the burning season this reports
            # few or no fires, which is the season and not a broken feed.
            "nasa_firms": firms_fire.describe(
                (_state.forecast_meta or {}).get("fire", {}).get("window_start")
            ),
            # Read-only side channel from the partner ingestion pipeline. It
            # feeds no forecast: the blend baseline is validated at 62.23 and
            # adding an input would invalidate that number.
            # The two-way loop the problem statement is built around. Computed
            # from the forecast's own aerosol and reported; it does not move the
            # published PM2.5, and describe() says why.
            "aerosol_pbl_coupling": coupled_feedback.describe(),
            "noaa_gfs": gfs_reader.describe(),
            "station_mesh": station_registry.describe(
                get_settings().baseline_season, _mesh_origin()
            ),
            "cpcb_live": cpcb_live.describe(),
            "waqi_live": waqi_live.describe(),
            "live_history": live_history.describe(),
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
                "RMSE 62.23 ug/m3 over Dec 2025-Sep 2026 — 27% better than raw CAMS. "
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
    isi_threshold: float = Query(default=0.65, ge=0.0, le=1.0),
    max_zones: int       = Query(default=10, ge=1, le=50),
):
    """
    Thermal inversion trap zones whose worst forecast hour scores above
    `isi_threshold`.

    ISI (Inversion Severity Index) in [0, 1], as the tiers below are applied:

        < 0.65   not reported
        0.65-0.75  MODERATE   elevated risk, enhanced monitoring
        0.75-0.85  SEVERE     restrict outdoor activity, notify SAFAR
        > 0.85     EMERGENCY  graded-response action required

    The default threshold was 0.75, which is also the SEVERE cutoff, so every
    zone that survived the filter was labelled SEVERE or worse and the MODERATE
    branch below could never run. Ten zones came back SEVERE on a September
    afternoon. The threshold now sits at the bottom of the reported range, so
    the tiers separate a quiet month from a December night instead of pinning.

    The sigmoid in compute_isi compresses the practical range - today's grid
    spans 0.672 to 0.744 across the whole domain - so these cutoffs are close
    together by construction. They are the documented ones and the code now
    matches them; widening the index itself is a separate change.
    """
    cfg = get_settings()
    cache_key = f"alerts:inv:{isi_threshold:.2f}"
    cached = _cache_get(cache_key, 60)    # 60s TTL for alerts
    if cached:
        return cached

    pred, _is_synthetic = await get_forecast_tensor()   # (1, 72, 12, 70, 80)

    # Score every hour on its own terms, then take the worst hour.
    #
    # This used to take the maximum PM2.5, the minimum PBL and the minimum wind
    # independently over the whole 72-hour horizon and compute one ISI from the
    # three. Those extremes do not occur together: the peak pollution might be
    # on day one, the shallowest layer on night three and the stillest air on
    # day two. Combining them described an hour that never happens, and over 72
    # hours in Delhi every zone reaches all three at some point - so ISI
    # saturated and all ten zones came back SEVERE, every time, which is not an
    # alert but a constant.
    pm25_t = pred[0, :, CH_PM25] * 500.0                       # (T, H, W) ug/m3
    pbl_t = pred[0, :, CH_PBL] * 3000.0                        # (T, H, W) m
    wind_t = torch.hypot(pred[0, :, CH_UWIND], pred[0, :, CH_VWIND]) * 20.0

    # The forecast origin, so a lead index can be named as a clock time. Same
    # derivation the frames endpoint uses; lead h is hour h after the origin.
    _meta = _state.forecast_meta or {}
    base = (datetime.fromisoformat(_meta["origin"]) if _meta.get("origin")
            else datetime.now(timezone.utc))

    isi_t = compute_isi(pm25_t, pbl_t, wind_t)                 # (T, H, W)
    worst = isi_t.max(dim=0)
    isi_grid = worst.values                                    # (H, W)
    peak_step = worst.indices                                  # (H, W) hour index

    pm25_max = pm25_t.max(dim=0).values / 500.0                # kept for the payload
    pbl_min = pbl_t.min(dim=0).values / 3000.0

    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)

    # Find zones above threshold using 5×5 block aggregation
    block_h, block_w = 7, 8
    alerts: list[InversionAlert] = []
    now_str = datetime.now(timezone.utc).isoformat()

    for bi in range(0, GRID_H - block_h, block_h):
        for bj in range(0, GRID_W - block_w, block_w):
            block_isi  = isi_grid[bi:bi + block_h, bj:bj + block_w]
            block_step = peak_step[bi:bi + block_h, bj:bj + block_w]

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

            # The hour this block is worst, taken from its worst cell, and the
            # conditions AT that hour. Reporting a peak PM2.5 from one hour
            # beside a minimum PBL from another is what produced a permanent
            # emergency; these two now describe the same moment.
            flat = int(block_isi.argmax().item())
            lead = int(block_step.flatten()[flat].item())
            peak_pm = float(pm25_t[lead, bi:bi + block_h, bj:bj + block_w].max().item())
            peak_pbl = float(pbl_t[lead, bi:bi + block_h, bj:bj + block_w].min().item())
            peak_at = (base + timedelta(hours=lead)).isoformat()

            alerts.append(InversionAlert(
                zone_id    = f"ISI_{bi//block_h}_{bj//block_w}",
                severity   = severity,
                isi_score  = round(mean_isi, 4),
                lat_center = round(ctr_lat, 4),
                lon_center = round(ctr_lon, 4),
                lat_range  = [round(float(lat_vec[bi]), 4), round(float(lat_vec[min(bi + block_h, GRID_H - 1)]), 4)],
                lon_range  = [round(float(lon_vec[bj]), 4), round(float(lon_vec[min(bj + block_w, GRID_W - 1)]), 4)],
                pm25_peak  = round(peak_pm, 1),
                pbl_min    = round(peak_pbl, 1),
                peak_at    = peak_at,
                lead_hours = lead,
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


#: Below this many indexable live stations the archive is the better answer -
#: a handful of points cannot carry an interpolated field across the NCR, and a
#: sparse live mesh would look like coverage it does not have.
MIN_LIVE_STATIONS = 8


def _mesh_origin() -> str | None:
    """The hour the station mesh should describe.

    Pinned to the forecast origin so the mesh and the console describe the same
    hour. Left to itself the registry falls back to the observations' own last
    hour, which is three days later in this archive - and every caller has to
    pin it the same way or they disagree: /api/v1/status reported the mesh at
    2025-12-31T22:00 while /api/v1/stations served 2025-12-28T23:00, which is
    the exact drift the pinning exists to prevent, reintroduced one function
    over.
    """
    try:
        from baseline_forecaster import get_forecaster
        return str(get_forecaster(get_settings().baseline_season).valid_origins()[-1])
    except Exception as exc:  # noqa: BLE001 - the mesh still stands alone
        _log.info("no forecast origin to pin the mesh to (%s)", exc)
        return None


#: How close an archived station must sit to a live one before it is taken to
#: be the same site. The two feeds name stations differently - WAQI carries
#: "Anand Vihar, Delhi" against the archive's "Anand Vihar, Delhi - DPCC" - so
#: position is the only reliable identity, and 500 m is comfortably inside the
#: spacing of the CPCB network while being wider than the coordinate rounding
#: the two sources disagree on.
SAME_SITE_KM = 0.5


def _km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Planar distance. Good to better than a percent over a 60 km domain."""
    return float(np.hypot((a_lat - b_lat) * 111.0, (a_lon - b_lon) * 97.5))


def _blend(live: dict[str, Any], archive: dict[str, Any] | None) -> dict[str, Any]:
    """Live stations, filled out with archived ones where nothing live exists.

    Only about 24 NCR stations report to WAQI in any given hour, against 56 the
    archive can index, so a live-only mesh draws a quarter of the network and
    leaves most of the map empty. The rest of those stations have not closed -
    they simply published last on the archive's clock.

    They are carried here with `freshness: "archive"` and their own `as_of`,
    never merged into the live figures. Two rules keep that from becoming the
    blend this endpoint used to refuse:

      * a reader can tell them apart, because every station says which hour it
        is speaking for and the map draws the two differently;

      * they are excluded from `count`, `indexable` and anything computed from
        them, so no headline number, range or zone average is ever a mix of two
        timestamps. A supplemented station is something you can look up, not
        something that moves an aggregate.

    Where both feeds have the same site the live reading wins outright.
    """
    # The window the recorder has accumulated for these stations. The live feed
    # itself carries no history - this is the only place a live station's chart
    # can come from, and before the recorder has run it is simply empty, which
    # the chart states rather than fills.
    # The unit the feed publishes, so a concentration series and a sub-index
    # series are never averaged into one another. CPCB's bulletin gives
    # sub-indices only; WAQI and the archive give ug/m3.
    has_conc = any(
        (sub or {}).get("concentration") is not None
        for st in live["stations"]
        for sub in (st.get("sub_indices") or {}).values()
    )
    try:
        recorded = live_history.history(
            [int(s["id"]) for s in live["stations"]], live["as_of"],
            unit=live_history.UGM3 if has_conc else live_history.SUBINDEX,
        )
    except Exception as exc:  # noqa: BLE001 - a missing chart, not a failed mesh
        _log.warning("live history unavailable (%s)", exc)
        recorded = {}

    out = [
        {
            **s,
            "freshness": "live",
            "as_of": live["as_of"],
            "hourly": recorded.get(int(s["id"]), {}),
            # Not the same quantity as the archive's hourly readings: the live
            # feed publishes a 24-hour mean, so sampling it gives a rolling
            # mean. Named here so the chart can say which it is drawing.
            "history_kind": live_history.KIND,
        }
        for s in live["stations"]
    ]
    if not archive or not archive.get("stations"):
        return {**live, "stations": out, "supplemented": 0, "supplement_as_of": None}

    fixes = [(s["lat"], s["lon"]) for s in live["stations"]]
    added = 0
    for s in archive["stations"]:
        if any(_km(s["lat"], s["lon"], f_lat, f_lon) <= SAME_SITE_KM
               for f_lat, f_lon in fixes):
            continue
        out.append({**s, "freshness": "archive", "as_of": archive["as_of"],
                    "history_kind": "hourly_readings"})
        added += 1

    return {
        **live,
        "stations": out,
        # count and indexable stay live-only on purpose - see the docstring.
        "supplemented": added,
        "supplement_as_of": archive["as_of"],
    }


def _live_mesh() -> dict[str, Any] | None:
    """The live mesh the page is served, whichever feed answered.

    Extracted because two callers need the *same* answer and did not have it.
    `/api/v1/stations` prefers CPCB's bulletin and falls back to WAQI, while the
    live-history recorder called `waqi_live.mesh()` directly. Once CPCB started
    answering, the page was drawing CPCB station ids and the recorder was
    storing WAQI ones, so every history lookup missed and the particulate cards
    had empty sparklines over a recorder that was faithfully filling up with
    stations nobody was displaying.
    """
    live = None
    try:
        live = cpcb_live.mesh()
    except Exception as exc:  # noqa: BLE001 - WAQI and the archive still stand
        _log.warning("CPCB bulletin unavailable (%s); trying WAQI", exc)

    try:
        if live is None or live["indexable"] < MIN_LIVE_STATIONS:
            live = waqi_live.mesh() or live
    except Exception as exc:  # noqa: BLE001 - the archive still stands
        # `_log`, not `log`: this handler runs precisely when the live feed has
        # failed, and a bare `log` is unbound at module scope, so the fallback
        # would have raised NameError over the error it exists to report.
        _log.warning("live mesh unavailable (%s); serving the archive", exc)
    return live


@app.get("/api/v1/stations")
async def stations(response: Response):
    """
    The real monitoring mesh, with a National AQI per station.

    Every figure is measured at the station it is attributed to - PM2.5,
    PM10, NO2, O3 and SO2 from its own sensors, indexed under CPCB's 2014
    National AQI. Nothing here is interpolated from a neighbour.

    The AQI is the worst of the sub-indices, so it is greater than or equal
    to the console's PM2.5-only figure; `prominent_pollutant` names which
    one is responsible, which is how the two pages reconcile.

    A station that cannot meet CPCB's rules - three pollutants, one of them
    particulate, enough valid hours - reports `valid: false` and its reasons
    rather than a number. Read that field before reading `aqi`.
    """
    cfg = get_settings()

    # Live first. The archive publishes about 42 hours behind - that is the
    # source's lag, not the fetcher's - so when a live feed is configured it is
    # simply the better answer to "what is the air doing".
    #
    # All of one or all of the other, never a blend. A mesh where some nodes are
    # live and the rest are two days old cannot be read: the map would show one
    # hour and the table beside it another, with nothing on screen to say which
    # node was which.
    # CPCB's own bulletin first, WAQI second.
    #
    # Both are the same stations; the difference is how many hands the numbers
    # pass through. WAQI republishes CPCB as US EPA sub-indices, so that path
    # has to invert each index back to a concentration and drop NO2 and SO2
    # over a window mismatch. Against CPCB's own figures for the same hour,
    # Wazirpur came out 163 "Moderate" that way and 231 "Poor" from the
    # bulletin - a whole band, on the pollutant that set the index.
    #
    # Without a data.gov.in key this returns None and nothing changes.
    live = _live_mesh()

    archive = None
    try:
        archive = station_registry.build(cfg.baseline_season, _mesh_origin())
    except Exception as exc:  # noqa: BLE001 - live alone is still a mesh
        _log.warning("archive mesh unavailable (%s)", exc)

    if live is not None and live["indexable"] >= MIN_LIVE_STATIONS:
        return _blend(live, archive)

    if archive is None:
        response.status_code = 204
        return None
    data = {**archive, "source": "archive"}
    data["stations"] = [
        {**s, "freshness": "archive", "as_of": archive["as_of"],
         "history_kind": "hourly_readings"}
        for s in data["stations"]
    ]
    if not data["stations"]:
        response.status_code = 204
        return None
    return data


@app.get("/api/v1/history/city")
async def history_city(days: int = Query(default=30, ge=1, le=365)):
    """Daily city PM2.5 and AQI from the archive, oldest first.

    The dashboard carried two literals that both wanted this: a 30-day exposure
    histogram - days spent in each CPCB band - and a "temporal trend" line. The
    archive has held a year of observations the whole time and nothing served
    them.

    A day's figure is built the way CPCB builds one: each station's own 24-hour
    mean, then the mean across stations. Averaging every hourly reading in one
    pass would weight a station that reported all 24 hours the same as one that
    reported six, and the network's coverage is not uniform.

    Unfilled observations are used. The forecaster forward-fills for its own
    grid, and a filled hour is a copy of an earlier one - counting it here would
    let a dead station vote on a day it never measured. `coverage` reports how
    much of each day was real so a reader can discount a thin one.
    """
    cfg = get_settings()
    cache_key = f"history:city:{days}"
    cached = _cache_get(cache_key, 900)
    if cached:
        return cached

    try:
        from baseline_forecaster import get_forecaster
        fc = get_forecaster(cfg.baseline_season)
    except Exception as exc:  # noqa: BLE001 - no archive, no history
        _log.warning("history unavailable (%s)", exc)
        raise HTTPException(status_code=503, detail="archive unavailable") from exc

    # A day the network barely reported is not a measurement of that day. The
    # archive's newest day is usually partial - 2.8% of its station-hours when
    # this was written, from five stations - and drawn on a trend line beside
    # days at 88% it reads as a real swing rather than a thin sample.
    MIN_DAY_COVERAGE = 20.0

    times = pd.DatetimeIndex(fc.times)
    obs = fc._obs_raw                                   # (T, S), unfilled
    # Local days, because "a day of exposure" is a day where the reader lives.
    local = times.tz_convert("Asia/Kolkata")
    frame = pd.DataFrame({"day": local.date})
    out: list[dict[str, Any]] = []
    thin = 0

    for day, idx in frame.groupby("day").groups.items():
        rows = obs[np.asarray(idx, dtype=int)]
        if rows.size == 0:
            continue
        finite = np.isfinite(rows)
        # Stations with nothing that day are excluded before the mean rather
        # than nan-meaned, which keeps numpy from warning on an empty slice.
        keep = finite.any(axis=0)
        if not keep.any():
            continue
        with np.errstate(invalid="ignore"):
            per_station = np.nanmean(
                np.where(finite[:, keep], rows[:, keep], np.nan), axis=0
            )
        valid = per_station[np.isfinite(per_station)]
        if valid.size == 0:
            continue
        pm = float(valid.mean())
        coverage = round(float(finite.mean()) * 100, 1)
        if coverage < MIN_DAY_COVERAGE:
            thin += 1
            continue
        idx_val = aqi_cpcb.sub_index("pm25", pm)
        out.append({
            "date": str(day),
            "pm25": round(pm, 1),
            "aqi": idx_val,
            "band": aqi_cpcb.category_for(idx_val) if idx_val is not None else None,
            "stations": int(valid.size),
            # Share of the day's station-hours that were actually reported.
            "coverage_pct": coverage,
        })

    out = out[-days:]
    bands: dict[str, int] = {}
    for d in out:
        if d["band"]:
            bands[d["band"]] = bands.get(d["band"], 0) + 1

    payload = {
        "days": out,
        "band_days": bands,
        "window_days": len(out),
        # Reported rather than hidden: a reader comparing this to a 30-day
        # request should be able to see why it is shorter.
        "days_excluded_thin": thin,
        "min_coverage_pct": MIN_DAY_COVERAGE,
        "season": cfg.baseline_season,
        "index": "CPCB National AQI (2014), PM2.5 sub-index",
        "note": (
            "Each day is the mean across stations of each station's own 24-hour "
            "mean, from unfilled observations."
        ),
    }
    _cache_set(cache_key, payload)
    return payload


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

    Presence is not freshness. The extract is committed to the repository and
    refreshes only when someone re-runs the partner fetcher and pushes, so a
    200 here can carry a cycle whose forecast window has already passed. Check
    `freshness.status` - fresh, aging, stale or expired - rather than assuming
    that a body means current data.
    """
    data = gfs_reader.load()
    if data is None:
        response.status_code = 204
        return None
    return data


def _station_grid_index(lats, lons):
    """Grid cell holding each station, matching forecast_station's lookup."""
    lat_vec = np.linspace(NCR_LAT_MIN, NCR_LAT_MAX, GRID_H)
    lon_vec = np.linspace(NCR_LON_MIN, NCR_LON_MAX, GRID_W)
    hi = np.clip(np.searchsorted(lat_vec, lats), 0, GRID_H - 1)
    wi = np.clip(np.searchsorted(lon_vec, lons), 0, GRID_W - 1)
    return hi, wi


def _rolling_24h_max(series: np.ndarray) -> np.ndarray:
    """Worst 24-hour mean over the horizon, per station.

    `series` is (hours, stations). CPCB indexes particulates on a 24-hour mean,
    so the quantity a GRAP stage is set from is a mean over a day, never an
    instantaneous value.
    """
    hours = series.shape[0]
    if hours < 24:
        return series.mean(axis=0)
    csum = np.cumsum(np.vstack([np.zeros((1, series.shape[1]), series.dtype), series]), axis=0)
    windows = (csum[24:] - csum[:-24]) / 24.0     # (hours-23, stations)
    return windows.max(axis=0)


@app.get("/api/v1/policy/grap")
async def policy_grap():
    """
    GRAP stage for the next 72 hours, from the forecast city AQI.

    This took the single largest PM2.5 value anywhere on the 70x80 grid at any
    of the 72 hours and set the stage from it. Two things were wrong with that
    and both inflated it. An instantaneous value is not what CPCB indexes -
    particulates are indexed on a 24-hour mean - and a maximum over 5,600 cells
    and 72 hours is whatever the single worst cell happens to be, so one faulty
    sensor set national policy advice. On the September 2026 window it returned
    Stage 4, "Severe+", while every station on the same page read Satisfactory
    or Moderate: the page contradicted itself and the wrong half was the one
    giving instructions.

    The stage now comes from the forecast city AQI - the mean across stations of
    each station's worst 24-hour window - which is the quantity CAQM actually
    invokes GRAP on. The worst single station is reported alongside it as a
    hotspot rather than being allowed to speak for the city.
    """
    cfg = get_settings()
    cache_key = "policy:grap:city"
    cached = _cache_get(cache_key, cfg.cache_ttl_s)
    if cached:
        return cached

    pred, is_synthetic = await get_forecast_tensor()     # (1, 72, 12, 70, 80)
    pm25 = pred[0, :, CH_PM25].numpy() * 500.0           # (72, 70, 80) ug/m3

    basis = "stations"
    names: list[str] = []
    try:
        from baseline_forecaster import get_forecaster
        fc = get_forecaster(cfg.baseline_season)
        hi, wi = _station_grid_index(fc.lats, fc.lons)
        series = pm25[:, hi, wi]                          # (72, n_stations)
        names = [str(i) for i in fc.station_ids]
    except Exception as exc:  # noqa: BLE001
        # No station geometry available - the trained-model path, or a failed
        # archive load. Fall back to a high spatial percentile rather than the
        # maximum, so the answer is still not decided by one cell.
        _log.info("GRAP falling back to a grid percentile (%s)", exc)
        basis = "grid_p95"
        series = np.percentile(pm25.reshape(pm25.shape[0], -1), 95, axis=1)[:, None]

    worst_24h = _rolling_24h_max(series)                  # (n_stations,)
    city_pm25 = float(np.mean(worst_24h))
    city_aqi = calculate_indian_aqi_pm25(city_pm25)
    grap = evaluate_grap_stage(city_aqi)

    k = int(np.argmax(worst_24h))
    hotspot_pm25 = float(worst_24h[k])

    response = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "basis": basis,
        "window_hours": 24,
        "horizon_hours": int(pm25.shape[0]),
        "city_pm25_ugm3": round(city_pm25, 2),
        "city_aqi": city_aqi,
        "grap": grap,
        "hotspot": {
            "station_id": names[k] if names else None,
            "pm25_ugm3": round(hotspot_pm25, 2),
            "aqi": calculate_indian_aqi_pm25(hotspot_pm25),
        },
        "stations_considered": int(worst_24h.size),
        "is_synthetic": bool(is_synthetic),
        "message": (
            "Stage is set from the forecast city AQI - the mean across stations of "
            "each station's worst 24-hour mean over the horizon, which is what CAQM "
            "invokes GRAP on. The hotspot is reported separately and does not set "
            "the stage."
        ),
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



def _live_diurnal_source(fc):
    """"Same hour yesterday" from the live feed, for hours the archive misses.

    The archive's observations end about two days back, so a forecast issued
    today has no diurnal parent for any lead and falls to CAMS alone at 83.41
    against the blend's 62.23. The live feed does cover those hours, and
    `live_history` has been recording them; this is what joins the two.

    Live stations and archive stations are different networks with different
    ids, so they are paired by position - nearest archive station within
    `MATCH_KM`, each used once. Beyond that radius they are different sites and
    pairing them would publish one station's air under another's name.

    Returns None when nothing usable is recorded, which leaves the lead on CAMS
    rather than on a thin or invented field.
    """
    import numpy as np

    MATCH_KM = 2.0
    mesh = None
    for feed in (cpcb_live, waqi_live):
        try:
            mesh = feed.mesh()
        except Exception:  # noqa: BLE001 - absence is a normal state here
            mesh = None
        if mesh:
            break
    if not mesh:
        return None

    # archive station -> nearest live station, within the radius
    pairs: list[tuple[int, int]] = []
    used_live: set[int] = set()
    for a_i, (a_lat, a_lon) in enumerate(zip(fc.lats, fc.lons)):
        best, best_d = None, MATCH_KM
        for m in mesh["stations"]:
            if m["id"] in used_live or m.get("lat") is None:
                continue
            d = float(np.hypot((a_lat - m["lat"]) * 111.0, (a_lon - m["lon"]) * 97.5))
            if d < best_d:
                best, best_d = m["id"], d
        if best is not None:
            used_live.add(best)
            pairs.append((a_i, best))
    if not pairs:
        return None

    live_ids = [lid for _, lid in pairs]

    def source(hour):
        recorded = live_history.history(live_ids, hour.isoformat(), hours=1)
        if not recorded:
            return None
        out = np.full(len(fc.lats), np.nan, dtype=np.float32)
        for a_i, lid in pairs:
            series = (recorded.get(lid) or {}).get("pm25")
            if series and series[0] is not None:
                out[a_i] = series[0]
        return out

    return source

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
        rh_all: list[float] = []

        for did, hi, wi in cells:
            f = arr[t, :, hi, wi] * norms
            pm25, o3, nox = float(f[0]), float(f[2]), float(f[3])
            u, v = float(f[4]), float(f[5])
            temp, solar, pbl = float(f[6]), float(f[8]), float(f[9])
            # Relative humidity, from the archived weather forecast like temp
            # and PBL. It has been in the channel stack all along and was the
            # one met field the frames payload dropped, so the dashboard's
            # humidity card had nothing to read and carried a literal instead.
            rh = float(f[7])
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
                "rh": round(rh, 1),
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
            rh_all.append(rh)

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
            "avgRh": round(float(np.mean(rh_all)), 1),
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
