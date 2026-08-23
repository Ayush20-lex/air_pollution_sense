# Air Pollution–Weather Coupled Forecasting System (Delhi NCR Focus)
### Smart India Hackathon (SIH) | Problem ID: SIH26082
**Role: Member 3 – Data Pipeline & API Engineer**

---

## Overview
A production-ready, modular, and resilient backend data ingestion pipeline and RESTful API service built using **Python, FastAPI, SQLAlchemy, and PostgreSQL**. 

The system continuously acquires, sanitizes, normalizes, and serves high-resolution atmospheric, meteorological, and satellite fire hotspot data across Delhi NCR and surrounding regional stubble burning belts (Punjab, Haryana, and Western UP). It provides real-time telemetry and coupled feature vectors for downstream WRF-Chem atmospheric modeling, ML forecasters, and interactive frontend dashboards.

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph DataSources["External Data Ingestion Sources"]
        CPCB["CPCB / OpenAQ CAAQMS<br/>(PM2.5, PM10, O3, NOx)"]
        MET["Open-Meteo / IMD GFS<br/>(Temp, Humidity, Wind, PBLH)"]
        FIRMS["NASA FIRMS Satellites<br/>(VIIRS/MODIS Stubble Fires)"]
    end

    subgraph PreprocessingEngine["Data Cleaning & Atmospheric Pre-processing"]
        CLEAN["Outlier Filtering & UTC Normalization"]
        NAQI["CPCB National AQI (NAQI) Engine"]
        INVERSION["Boundary Layer Inversion & Ventilation Index"]
        DEDUP["Composite Deduplication Filter"]
    end

    subgraph DatabaseLayer["Relational Data Store (PostgreSQL / SQLite)"]
        AQ_TBL[("air_quality_readings<br/>(Composite Station+Time Index)")]
        W_TBL[("weather_readings<br/>(Composite Loc+Time Index)")]
        F_TBL[("fire_hotspots<br/>(Spatial Lat/Lon & Time Index)")]
    end

    subgraph ServiceLayer["FastAPI REST & Feature Serving"]
        SCHED["APScheduler Background Cron Runner"]
        API_AQ["/api/air-quality/*"]
        API_W["/api/weather/*"]
        API_F["/api/fires/*"]
        API_LATEST["/api/data/latest (Unified Payload)"]
    end

    subgraph Consumers["Downstream Consumers"]
        ML_MODELS["Coupled WRF-Chem & ML AQI Forecasters"]
        DASHBOARD["SIH Web / Mobile Frontend Dashboard"]
    end

    CPCB --> CLEAN
    MET --> CLEAN
    FIRMS --> CLEAN

    CLEAN --> NAQI
    CLEAN --> INVERSION
    NAQI --> DEDUP
    INVERSION --> DEDUP

    DEDUP --> AQ_TBL
    DEDUP --> W_TBL
    DEDUP --> F_TBL

    SCHED -.->|Periodic Trigger| CPCB
    SCHED -.->|Periodic Trigger| MET
    SCHED -.->|Periodic Trigger| FIRMS

    AQ_TBL --> API_AQ
    W_TBL --> API_W
    F_TBL --> API_F
    AQ_TBL & W_TBL & F_TBL --> API_LATEST

    API_LATEST --> ML_MODELS
    API_LATEST --> DASHBOARD
    API_AQ & API_W & API_F --> DASHBOARD
```

---

## Key Features & Module Capabilities

### 1. Multi-Source Ingestion Engine (`app/ingestion/`)
- **Air Quality Fetcher (`cpcb_fetcher.py`)**: Gathers real-time PM2.5, PM10, NOx, and O3 measurements across key Delhi NCR stations (Anand Vihar, RK Puram, Punjabi Bagh, ITO, IGI Airport T3, Jahangirpuri, Dwarka, Noida Sec 62, Gurugram Vikas Sadan, Ghaziabad).
- **Meteorology & Boundary Layer Fetcher (`weather_fetcher.py`)**: Fetches temperature, relative humidity, wind speed, wind direction, and Planetary Boundary Layer (PBL) height across NCR spatial nodes.
- **NASA FIRMS Stubble Fire Fetcher (`firms_fetcher.py`)**: Telemetry consumer for active fire hotspots across the agricultural corridor (Punjab, Haryana, Western UP) with high-intensity brightness analysis.

### 2. Standard CPCB NAQI & Inversion Pre-processing (`app/ingestion/cleaner.py`)
- **Indian National AQI (NAQI) Standard**: Exact breakpoint linear interpolation for PM2.5, PM10, NOx, and Ozone sub-indices, category classification (*Good, Satisfactory, Moderate, Poor, Very Poor, Severe*), and dominant pollutant identification.
- **Atmospheric Inversion Coupler**: Detects nocturnal shallow boundary layer trapping ($PBLH < 400\,\text{m}$ combined with calm wind $< 2.0\,\text{m/s}$) and computes Ventilation Index ($VI = \text{Wind Speed} \times \text{PBL Height}$).
- **Data Sanitization**: Rejects negative sensor error codes (-999), clamps physical sensor ranges, and normalizes timestamps to ISO 8601 UTC.
- **Deduplication**: Enforces database composite constraints to ensure idempotency.

### 3. Background Automation (`app/scheduler/`)
- Uses `APScheduler` async cron runner configured to fetch data at customizable intervals (e.g., hourly for AQI/Weather, 3-hourly for FIRMS).
- Graceful startup and shutdown lifecycle management inside FastAPI `lifespan`.

### 4. RESTful API Endpoints (`app/routers/`)
- `GET /api/data/latest`: Consolidated single-call payload containing latest NCR AQI averages, weather conditions, boundary layer inversion status, 24h fire counts, and ML feature vector.
- `GET /api/air-quality`: Filterable by `station_id`, `location`, `start_time`, `end_time`, `limit`, `offset`.
- `GET /api/air-quality/stations`: Monitored station catalog with GPS coordinates.
- `GET /api/air-quality/stats`: NCR-wide statistical breakdown.
- `GET /api/weather`: Filterable by `location`, `start_time`, `end_time`, `inversion_only`.
- `GET /api/weather/inversion-analysis`: Risk analysis of atmospheric dispersion and trapping.
- `GET /api/fires`: Filterable by `region`, `min_confidence`, `start_date`, `end_date`, `bbox` (`min_lat`, `min_lon`, `max_lat`, `max_lon`).
- `GET /api/fires/stats`: 24h/48h regional fire count breakdown.
- `POST /api/ingest/trigger`: On-demand manual ingestion triggering.
- `GET /api/health`: Database connectivity latency and record counters.

---

## Database Schema (PostgreSQL ORM)

```sql
-- Air Quality Readings Table
CREATE TABLE air_quality_readings (
    id SERIAL PRIMARY KEY,
    station_id VARCHAR(100) NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    pm25 FLOAT,
    pm10 FLOAT,
    o3 FLOAT,
    nox FLOAT,
    aqi_calculated FLOAT,
    aqi_category VARCHAR(50),
    dominant_pollutant VARCHAR(20),
    timestamp_utc TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_station_timestamp UNIQUE (station_id, timestamp_utc)
);

-- Weather Readings Table
CREATE TABLE weather_readings (
    id SERIAL PRIMARY KEY,
    location_name VARCHAR(255) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    temperature FLOAT,
    humidity FLOAT,
    wind_speed FLOAT,
    wind_direction FLOAT,
    pbl_height FLOAT,
    inversion_flag BOOLEAN DEFAULT FALSE,
    ventilation_index FLOAT,
    timestamp_utc TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_weather_loc_timestamp UNIQUE (location_name, timestamp_utc)
);

-- Fire Hotspots Table
CREATE TABLE fire_hotspots (
    id SERIAL PRIMARY KEY,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    brightness FLOAT,
    confidence VARCHAR(50),
    satellite VARCHAR(50),
    region VARCHAR(100),
    acq_datetime_utc TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_fire_location_time UNIQUE (latitude, longitude, acq_datetime_utc)
);
```

---

## Quick Start & Installation

### 1. Clone & Setup Environment
```bash
# Navigate to project directory
cd datapipeline

# Create Python virtual environment (recommended)
python -m venv venv
# Activate on Windows:
.\venv\Scripts\activate
# Activate on Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` as needed:
```ini
# For PostgreSQL:
DB_URL=postgresql://postgres:postgres@localhost:5432/delhi_aqi_db

# For standalone local development / testing without PostgreSQL:
# DB_URL=sqlite:///./delhi_aqi.db

# NASA FIRMS API Key:
NASA_FIRMS_KEY=your_key_here
```

### 3. Run the Service
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive API documentation will be available at:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## Running the Automated Test Suite

Run pytest to execute the full unit and integration test suite:
```bash
pytest -v
```

---

## API Request Examples

### Consolidated Overview (`GET /api/data/latest`)
```bash
curl -X GET "http://localhost:8000/api/data/latest"
```
**Response Sample**:
```json
{
  "generated_at_utc": "2026-08-22T15:50:00Z",
  "aqi_summary": {
    "ncr_avg_pm25": 142.3,
    "ncr_avg_pm10": 254.8,
    "ncr_avg_aqi": 318.5,
    "overall_category": "Very Poor",
    "dominant_pollutant": "PM2.5",
    "total_reporting_stations": 10,
    "latest_timestamp_utc": "2026-08-22T15:45:00Z"
  },
  "weather_summary": {
    "ncr_avg_temperature": 27.8,
    "ncr_avg_humidity": 68.4,
    "ncr_avg_wind_speed": 1.45,
    "ncr_avg_wind_direction": 318.2,
    "ncr_avg_pbl_height": 295.0,
    "ncr_avg_ventilation_index": 427.75,
    "inversion_risk_flag": true,
    "inversion_risk_level": "CRITICAL",
    "latest_timestamp_utc": "2026-08-22T15:45:00Z"
  },
  "fire_summary": {
    "active_fires_24h": 40,
    "active_fires_48h": 82,
    "regional_counts": [
      { "region": "Punjab", "count": 26 },
      { "region": "Haryana", "count": 10 },
      { "region": "Western UP", "count": 4 }
    ],
    "last_detected_utc": "2026-08-22T15:30:00Z"
  },
  "ml_feature_vector": {
    "timestamp_utc": "2026-08-22T15:45:00Z",
    "pm25": 142.3,
    "pm10": 254.8,
    "o3": 28.6,
    "nox": 48.2,
    "temperature": 27.8,
    "humidity": 68.4,
    "wind_speed": 1.45,
    "wind_direction": 318.2,
    "pbl_height": 295.0,
    "ventilation_index": 427.75,
    "inversion_flag": true,
    "upstream_fire_count_24h": 40
  }
}
```
