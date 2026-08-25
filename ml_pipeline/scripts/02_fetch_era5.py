import os
import cdsapi
from dotenv import load_dotenv

# Load env
env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'external_data_pipeline', '.env')
load_dotenv(env_path)

out_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, 'era5_20231101_20231107.nc')

print("Connecting to CDS API...")
c = cdsapi.Client()

print(f"Fetching ERA5 data to {out_path}...")
c.retrieve(
    'reanalysis-era5-single-levels',
    {
        'product_type': 'reanalysis',
        'variable': [
            '10m_u_component_of_wind',
            '10m_v_component_of_wind',
            '2m_dewpoint_temperature',
            '2m_temperature',
            'boundary_layer_height',
            'surface_solar_radiation_downwards',
        ],
        'year': '2023',
        'month': '11',
        'day': [
            '01', '02', '03',
            '04', '05', '06',
            '07',
        ],
        'time': [
            '00:00', '01:00', '02:00',
            '03:00', '04:00', '05:00',
            '06:00', '07:00', '08:00',
            '09:00', '10:00', '11:00',
            '12:00', '13:00', '14:00',
            '15:00', '16:00', '17:00',
            '18:00', '19:00', '20:00',
            '21:00', '22:00', '23:00',
        ],
        'area': [
            29.5, 76.5, 27.5, 77.8, # North, West, South, East
        ],
        'format': 'netcdf',
    },
    out_path)

print("ERA5 fetch complete.")

import zipfile
import xarray as xr
if zipfile.is_zipfile(out_path):
    print("Downloaded file is a zip archive. Extracting and merging...")
    with zipfile.ZipFile(out_path, 'r') as zip_ref:
        nc_files = [f for f in zip_ref.namelist() if f.endswith('.nc')]
        if nc_files:
            zip_ref.extractall(out_dir)
            
            datasets = [xr.open_dataset(os.path.join(out_dir, f)) for f in nc_files]
            merged_ds = xr.merge(datasets, compat='override')
            
            # Close datasets so we can overwrite/delete files if needed
            for ds in datasets:
                ds.close()
                
            os.remove(out_path)
            merged_ds.to_netcdf(out_path)
            merged_ds.close()
            print("Extracted and merged the netcdf files.")
            
            # Clean up extracted separate files
            for f in nc_files:
                try:
                    os.remove(os.path.join(out_dir, f))
                except Exception:
                    pass
    
        else:
            print("No .nc file found in the archive.")
