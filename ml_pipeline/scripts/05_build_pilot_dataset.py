import os
import json
import numpy as np
import pandas as pd
import xarray as xr
import zarr

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
from backend.spatial_fusion import SpatialDataFusion, _GRID, GRID_H, GRID_W

def calculate_rh(t2m_k, d2m_k):
    # Convert K to C
    t2m_c = t2m_k - 273.15
    d2m_c = d2m_k - 273.15
    # Magnus formula
    es = 6.112 * np.exp((17.67 * t2m_c) / (t2m_c + 243.5))
    e = 6.112 * np.exp((17.67 * d2m_c) / (d2m_c + 243.5))
    rh = 100.0 * (e / es)
    return np.clip(rh, 0, 100)

def propagate_frp(obs_frp, current_time, obs_time):
    diff_h = (current_time - obs_time).total_seconds() / 3600.0
    if diff_h < 0: return 0.0
    if diff_h <= 2: return obs_frp
    if diff_h <= 6: return obs_frp * (1.0 - (diff_h - 2) / 4.0)
    return 0.0

def main():
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    raw_dir = os.path.join(data_dir, 'raw')
    proc_dir = os.path.join(data_dir, 'processed')
    meta_dir = os.path.join(data_dir, 'metadata')
    qual_dir = os.path.join(data_dir, 'quality')
    
    os.makedirs(proc_dir, exist_ok=True)
    os.makedirs(meta_dir, exist_ok=True)
    os.makedirs(qual_dir, exist_ok=True)

    # 1. Timeline Generation
    openaq_path = os.path.join(raw_dir, 'openaq_20231101_20231107.csv')
    era5_path = os.path.join(raw_dir, 'era5_20231101_20231107.nc')
    firms_path = os.path.join(raw_dir, 'firms_20231101_20231107.csv')
    
    df_aq = pd.read_csv(openaq_path)
    df_aq['timestamp_utc'] = pd.to_datetime(df_aq['timestamp_utc'], utc=True)
    
    ds_era5 = xr.open_dataset(era5_path)
    # the time dim is 'valid_time' or 'time'
    time_var = 'valid_time' if 'valid_time' in ds_era5.coords else 'time'
    
    df_firms = pd.read_csv(firms_path)
    # NASA FIRMS acq_date and acq_time: acq_time is HHMM
    df_firms['acq_time_str'] = df_firms['acq_time'].astype(str).str.zfill(4)
    df_firms['timestamp_utc'] = pd.to_datetime(df_firms['acq_date'] + ' ' + df_firms['acq_time_str'].str[:2] + ':' + df_firms['acq_time_str'].str[2:], utc=True)
    
    all_times = pd.concat([
        df_aq['timestamp_utc'].dt.floor('h'),
        pd.Series(pd.to_datetime(ds_era5[time_var].values, utc=True).floor('h')),
        df_firms['timestamp_utc'].dt.floor('h')
    ]).dropna().unique()
    
    start_time = pd.Timestamp("2023-11-01 00:00:00", tz="UTC")
    end_time = pd.Timestamp("2023-11-07 23:00:00", tz="UTC")
    
    time_index = pd.date_range(start_time, end_time, freq='h', tz='UTC')
    
    # 2. Identify missing hours per source
    aq_hours = df_aq['timestamp_utc'].dt.floor('h').unique()
    era5_hours = pd.to_datetime(ds_era5[time_var].values, utc=True).floor('h').unique()
    
    missing_aq = set(time_index) - set(aq_hours)
    missing_era5 = set(time_index) - set(era5_hours)
    
    missing_report = {
        "total_expected_hours": len(time_index),
        "missing_open_aq_hours": [str(t) for t in sorted(list(missing_aq))],
        "missing_era5_hours": [str(t) for t in sorted(list(missing_era5))]
    }
    
    with open(os.path.join(qual_dir, 'missing_hours_report.json'), 'w') as f:
        json.dump(missing_report, f, indent=2)
        
    # 3. Spatial Processing
    fusion = SpatialDataFusion()
    
    # Pre-process FIRMS
    # We will compute propagated FRP per hour based on previous fires
    firms_events = df_firms.copy()
    firms_events['timestamp_utc'] = pd.to_datetime(firms_events['timestamp_utc'], utc=True)
    
    tensor_list = []
    
    # Arrays for validation stats
    channel_stats = {i: {'min': [], 'max': [], 'sum': 0, 'count': 0, 'nan_count': 0, 'total': 0} for i in range(12)}
    
    for t in time_index:
        # AQ
        aq_hour_df = df_aq[df_aq['timestamp_utc'].dt.floor('h') == t]
        
        # Format for SpatialDataFusion: needs 'lat', 'lon', 'pm25', 'pm10', 'o3', 'nox'
        # Group by location and pivot
        if not aq_hour_df.empty:
            pivoted = aq_hour_df.pivot_table(index=['latitude', 'longitude'], columns='parameter', values='value').reset_index()
            pivoted.rename(columns={'latitude': 'lat', 'longitude': 'lon'}, inplace=True)
            for param in ['pm25', 'pm10', 'o3', 'nox', 'no2']:
                if param not in pivoted.columns:
                    pivoted[param] = np.nan
            if 'nox' not in pivoted.columns and 'no2' in pivoted.columns:
                pivoted['nox'] = pivoted['no2'] # Use no2 as nox if nox missing
        else:
            pivoted = pd.DataFrame(columns=['lat', 'lon', 'pm25', 'pm10', 'o3', 'nox'])
            
        # ERA5
        imd_grids = {}
        try:
            t_np = t.tz_localize(None).to_numpy()
            era5_slice = ds_era5.sel({time_var: t_np}, method='nearest', tolerance=np.timedelta64(1, 'h'))
            
            # create DataFrame for interpolation
            lon2d, lat2d = np.meshgrid(era5_slice.longitude.values, era5_slice.latitude.values)
            era5_df = pd.DataFrame({
                'lat': lat2d.ravel(),
                'lon': lon2d.ravel(),
                'u10': era5_slice['u10'].values.ravel(),
                'v10': era5_slice['v10'].values.ravel(),
                't2m': era5_slice['t2m'].values.ravel(),
                'd2m': era5_slice['d2m'].values.ravel(),
                'blh': era5_slice['blh'].values.ravel(),
                'ssrd': era5_slice['ssrd'].values.ravel()
            })
            
            # Convert units
            era5_df['t2m'] = era5_df['t2m'] - 273.15 # K to C
            era5_df['ssrd'] = era5_df['ssrd'] / 3600.0 # J/m2 (hourly accum) to W/m2
            era5_df['rh'] = calculate_rh(era5_slice['t2m'].values.ravel(), era5_slice['d2m'].values.ravel())
            
            imd_grids['u_wind'] = fusion.kriging_interpolate(era5_df, 'u10')
            imd_grids['v_wind'] = fusion.kriging_interpolate(era5_df, 'v10')
            imd_grids['temp'] = fusion.kriging_interpolate(era5_df, 't2m')
            imd_grids['pbl'] = fusion.kriging_interpolate(era5_df, 'blh')
            imd_grids['solar_irr'] = fusion.kriging_interpolate(era5_df, 'ssrd')
            imd_grids['rh'] = fusion.kriging_interpolate(era5_df, 'rh')
            
        except KeyError:
            pass # leave as empty, fusion will output nans
            
        # FIRMS
        # Find fires in the last 6 hours
        recent_fires = firms_events[(firms_events['timestamp_utc'] <= t) & (firms_events['timestamp_utc'] >= t - pd.Timedelta(hours=6))].copy()
        if not recent_fires.empty:
            recent_fires['propagated_frp'] = recent_fires.apply(lambda row: propagate_frp(row['frp'], t, row['timestamp_utc']), axis=1)
            # Use propagated FRP for smoke calculation
            recent_fires['frp'] = recent_fires['propagated_frp']
            
            mean_u = imd_grids.get('u_wind', np.zeros((GRID_H, GRID_W))).mean()
            mean_v = imd_grids.get('v_wind', np.zeros((GRID_H, GRID_W))).mean()
            
            firms_transport = fusion.compute_fire_transport(recent_fires, mean_u, mean_v)
        else:
            firms_transport = {}
            
        # Build stack
        if pivoted.empty and not imd_grids:
            stack = np.full((12, GRID_H, GRID_W), np.nan, dtype=np.float32)
        else:
            # We don't want SpatialDataFusion to nearest-neighbor fill across the entire 70x80 grid if there is NO data.
            stack = fusion.build_channel_stack(pivoted, imd_grids, firms_transport)
            # Apply NaNs if source was completely missing
            if pivoted.empty:
                stack[0:4] = np.nan
            if not imd_grids:
                stack[4:10] = np.nan
            
        tensor_list.append(stack)
        
        # update stats
        for i in range(12):
            valid_vals = stack[i][~np.isnan(stack[i])]
            if len(valid_vals) > 0:
                channel_stats[i]['min'].append(valid_vals.min())
                channel_stats[i]['max'].append(valid_vals.max())
                channel_stats[i]['sum'] += valid_vals.sum()
                channel_stats[i]['count'] += len(valid_vals)
            channel_stats[i]['nan_count'] += np.isnan(stack[i]).sum()
            channel_stats[i]['total'] += stack[i].size

    # Combine to (T, C, H, W)
    full_tensor = np.stack(tensor_list, axis=0) # (T, 12, 70, 80)
    
    # 4. Save to Zarr using xarray
    zarr_path = os.path.join(proc_dir, 'pilot_dataset.zarr')
    ds_out = xr.Dataset(
        {"features": (["time", "channel", "lat", "lon"], full_tensor)},
        coords={"time": time_index.values}
    )
    ds_out.to_zarr(zarr_path, mode='w')
    
    # 5. Metadata and Schema
    schema = [
        {"channel": 0, "name": "PM2.5", "source": "OpenAQ", "type": "observed", "raw_unit": "ug/m3", "processed_unit": "ug/m3"},
        {"channel": 1, "name": "PM10", "source": "OpenAQ", "type": "observed", "raw_unit": "ug/m3", "processed_unit": "ug/m3"},
        {"channel": 2, "name": "O3", "source": "OpenAQ", "type": "observed", "raw_unit": "ug/m3", "processed_unit": "ug/m3"},
        {"channel": 3, "name": "NOx", "source": "OpenAQ", "type": "observed", "raw_unit": "ug/m3", "processed_unit": "ug/m3"},
        {"channel": 4, "name": "U-wind", "source": "ERA5", "type": "observed", "raw_unit": "m/s", "processed_unit": "m/s"},
        {"channel": 5, "name": "V-wind", "source": "ERA5", "type": "observed", "raw_unit": "m/s", "processed_unit": "m/s"},
        {"channel": 6, "name": "Temperature", "source": "ERA5", "type": "derived", "raw_unit": "K", "processed_unit": "C", "conversion": "K - 273.15"},
        {"channel": 7, "name": "Humidity", "source": "ERA5", "type": "derived", "raw_unit": "N/A", "processed_unit": "%", "conversion": "Magnus formula from T2m and D2m"},
        {"channel": 8, "name": "Solar", "source": "ERA5", "type": "derived", "raw_unit": "J/m2", "processed_unit": "W/m2", "conversion": "J/m2 / 3600"},
        {"channel": 9, "name": "PBL", "source": "ERA5", "type": "observed", "raw_unit": "m", "processed_unit": "m"},
        {"channel": 10, "name": "FRP", "source": "FIRMS", "type": "assumed", "raw_unit": "MW", "processed_unit": "MW", "conversion": "Propagated: 2h persistence, 4h decay"},
        {"channel": 11, "name": "Smoke", "source": "FIRMS", "type": "derived", "raw_unit": "N/A", "processed_unit": "intensity proxy"}
    ]
    
    with open(os.path.join(meta_dir, 'channel_schema.json'), 'w') as f:
        json.dump(schema, f, indent=2)
        
    grid_def = {
        "h": GRID_H,
        "w": GRID_W,
        "lat_bounds": [28.20, 28.90],
        "lon_bounds": [76.80, 77.60],
        "resolution": "~1km x 1km"
    }
    with open(os.path.join(meta_dir, 'grid_definition.json'), 'w') as f:
        json.dump(grid_def, f, indent=2)
        
    # 6. Validation Report
    T, C, H, W = full_tensor.shape
    complete_hours = 0
    for i in range(T):
        if not np.isnan(full_tensor[i]).all(axis=(1, 2)).any():
            complete_hours += 1
            
    val_report = {
        "dataset_shape": [T, C, H, W],
        "total_hours": T,
        "complete_hours": complete_hours,
        "incomplete_hours": T - complete_hours,
        "valid_24_to_72_sample_possible": complete_hours >= 96,
        "channels": {}
    }
    
    for i in range(12):
        c_min = min(channel_stats[i]['min']) if channel_stats[i]['min'] else None
        c_max = max(channel_stats[i]['max']) if channel_stats[i]['max'] else None
        c_mean = (channel_stats[i]['sum'] / channel_stats[i]['count']) if channel_stats[i]['count'] > 0 else None
        nan_pct = (channel_stats[i]['nan_count'] / channel_stats[i]['total']) * 100
        
        val_report["channels"][schema[i]["name"]] = {
            "source": schema[i]["source"],
            "type": schema[i]["type"],
            "raw_unit": schema[i]["raw_unit"],
            "processed_unit": schema[i]["processed_unit"],
            "min": float(c_min) if c_min is not None else None,
            "max": float(c_max) if c_max is not None else None,
            "mean": float(c_mean) if c_mean is not None else None,
            "nan_percentage": float(nan_pct)
        }
        
    with open(os.path.join(proc_dir, 'validation_report.json'), 'w') as f:
        json.dump(val_report, f, indent=2)
        
    print(f"PILOT DATASET CREATED:")
    print(f"- Location: {zarr_path}")
    print(f"- Format: Zarr")
    print(f"- Shape: {full_tensor.shape}")
    print(f"- Complete Hours: {complete_hours}")
    print(f"- Incomplete Hours: {T - complete_hours}")
    print(f"- Valid 24->72h sample possible: {complete_hours >= 96}")
    
if __name__ == '__main__':
    main()
