"""Integration tests for FastAPI REST endpoints."""

import pytest
from fastapi.testclient import TestClient


def test_root_endpoint(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "service" in data
    assert "endpoints" in data


def test_system_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["healthy", "degraded"]
    assert "database" in data
    assert "services" in data


def test_manual_ingest_and_query_flow(client: TestClient):
    # 1. Trigger full pipeline ingestion
    ingest_res = client.post("/api/ingest/trigger?source=all")
    assert ingest_res.status_code == 200
    res_data = ingest_res.json()
    assert res_data["status"] == "success"

    # 2. Test Air Quality Endpoints
    aq_res = client.get("/api/air-quality?limit=10")
    assert aq_res.status_code == 200
    aq_list = aq_res.json()
    assert len(aq_list) > 0
    assert "aqi_calculated" in aq_list[0]
    assert "pm25" in aq_list[0]

    # Test Air Quality filter by station
    station_id = aq_list[0]["station_id"]
    filtered_aq = client.get(f"/api/air-quality?station_id={station_id}")
    assert filtered_aq.status_code == 200
    assert all(r["station_id"] == station_id for r in filtered_aq.json())

    # Test Air Quality Stations List
    stations_res = client.get("/api/air-quality/stations")
    assert stations_res.status_code == 200
    assert len(stations_res.json()) > 0

    # Test Air Quality Stats
    aq_stats = client.get("/api/air-quality/stats")
    assert aq_stats.status_code == 200
    stats_data = aq_stats.json()
    assert stats_data["total_stations"] > 0
    assert stats_data["avg_aqi"] is not None

    # 3. Test Weather Endpoints
    weather_res = client.get("/api/weather?limit=10")
    assert weather_res.status_code == 200
    w_list = weather_res.json()
    assert len(w_list) > 0
    assert "temperature" in w_list[0]
    assert "pbl_height" in w_list[0]
    assert "inversion_flag" in w_list[0]

    # Test Inversion Analysis
    inv_res = client.get("/api/weather/inversion-analysis")
    assert inv_res.status_code == 200
    inv_data = inv_res.json()
    assert "risk_level" in inv_data
    assert "summary" in inv_data

    # 4. Test Fire Hotspot Endpoints
    fires_res = client.get("/api/fires?limit=25")
    assert fires_res.status_code == 200
    f_list = fires_res.json()
    assert len(f_list) > 0
    assert "brightness" in f_list[0]
    assert "region" in f_list[0]

    # Test Fire Stats
    fire_stats = client.get("/api/fires/stats")
    assert fire_stats.status_code == 200
    fstats_data = fire_stats.json()
    assert "regional_breakdown" in fstats_data

    # 5. Test Consolidated Dashboard & ML Feature Payload
    cons_res = client.get("/api/data/latest")
    assert cons_res.status_code == 200
    cons_data = cons_res.json()
    assert "aqi_summary" in cons_data
    assert "weather_summary" in cons_data
    assert "fire_summary" in cons_data
    assert "ml_feature_vector" in cons_data
    assert cons_data["ml_feature_vector"]["pm25"] is not None
    assert cons_data["ml_feature_vector"]["temperature"] is not None
