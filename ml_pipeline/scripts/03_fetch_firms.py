import os
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
import io

env_path = r"c:\Users\ayush\OneDrive\Desktop\air_pollution\external_data_pipeline\.env"
load_dotenv(env_path)
MAP_KEY = os.getenv("NASA_FIRMS_KEY", "")

if not MAP_KEY or MAP_KEY == "your_nasa_firms_map_key_here":
    print("Warning: NASA_FIRMS_KEY is not set or invalid.")
    exit(1)

SOURCE = "VIIRS_SNPP_SP"
BBOX = "74.0,27.0,78.5,32.5" # west,south,east,north

# Chunk 1: Nov 1 to Nov 5 (5 days)
url1 = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{BBOX}/5/2023-11-01"
# Chunk 2: Nov 6 to Nov 7 (2 days)
url2 = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{BBOX}/2/2023-11-06"

dfs = []

for u in [url1, url2]:
    print(f"Fetching: {u.replace(MAP_KEY, 'HIDDEN_KEY')}")
    res = requests.get(u)
    if res.status_code == 200:
        try:
            df = pd.read_csv(io.StringIO(res.text))
            dfs.append(df)
        except Exception as e:
            print(f"Failed to parse CSV: {e}")
            print(res.text[:200])
    else:
        print(f"Error {res.status_code}: {res.text}")

if dfs:
    final_df = pd.concat(dfs, ignore_index=True)
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'firms_20231101_20231107.csv')
    final_df.to_csv(out_path, index=False)
    print(f"Total fire hotspots retrieved: {len(final_df)}")
    print(f"Saved FIRMS data to {out_path}")
else:
    print("No data retrieved.")
