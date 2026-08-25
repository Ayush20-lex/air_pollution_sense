import os
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv

env_path = r"c:\Users\ayush\OneDrive\Desktop\air_pollution\external_data_pipeline\.env"
load_dotenv(env_path)
API_KEY = os.getenv("OPENAQ_API_KEY", "")

LAT, LON = 28.6139, 77.2090
RADIUS = 25000
DATE_FROM = "2023-11-01T00:00:00Z"
DATE_TO = "2023-11-07T23:59:59Z"
# We'll look for these parameters
TARGET_PARAMS = {"pm25", "pm10", "o3", "no2"}

headers = {}
if API_KEY:
    headers["X-API-Key"] = API_KEY

print("Fetching locations in Delhi NCR...")
loc_url = "https://api.openaq.org/v3/locations"
loc_params = {
    "coordinates": f"{LAT},{LON}",
    "radius": RADIUS,
    "limit": 100
}

import time
max_retries = 5
backoff_factor = 2

for attempt in range(max_retries):
    loc_res = requests.get(loc_url, headers=headers, params=loc_params)
    if loc_res.status_code == 429:
        sleep_time = backoff_factor ** attempt
        print(f"Rate limited on locations. Retrying in {sleep_time} seconds (Attempt {attempt + 1}/{max_retries})...")
        time.sleep(sleep_time)
        continue
    elif loc_res.status_code != 200:
        print(f"Error fetching locations: {loc_res.text}")
        exit(1)
    else:
        break

if loc_res.status_code != 200:
    print("Failed to fetch locations after retries.")
    exit(1)

locations = loc_res.json().get("results", [])
print(f"Found {len(locations)} locations.")

sensor_list = []
for loc in locations:
    loc_id = loc.get("id")
    loc_name = loc.get("name")
    lat = loc.get("coordinates", {}).get("latitude")
    lon = loc.get("coordinates", {}).get("longitude")
    
    for sensor in loc.get("sensors", []):
        param = sensor.get("parameter", {}).get("name")
        if param in TARGET_PARAMS:
            sensor_list.append({
                "sensor_id": sensor.get("id"),
                "location_id": loc_id,
                "location_name": loc_name,
                "parameter": param,
                "lat": lat,
                "lon": lon
            })

print(f"Found {len(sensor_list)} relevant sensors. Fetching historical data...")

out_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, 'openaq_20231101_20231107.csv')

existing_records = []
fetched_pairs = set()

if os.path.exists(out_path):
    print(f"Loading existing data from {out_path}...")
    df_existing = pd.read_csv(out_path)
    existing_records = df_existing.to_dict('records')
    for rec in existing_records:
        fetched_pairs.add((rec['location_id'], rec['parameter']))
    print(f"Loaded {len(existing_records)} existing records, covering {len(fetched_pairs)} location-parameter pairs.")

all_records = list(existing_records)

for idx, s in enumerate(sensor_list):
    if (s["location_id"], s["parameter"]) in fetched_pairs:
        print(f"[{idx+1}/{len(sensor_list)}] Skipping {s['parameter']} for {s['location_name']} (already fetched)")
        continue

    print(f"[{idx+1}/{len(sensor_list)}] Fetching {s['parameter']} for {s['location_name']}...")
    time.sleep(0.5)
    meas_url = f"https://api.openaq.org/v3/sensors/{s['sensor_id']}/measurements"
    
    page = 1
    new_sensor_records = []
    while True:
        meas_params = {
            "datetime_from": DATE_FROM,
            "datetime_to": DATE_TO,
            "limit": 1000,
            "page": page
        }
        
        for attempt in range(max_retries):
            res = requests.get(meas_url, headers=headers, params=meas_params)
            if res.status_code == 429:
                sleep_time = backoff_factor ** attempt
                print(f"  -> Rate limited. Retrying in {sleep_time} seconds (Attempt {attempt + 1}/{max_retries})...")
                time.sleep(sleep_time)
                continue
            elif res.status_code != 200:
                print(f"  -> Error: {res.status_code} {res.text}")
                break
            else:
                break
                
        if res.status_code != 200:
            print("  -> Failed to fetch after retries.")
            break
            
        data = res.json()
        results = data.get("results", [])
        if not results:
            break
            
        for r in results:
            period = r.get("period", {})
            dt_from = period.get("datetimeFrom", {}).get("utc")
            new_sensor_records.append({
                "location_id": s["location_id"],
                "location_name": s["location_name"],
                "latitude": s["lat"],
                "longitude": s["lon"],
                "parameter": s["parameter"],
                "value": r.get("value"),
                "timestamp_utc": dt_from
            })
            
        meta = data.get("meta", {})
        found = str(meta.get("found", 0))
        if found.startswith(">"):
            found = int(found.replace(">", ""))
        else:
            found = int(found)
            
        if page * 1000 >= found or not results:
            break
        page += 1
        
    if new_sensor_records:
        all_records.extend(new_sensor_records)
        df_temp = pd.DataFrame(all_records)
        df_temp.to_csv(out_path, index=False)
        fetched_pairs.add((s["location_id"], s["parameter"]))
        print(f"  -> Saved {len(new_sensor_records)} records.")

if all_records:
    df = pd.DataFrame(all_records)
    df.to_csv(out_path, index=False)
    print(f"\nSaved {len(df)} records total to {out_path}")
else:
    print("No data found.")
