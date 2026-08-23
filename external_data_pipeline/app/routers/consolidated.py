"""Consolidated Data Serving Endpoint for Frontend Dashboard & Coupled ML Models."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.db.session import get_db
from app.db.models import AirQualityReading, WeatherReading, FireHotspot
from app.schemas.consolidated import (
    ConsolidatedDashboardResponse,
    AQISummary,
    WeatherSummary,
    FireSummary,
    ModelFeaturePayload,
)
from app.schemas.fires import RegionalFireCount
from app.ingestion.cleaner import get_aqi_category, evaluate_inversion_and_dispersion

router = APIRouter(prefix="/api/data", tags=["Consolidated Dashboard & ML Feature Store"])


@router.get("/latest", response_model=ConsolidatedDashboardResponse, summary="Consolidated Real-Time Overview")
def get_consolidated_latest(db: Session = Depends(get_db)):
    """Single-call consolidated payload containing latest AQI, Meteorology, Inversion, and Fire counts."""
    now = datetime.now(timezone.utc)
    t_24h = now - timedelta(hours=24)
    t_48h = now - timedelta(hours=48)

    # 1. Latest Air Quality Readings
    aq_subquery = (
        db.query(
            AirQualityReading.station_id,
            func.max(AirQualityReading.timestamp_utc).label("max_ts"),
        )
        .group_by(AirQualityReading.station_id)
        .subquery()
    )

    latest_aq_readings = (
        db.query(AirQualityReading)
        .join(
            aq_subquery,
            (AirQualityReading.station_id == aq_subquery.c.station_id)
            & (AirQualityReading.timestamp_utc == aq_subquery.c.max_ts),
        )
        .all()
    )

    pm25_vals = [r.pm25 for r in latest_aq_readings if r.pm25 is not None]
    pm10_vals = [r.pm10 for r in latest_aq_readings if r.pm10 is not None]
    aqi_vals = [r.aqi_calculated for r in latest_aq_readings if r.aqi_calculated is not None]
    o3_vals = [r.o3 for r in latest_aq_readings if r.o3 is not None]
    nox_vals = [r.nox for r in latest_aq_readings if r.nox is not None]

    avg_pm25 = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else None
    avg_pm10 = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else None
    avg_aqi = round(sum(aqi_vals) / len(aqi_vals), 1) if aqi_vals else None
    avg_o3 = round(sum(o3_vals) / len(o3_vals), 1) if o3_vals else None
    avg_nox = round(sum(nox_vals) / len(nox_vals), 1) if nox_vals else None

    pollutant_counts = {}
    for r in latest_aq_readings:
        if r.dominant_pollutant:
            pollutant_counts[r.dominant_pollutant] = pollutant_counts.get(r.dominant_pollutant, 0) + 1
    dom_poll = max(pollutant_counts, key=pollutant_counts.get) if pollutant_counts else "PM2.5"

    max_aq_ts = max((r.timestamp_utc for r in latest_aq_readings), default=None)

    aq_summary = AQISummary(
        ncr_avg_pm25=avg_pm25,
        ncr_avg_pm10=avg_pm10,
        ncr_avg_aqi=avg_aqi,
        overall_category=get_aqi_category(avg_aqi),
        dominant_pollutant=dom_poll,
        total_reporting_stations=len(latest_aq_readings),
        latest_timestamp_utc=max_aq_ts,
    )

    # 2. Latest Weather Readings
    w_subquery = (
        db.query(
            WeatherReading.location_name,
            func.max(WeatherReading.timestamp_utc).label("max_ts"),
        )
        .group_by(WeatherReading.location_name)
        .subquery()
    )

    latest_weather_readings = (
        db.query(WeatherReading)
        .join(
            w_subquery,
            (WeatherReading.location_name == w_subquery.c.location_name)
            & (WeatherReading.timestamp_utc == w_subquery.c.max_ts),
        )
        .all()
    )

    temp_vals = [w.temperature for w in latest_weather_readings if w.temperature is not None]
    hum_vals = [w.humidity for w in latest_weather_readings if w.humidity is not None]
    wind_vals = [w.wind_speed for w in latest_weather_readings if w.wind_speed is not None]
    wdir_vals = [w.wind_direction for w in latest_weather_readings if w.wind_direction is not None]
    pbl_vals = [w.pbl_height for w in latest_weather_readings if w.pbl_height is not None]
    vent_vals = [w.ventilation_index for w in latest_weather_readings if w.ventilation_index is not None]

    avg_temp = round(sum(temp_vals) / len(temp_vals), 1) if temp_vals else None
    avg_hum = round(sum(hum_vals) / len(hum_vals), 1) if hum_vals else None
    avg_wind = round(sum(wind_vals) / len(wind_vals), 2) if wind_vals else None
    avg_wdir = round(sum(wdir_vals) / len(wdir_vals), 1) if wdir_vals else None
    avg_pbl = round(sum(pbl_vals) / len(pbl_vals), 1) if pbl_vals else None
    avg_vent = round(sum(vent_vals) / len(vent_vals), 1) if vent_vals else None

    inversion_flag, _, inv_risk = evaluate_inversion_and_dispersion(avg_pbl, avg_wind)
    max_weather_ts = max((w.timestamp_utc for w in latest_weather_readings), default=None)

    weather_summary = WeatherSummary(
        ncr_avg_temperature=avg_temp,
        ncr_avg_humidity=avg_hum,
        ncr_avg_wind_speed=avg_wind,
        ncr_avg_wind_direction=avg_wdir,
        ncr_avg_pbl_height=avg_pbl,
        ncr_avg_ventilation_index=avg_vent,
        inversion_risk_flag=inversion_flag,
        inversion_risk_level=inv_risk,
        latest_timestamp_utc=max_weather_ts,
    )

    # 3. Fire Hotspots Summary
    fire_count_24h = (
        db.query(func.count(FireHotspot.id))
        .filter(FireHotspot.acq_datetime_utc >= t_24h)
        .scalar()
        or 0
    )
    fire_count_48h = (
        db.query(func.count(FireHotspot.id))
        .filter(FireHotspot.acq_datetime_utc >= t_48h)
        .scalar()
        or 0
    )

    reg_rows = (
        db.query(FireHotspot.region, func.count(FireHotspot.id))
        .filter(FireHotspot.acq_datetime_utc >= t_24h)
        .group_by(FireHotspot.region)
        .all()
    )
    reg_breakdown = [
        RegionalFireCount(region=r[0] or "Unknown", count=r[1])
        for r in reg_rows
    ]

    last_fire_ts = (
        db.query(func.max(FireHotspot.acq_datetime_utc))
        .scalar()
    )

    fire_summary = FireSummary(
        active_fires_24h=fire_count_24h,
        active_fires_48h=fire_count_48h,
        regional_counts=reg_breakdown,
        last_detected_utc=last_fire_ts,
    )

    # 4. ML Feature Vector Payload
    ml_features = ModelFeaturePayload(
        timestamp_utc=max_aq_ts or max_weather_ts or now,
        pm25=avg_pm25,
        pm10=avg_pm10,
        o3=avg_o3,
        nox=avg_nox,
        temperature=avg_temp,
        humidity=avg_hum,
        wind_speed=avg_wind,
        wind_direction=avg_wdir,
        pbl_height=avg_pbl,
        ventilation_index=avg_vent,
        inversion_flag=inversion_flag,
        upstream_fire_count_24h=fire_count_24h,
    )

    return ConsolidatedDashboardResponse(
        generated_at_utc=now,
        aqi_summary=aq_summary,
        weather_summary=weather_summary,
        fire_summary=fire_summary,
        latest_station_readings=latest_aq_readings,
        latest_weather_readings=latest_weather_readings,
        ml_feature_vector=ml_features,
    )
