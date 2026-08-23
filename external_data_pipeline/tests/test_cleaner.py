"""Unit tests for Data Cleaner, CPCB NAQI calculation, and Inversion evaluation."""

from datetime import datetime, timezone
import pytest
from app.ingestion.cleaner import (
    sanitize_numeric,
    normalize_utc_timestamp,
    calculate_sub_index,
    get_aqi_category,
    calculate_cpcb_aqi,
    evaluate_inversion_and_dispersion,
    clean_air_quality_record,
    clean_weather_record,
    clean_fire_record,
)


def test_sanitize_numeric():
    # Valid numbers
    assert sanitize_numeric(45.678) == 45.68
    assert sanitize_numeric("120.5") == 120.5

    # Out of range / negative sensor codes
    assert sanitize_numeric(-999.0, min_val=0.0) is None
    assert sanitize_numeric(-1.0, min_val=0.0) is None
    assert sanitize_numeric(2500.0, max_val=1500.0) is None

    # Invalid types
    assert sanitize_numeric("invalid_sensor_str") is None
    assert sanitize_numeric(None) is None


def test_normalize_utc_timestamp():
    dt_naive = datetime(2026, 8, 22, 12, 0, 0)
    dt_utc = normalize_utc_timestamp(dt_naive)
    assert dt_utc.tzinfo is not None
    assert dt_utc.tzinfo == timezone.utc

    # String format
    iso_str = "2026-08-22T10:30:00Z"
    dt_from_str = normalize_utc_timestamp(iso_str)
    assert dt_from_str.hour == 10
    assert dt_from_str.minute == 30


def test_calculate_sub_index_pm25():
    # Good range (0-30 -> 0-50)
    assert calculate_sub_index("pm25", 15.0) == 25.0
    assert calculate_sub_index("pm25", 30.0) == 50.0

    # Satisfactory range (30.1-60 -> 51-100)
    assert calculate_sub_index("pm25", 60.0) == 100.0

    # Severe range (> 250)
    assert calculate_sub_index("pm25", 380.0) > 400.0


def test_calculate_cpcb_aqi():
    # Moderate case
    aqi, cat, dom = calculate_cpcb_aqi(pm25=75.0, pm10=140.0)
    assert cat == "Moderate"
    assert aqi > 100.0 and aqi <= 200.0
    assert dom in ["PM2.5", "PM10"]

    # Severe case
    aqi_sev, cat_sev, dom_sev = calculate_cpcb_aqi(pm25=310.0, pm10=450.0)
    assert cat_sev == "Severe"
    assert aqi_sev >= 401.0

    # Clean / Good case
    aqi_good, cat_good, dom_good = calculate_cpcb_aqi(pm25=20.0, pm10=35.0)
    assert cat_good == "Good"
    assert aqi_good <= 50.0


def test_evaluate_inversion_and_dispersion():
    # Trapping case: Low PBL (<400m) and calm wind (<2.0 m/s)
    inversion_flag, vent_idx, risk = evaluate_inversion_and_dispersion(pbl_height=280.0, wind_speed=1.2)
    assert inversion_flag is True
    assert risk == "CRITICAL"
    assert vent_idx == round(280.0 * 1.2, 2)

    # Dispersive case: High PBL (1400m) and moderate wind (4.5 m/s)
    inversion_flag_clear, vent_idx_clear, risk_clear = evaluate_inversion_and_dispersion(pbl_height=1400.0, wind_speed=4.5)
    assert inversion_flag_clear is False
    assert risk_clear == "LOW"
    assert vent_idx_clear == round(1400.0 * 4.5, 2)


def test_clean_air_quality_record():
    raw = {
        "station_id": "DEL_TEST",
        "location_name": "Test Station, Delhi",
        "latitude": 28.60,
        "longitude": 77.20,
        "pm25": -999,  # Bad sensor reading
        "pm10": 180.0,
        "nox": 45.0,
        "o3": 30.0,
        "timestamp_utc": "2026-08-22T14:00:00Z",
    }
    cleaned = clean_air_quality_record(raw)
    assert cleaned["station_id"] == "DEL_TEST"
    assert cleaned["pm25"] is None  # -999 cleaned out
    assert cleaned["pm10"] == 180.0
    assert cleaned["aqi_calculated"] is not None
    assert cleaned["dominant_pollutant"] == "PM10"


def test_clean_weather_record():
    raw = {
        "location_name": "Delhi Test Node",
        "latitude": 28.60,
        "longitude": 77.20,
        "temperature": 32.5,
        "humidity": 65.0,
        "wind_speed": 1.4,
        "wind_direction": 310.0,
        "pbl_height": 320.0,
        "timestamp_utc": "2026-08-22T14:00:00Z",
    }
    cleaned = clean_weather_record(raw)
    assert cleaned["temperature"] == 32.5
    assert cleaned["inversion_flag"] is True
    assert cleaned["ventilation_index"] == round(320.0 * 1.4, 2)


def test_clean_fire_record():
    raw = {
        "latitude": 30.25,
        "longitude": 75.85,
        "brightness": 345.5,
        "confidence": "high",
        "timestamp": "2026-08-22T10:00:00Z",
    }
    cleaned = clean_fire_record(raw)
    assert cleaned["region"] == "Punjab"
    assert cleaned["brightness"] == 345.5
    assert cleaned["satellite"] == "VIIRS"
