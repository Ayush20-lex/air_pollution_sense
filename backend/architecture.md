# SIH26082 — System Architecture (Module 1)

## Data Flow Architecture

```mermaid
flowchart TD
    subgraph SOURCES["Data Sources"]
        A1["CPCB Ground Stations\n(PM2.5, PM10, O3, NOx, SO2, CO)\n35 NCR Stations · 15-min cadence"]
        A2["IMD Gridded Met Forecast\n(Temp, RH, U/V-wind, PBL, Solar)\nWRF-Chem 1km output"]
        A3["NASA FIRMS MODIS/VIIRS\n(Fire Radiative Power, FRP)\nPunjab/Haryana AOI · 375m res"]
        A4["NCMRWF CAMS Reanalysis\n(AOD 550nm, Column PM)\nCopernicus feed"]
    end

    subgraph INGEST["Ingestion & Streaming Layer"]
        B1["Apache Kafka\nTopics: cpcb.raw | imd.met | firms.fire | cams.aod\nRetention: 72h · Partitions: 12"]
        B2["Apache Airflow DAGs\nSchedule: @15min CPCB | @1h IMD | @6h FIRMS\nRetry: 3x exp-backoff"]
    end

    subgraph FUSION["Spatial Fusion Engine (Module 2)"]
        C1["SpatialDataFusion\n· IDW Interpolation → 70×80 grid\n· Kriging variance surface\n· Fire smoke transport vectors"]
        C2["Grid Tensor Builder\n(Batch, T=72, Ch=12, H=70, W=80)\nStored as compressed zarr chunks"]
    end

    subgraph STORAGE["Persistence Layer"]
        D1[("PostgreSQL 16\n+ PostGIS 3.4\n+ TimescaleDB 2.x\nHypertable: pollution_obs\nChunk: 1h intervals")]
        D2[("Redis 7 Cluster\nForecast cache: TTL 900s\nAlert state: TTL 60s\nPubSub: inversion_alerts")]
    end

    subgraph ML["ML Inference Engine (Modules 3 & 4)"]
        E1["CoupledConvLSTMCell\n12-ch spatiotemporal encoder\nHidden: 64 · Kernel: 3×3"]
        E2["FeedbackCouplingModule\n PM2.5/AOD → ΔTemp, ΔPBL\nPhysics-constrained at each t"]
        E3["AirPollutionCoupledForecaster\nT=72 autoregressive rollout\nGPU: CUDA / MPS"]
        E4["AtmosphericInversionLoss\nMSE + MAE + Physics Penalty\n(mass conservation, PBL trap)"]
    end

    subgraph API["FastAPI Service (Module 5)"]
        F1["GET /api/v1/forecast/grid\n72h GeoJSON spatial grid\ngzip compressed · orjson"]
        F2["GET /api/v1/forecast/station/{id}\nStation time-series vector\n72-point float32 array"]
        F3["GET /api/v1/alerts/inversion\nActive inversion risk zones\nISI threshold: >0.75"]
        F4["WebSocket /ws/live\n100ms push to connected clients\nDelta compression"]
    end

    FRONTEND["React WebStation\n(SIH Dashboard Frontend)\nGIS Canvas + Telemetry Panels"]

    A1 & A2 & A3 & A4 --> B1
    B1 --> B2
    B2 --> C1
    C1 --> C2
    C2 --> D1
    D1 --> E1
    E1 <--> E2
    E2 --> E3
    E3 -- training --> E4
    E3 -- inference --> D2
    D2 --> F1 & F2 & F3 & F4
    F1 & F2 & F3 & F4 --> FRONTEND

    style SOURCES fill:#1e293b,stroke:#334155,color:#94a3b8
    style INGEST fill:#1e3a5f,stroke:#1d4ed8,color:#93c5fd
    style FUSION fill:#14532d,stroke:#16a34a,color:#86efac
    style STORAGE fill:#312e81,stroke:#6366f1,color:#a5b4fc
    style ML fill:#4a1942,stroke:#a855f7,color:#d8b4fe
    style API fill:#7c2d12,stroke:#ea580c,color:#fdba74
    style FRONTEND fill:#1c1917,stroke:#78716c,color:#d6d3d1
```

---

## Real-Time Inference Sequence

```mermaid
sequenceDiagram
    participant FE as Frontend WebStation
    participant API as FastAPI Server
    participant RD as Redis Cache
    participant ML as PyTorch Inference
    participant DB as TimescaleDB

    FE->>+API: GET /api/v1/forecast/grid?t=now
    API->>RD: GET forecast:grid:latest
    alt Cache HIT (TTL < 900s)
        RD-->>API: Cached GeoJSON blob
        API-->>FE: 200 · gzip GeoJSON (< 50ms)
    else Cache MISS
        API->>+DB: SELECT latest 72h tensor window
        DB-->>-API: (72, 12, 70, 80) float32 array
        API->>+ML: model.predict(tensor)
        Note over ML: FeedbackCoupling runs<br/>at each of 72 steps
        ML-->>-API: forecast_grid (72, 12, 70, 80)
        API->>RD: SET forecast:grid:latest TTL=900
        API-->>FE: 200 · gzip GeoJSON (< 800ms)
    end

    FE->>+API: GET /api/v1/alerts/inversion
    API->>RD: GET alerts:inversion:active
    API-->>-FE: 200 · ISI zones GeoJSON

    loop Every 100ms (WebSocket)
        ML-->>API: Delta update (changed cells only)
        API-->>FE: WS push · msgpack delta
    end
```

---

## Database Schema (TimescaleDB)

```sql
-- Hypertable for 15-min station observations
CREATE TABLE pollution_obs (
    time        TIMESTAMPTZ NOT NULL,
    station_id  TEXT        NOT NULL,
    lat         FLOAT8      NOT NULL,
    lon         FLOAT8      NOT NULL,
    geom        GEOMETRY(Point, 4326),
    pm25        FLOAT4,
    pm10        FLOAT4,
    o3          FLOAT4,
    nox         FLOAT4,
    so2         FLOAT4,
    co          FLOAT4,
    temp        FLOAT4,
    rh          FLOAT4,
    u_wind      FLOAT4,
    v_wind      FLOAT4,
    solar_irr   FLOAT4,
    pbl_height  FLOAT4,
    aod_550nm   FLOAT4
);
SELECT create_hypertable('pollution_obs', 'time', chunk_time_interval => INTERVAL '1 hour');
CREATE INDEX ON pollution_obs (station_id, time DESC);
CREATE INDEX ON pollution_obs USING GIST (geom);

-- Forecast grid snapshots
CREATE TABLE forecast_grids (
    issued_at   TIMESTAMPTZ NOT NULL,
    valid_at    TIMESTAMPTZ NOT NULL,
    channel     TEXT        NOT NULL,  -- 'pm25'|'pbl'|'solar'|...
    grid_data   BYTEA       NOT NULL,  -- msgpack float32 70x80
    PRIMARY KEY (issued_at, valid_at, channel)
);
```
