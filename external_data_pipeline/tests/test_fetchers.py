"""Unit and integration tests for Data Ingestion Fetchers and Pipeline coordinator."""

from datetime import datetime, timezone
import pytest
from app.ingestion.cpcb_fetcher import AirQualityFetcher, DELHI_NCR_STATIONS
from app.ingestion.weather_fetcher import WeatherFetcher, NCR_WEATHER_NODES
from app.ingestion.firms_fetcher import FirmsFetcher
from app.ingestion.pipeline import IngestionPipeline
from app.db.models import AirQualityReading, WeatherReading, FireHotspot


@pytest.mark.asyncio
async def test_aq_fetcher_generation():
    fetcher = AirQualityFetcher()
    now = datetime.now(timezone.utc)
    readings = fetcher.generate_diurnal_readings(target_time=now)

    assert len(readings) == len(DELHI_NCR_STATIONS)
    for r in readings:
        assert "station_id" in r
        assert "aqi_calculated" in r
        assert r["pm25"] > 0
        assert r["pm10"] > 0
        assert r["timestamp_utc"] == now


@pytest.mark.asyncio
async def test_weather_fetcher_generation():
    fetcher = WeatherFetcher()
    now = datetime.now(timezone.utc)
    readings = fetcher.generate_calibrated_weather(target_time=now)

    assert len(readings) == len(NCR_WEATHER_NODES)
    for r in readings:
        assert "location_name" in r
        assert "temperature" in r
        assert "humidity" in r
        assert "wind_speed" in r
        assert "pbl_height" in r
        assert "inversion_flag" in r


@pytest.mark.asyncio
async def test_firms_fetcher_generation():
    fetcher = FirmsFetcher()
    now = datetime.now(timezone.utc)
    hotspots = fetcher.generate_regional_stubble_fires(count=20, target_time=now)

    assert len(hotspots) == 20
    for h in hotspots:
        assert "latitude" in h
        assert "longitude" in h
        assert "brightness" in h
        assert h["region"] in ["Punjab", "Haryana", "Western UP", "Delhi NCR", "Surrounding Buffer"]


@pytest.mark.asyncio
async def test_ingestion_pipeline_deduplication(db_session):
    pipeline = IngestionPipeline()
    now = datetime.now(timezone.utc)

    # First ingestion pass
    aq_res_1 = await pipeline.ingest_air_quality(db_session, target_time=now)
    assert aq_res_1["inserted"] == len(DELHI_NCR_STATIONS)
    assert aq_res_1["skipped"] == 0

    # Second pass with exact same timestamp -> should skip duplicates
    aq_res_2 = await pipeline.ingest_air_quality(db_session, target_time=now)
    assert aq_res_2["inserted"] == 0
    assert aq_res_2["skipped"] == len(DELHI_NCR_STATIONS)

    # Ingest weather
    w_res_1 = await pipeline.ingest_weather(db_session, target_time=now)
    assert w_res_1["inserted"] == len(NCR_WEATHER_NODES)

    # Ingest fire hotspots
    f_res_1 = await pipeline.ingest_firms(db_session)
    assert f_res_1["inserted"] > 0

    # Verify counts in DB session
    assert db_session.query(AirQualityReading).count() == len(DELHI_NCR_STATIONS)
    assert db_session.query(WeatherReading).count() == len(NCR_WEATHER_NODES)
    assert db_session.query(FireHotspot).count() > 0
