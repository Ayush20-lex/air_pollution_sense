import time
import torch
from backend.api_server import _generate_forecast_tensor, _tensor_to_geojson, get_settings, lifespan
from fastapi import FastAPI
import asyncio

app = FastAPI()

async def measure():
    cfg = get_settings()
    print(f"torch.cuda.is_available(): {torch.cuda.is_available()}")
    print(f"inference device: {cfg.device}")
    
    async with lifespan(app):
        # Measure _generate_forecast_tensor
        t0 = time.time()
        # I need to break down _generate_forecast_tensor to get data prep vs inference
        from backend.api_server import _state, generate_mock_cpcb_df, fetch_live_cpcb_waqi_df, generate_mock_firms_df, GRID_H, GRID_W, _CHANNEL_NORMS, _build_synthetic_history
        import numpy as np
        
        t_prep_0 = time.time()
        cpcb_df = generate_mock_cpcb_df()
        firms_df = generate_mock_firms_df()
        imd_grids = {
            "u_wind":    np.full((GRID_H, GRID_W), -2.1, np.float32),
            "v_wind":    np.full((GRID_H, GRID_W),  3.4, np.float32),
            "temp":      np.random.default_rng(seed=7).uniform(12, 24, (GRID_H, GRID_W)).astype(np.float32),
            "rh":        np.random.default_rng(seed=8).uniform(55, 85, (GRID_H, GRID_W)).astype(np.float32),
            "solar_irr": np.random.default_rng(seed=9).uniform(180, 600, (GRID_H, GRID_W)).astype(np.float32),
            "pbl":       np.random.default_rng(seed=10).uniform(280, 800, (GRID_H, GRID_W)).astype(np.float32),
        }
        fire_transport = _state.fusion.compute_fire_transport(firms_df, u_wind_ms=-2.1, v_wind_ms=3.4)
        frame = _state.fusion.build_channel_stack(cpcb_df, imd_grids, fire_transport)
        frame_norm = (frame / _CHANNEL_NORMS[:, None, None]).astype(np.float32)
        history = _build_synthetic_history(frame_norm, n_steps=24)
        x = torch.tensor(history[None], dtype=torch.float32).to(cfg.device)
        t_prep_1 = time.time()
        
        t_inf_0 = time.time()
        with torch.inference_mode():
            pred = _state.model(x)
        pred = pred.cpu()
        t_inf_1 = time.time()
        
        print(f"Data preparation time: {t_prep_1 - t_prep_0:.4f} seconds")
        print(f"Model inference time: {t_inf_1 - t_inf_0:.4f} seconds")
        print(f"Total time inside _generate_forecast_tensor (approx): {(t_prep_1 - t_prep_0) + (t_inf_1 - t_inf_0):.4f} seconds")
        
        # Measure GeoJSON serialization
        t_geo_0 = time.time()
        geojson = _tensor_to_geojson(pred, step=0, channels=[0, 6, 9, 8])
        t_geo_1 = time.time()
        
        print(f"GeoJSON serialization time: {t_geo_1 - t_geo_0:.4f} seconds")
        
if __name__ == '__main__':
    asyncio.run(measure())
