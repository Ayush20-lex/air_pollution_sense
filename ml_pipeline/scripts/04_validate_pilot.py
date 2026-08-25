import os
import pandas as pd
import xarray as xr
import json

data_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
openaq_file = os.path.join(data_dir, 'openaq_20231101_20231107.csv')
era5_file = os.path.join(data_dir, 'era5_20231101_20231107.nc')
firms_file = os.path.join(data_dir, 'firms_20231101_20231107.csv')

report = {
    "status": "ACCEPTED",
    "files": {},
    "air_quality": {},
    "era5": {},
    "firms": {},
    "cross_source": {},
    "quality_issues": [],
    "blockers": []
}

def add_issue(msg, is_blocker=False):
    report["quality_issues"].append(msg)
    if is_blocker:
        report["blockers"].append(msg)
        report["status"] = "REJECTED"

# --- OPENAQ VALIDATION ---
if os.path.exists(openaq_file):
    try:
        aq_df = pd.read_csv(openaq_file)
        aq_df['timestamp_utc'] = pd.to_datetime(aq_df['timestamp_utc'])
        if aq_df['timestamp_utc'].dt.tz is not None:
            aq_df['timestamp_utc'] = aq_df['timestamp_utc'].dt.tz_convert('UTC').dt.tz_localize(None)
        
        report["air_quality"]["row_count"] = len(aq_df)
        report["air_quality"]["station_count"] = aq_df['location_id'].nunique()
        report["air_quality"]["earliest_timestamp"] = str(aq_df['timestamp_utc'].min())
        report["air_quality"]["latest_timestamp"] = str(aq_df['timestamp_utc'].max())
        
        # Unique hourly timestamps
        unique_hours = aq_df['timestamp_utc'].dt.floor('h').nunique()
        report["air_quality"]["unique_hourly_timestamps"] = unique_hours
        
        # Check units and missing values
        params = aq_df['parameter'].unique()
        for p in ["pm25", "pm10", "o3", "no2"]:
            if p not in params:
                add_issue(f"Missing parameter in OpenAQ: {p}", is_blocker=False)
                
        # Value ranges and missing
        missing_count = aq_df['value'].isna().sum()
        report["air_quality"]["missing_values"] = int(missing_count)
        if missing_count > 0:
            add_issue(f"OpenAQ contains {missing_count} missing values")
            
        # Duplicate check (same location, param, time)
        dups = aq_df.duplicated(subset=['location_id', 'parameter', 'timestamp_utc']).sum()
        report["air_quality"]["duplicate_observations"] = int(dups)
        if dups > 0:
            add_issue(f"OpenAQ contains {dups} duplicate observations")
            
        # Add hours list for cross-source
        aq_hours = set(aq_df['timestamp_utc'].dt.floor('h').unique())
    except Exception as e:
        add_issue(f"Failed to read/parse OpenAQ data: {e}", is_blocker=True)
        aq_hours = set()
else:
    add_issue("OpenAQ file not found", is_blocker=True)
    aq_hours = set()

# --- ERA5 VALIDATION ---
if os.path.exists(era5_file):
    try:
        ds = xr.open_dataset(era5_file)
        
        expected_vars = ['u10', 'v10', 'd2m', 't2m', 'blh', 'ssrd']
        found_vars = list(ds.data_vars)
        report["era5"]["variables"] = found_vars
        
        for v in expected_vars:
            if v not in found_vars:
                add_issue(f"ERA5 missing expected variable: {v}", is_blocker=True)
                
        time_coord = ds.time if hasattr(ds, 'time') else ds.valid_time
        report["era5"]["spatial_dimensions"] = f"{len(ds.latitude)}x{len(ds.longitude)}"
        report["era5"]["timestep_count"] = len(time_coord)
        
        missing_vals = ds.isnull().to_array().sum().item()
        report["era5"]["missing_values"] = missing_vals
        if missing_vals > 0:
            add_issue(f"ERA5 contains {missing_vals} missing values", is_blocker=True)
            
        # PBL range
        if 'blh' in found_vars:
            blh_min, blh_max = ds['blh'].min().item(), ds['blh'].max().item()
            report["era5"]["pbl_range"] = [blh_min, blh_max]
            if blh_min < 0:
                add_issue(f"Invalid PBL minimum: {blh_min}")
                
        # Solar range
        if 'ssrd' in found_vars:
            ssrd_min, ssrd_max = ds['ssrd'].min().item(), ds['ssrd'].max().item()
            report["era5"]["solar_range"] = [ssrd_min, ssrd_max]
            
        # Wind range
        if 'u10' in found_vars and 'v10' in found_vars:
            report["era5"]["u_wind_range"] = [ds['u10'].min().item(), ds['u10'].max().item()]
            report["era5"]["v_wind_range"] = [ds['v10'].min().item(), ds['v10'].max().item()]
            
        times = pd.to_datetime(time_coord.values)
        if hasattr(times, 'tz') and times.tz is not None:
            times = times.tz_convert('UTC').tz_localize(None)
        era5_hours = set(times)
        
        ds.close()
    except Exception as e:
        add_issue(f"Failed to read/parse ERA5 data: {e}", is_blocker=True)
        era5_hours = set()
else:
    add_issue("ERA5 file not found", is_blocker=True)
    era5_hours = set()

# --- FIRMS VALIDATION ---
if os.path.exists(firms_file):
    try:
        firms_df = pd.read_csv(firms_file)
        
        report["firms"]["fire_event_count"] = len(firms_df)
        
        if len(firms_df) > 0:
            # Depending on SOURCE, FIRMS CSV column names might vary slightly, usually 'acq_date' and 'acq_time'
            if 'acq_date' in firms_df.columns and 'acq_time' in firms_df.columns:
                # acq_time is often something like 1345 for 13:45
                firms_df['acq_time_str'] = firms_df['acq_time'].astype(str).str.zfill(4)
                firms_df['timestamp_utc'] = pd.to_datetime(
                    firms_df['acq_date'] + ' ' + 
                    firms_df['acq_time_str'].str[:2] + ':' + 
                    firms_df['acq_time_str'].str[2:] + ':00',
                    utc=True
                ).dt.tz_localize(None)
                
                report["firms"]["timestamp_coverage"] = [str(firms_df['timestamp_utc'].min()), str(firms_df['timestamp_utc'].max())]
                firms_hours = set(firms_df['timestamp_utc'].dt.floor('h').unique())
            else:
                add_issue("FIRMS data missing acq_date/acq_time columns", is_blocker=True)
                firms_hours = set()
                
            if 'frp' in firms_df.columns:
                report["firms"]["frp_exists"] = True
                report["firms"]["frp_range"] = [float(firms_df['frp'].min()), float(firms_df['frp'].max())]
                if firms_df['frp'].min() < 0:
                    add_issue("FRP has negative values")
            else:
                report["firms"]["frp_exists"] = False
                add_issue("FIRMS data missing FRP column", is_blocker=True)
                
            report["firms"]["geographic_coverage"] = {
                "lat": [float(firms_df['latitude'].min()), float(firms_df['latitude'].max())],
                "lon": [float(firms_df['longitude'].min()), float(firms_df['longitude'].max())]
            }
            if 'satellite' in firms_df.columns:
                report["firms"]["satellite_source"] = firms_df['satellite'].unique().tolist()
        else:
            add_issue("FIRMS data is empty (0 rows)")
            firms_hours = set()
            
    except Exception as e:
        add_issue(f"Failed to read/parse FIRMS data: {e}", is_blocker=True)
        firms_hours = set()
else:
    add_issue("FIRMS file not found", is_blocker=True)
    firms_hours = set()

# --- CROSS-SOURCE VALIDATION ---
report["cross_source"]["hours_with_aq"] = len(aq_hours)
report["cross_source"]["hours_with_era5"] = len(era5_hours)
report["cross_source"]["hours_with_firms"] = len(firms_hours)

common_hours = aq_hours.intersection(era5_hours)
report["cross_source"]["common_hourly_timeline_aq_era5"] = len(common_hours)

if len(common_hours) < 24 * 7 * 0.9: # less than 90% coverage
    add_issue(f"Low common hourly overlap between AQ and ERA5: {len(common_hours)} hours", is_blocker=False)

for file, key in [(openaq_file, 'OpenAQ'), (era5_file, 'ERA5'), (firms_file, 'FIRMS')]:
    if os.path.exists(file):
        report["files"][key] = {
            "path": file,
            "size_mb": round(os.path.getsize(file) / (1024 * 1024), 2)
        }

total_size_mb = sum(f['size_mb'] for f in report["files"].values())
report["total_data_size_mb"] = total_size_mb

print(json.dumps(report, indent=2))
