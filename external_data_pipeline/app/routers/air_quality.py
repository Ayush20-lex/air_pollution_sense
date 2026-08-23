"""Air Quality REST API Endpoints."""

from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.db.session import get_db
from app.db.models import AirQualityReading
from app.schemas.air_quality import (
    AirQualityReadingResponse,
    AirQualityStats,
)
from app.ingestion.cleaner import get_aqi_category

router = APIRouter(prefix="/api/air-quality", tags=["Air Quality"])


@router.get("", response_model=List[AirQualityReadingResponse], summary="Query Air Quality Readings")
def get_air_quality_readings(
    station_id: Optional[str] = Query(None, description="Filter by Station ID (e.g. DEL_AV, DEL_RKP)"),
    location: Optional[str] = Query(None, description="Partial search by location/neighborhood name"),
    start_time: Optional[datetime] = Query(None, description="Filter records on or after this UTC timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter records on or before this UTC timestamp"),
    limit: int = Query(50, ge=1, le=500, description="Max number of records to return"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    db: Session = Depends(get_db),
):
    """Retrieve historical and real-time air quality observations with flexible filters."""
    query = db.query(AirQualityReading)

    if station_id:
        query = query.filter(AirQualityReading.station_id == station_id)
    if location:
        query = query.filter(AirQualityReading.location_name.ilike(f"%{location}%"))
    if start_time:
        query = query.filter(AirQualityReading.timestamp_utc >= start_time)
    if end_time:
        query = query.filter(AirQualityReading.timestamp_utc <= end_time)

    readings = query.order_by(desc(AirQualityReading.timestamp_utc)).offset(offset).limit(limit).all()
    return readings


@router.get("/latest", response_model=List[AirQualityReadingResponse], summary="Latest Air Quality per Station")
def get_latest_air_quality(db: Session = Depends(get_db)):
    """Retrieve the most recent air quality observation for each monitoring station in Delhi NCR."""
    # Find max timestamp per station
    subquery = (
        db.query(
            AirQualityReading.station_id,
            func.max(AirQualityReading.timestamp_utc).label("max_ts"),
        )
        .group_by(AirQualityReading.station_id)
        .subquery()
    )

    latest_readings = (
        db.query(AirQualityReading)
        .join(
            subquery,
            (AirQualityReading.station_id == subquery.c.station_id)
            & (AirQualityReading.timestamp_utc == subquery.c.max_ts),
        )
        .order_by(desc(AirQualityReading.aqi_calculated))
        .all()
    )

    return latest_readings


@router.get("/stations", summary="List All Monitored Stations")
def get_monitored_stations(db: Session = Depends(get_db)):
    """List distinct monitoring stations in the database with their coordinates."""
    results = (
        db.query(
            AirQualityReading.station_id,
            AirQualityReading.location_name,
            AirQualityReading.latitude,
            AirQualityReading.longitude,
        )
        .distinct()
        .all()
    )

    return [
        {
            "station_id": r.station_id,
            "location_name": r.location_name,
            "latitude": r.latitude,
            "longitude": r.longitude,
        }
        for r in results
    ]


@router.get("/stats", response_model=AirQualityStats, summary="Delhi NCR Air Quality Statistical Summary")
def get_air_quality_stats(db: Session = Depends(get_db)):
    """Compute aggregate statistical summary across all current Delhi NCR stations."""
    latest_readings = get_latest_air_quality(db)

    if not latest_readings:
        return AirQualityStats(
            total_stations=0,
            avg_pm25=None,
            avg_pm10=None,
            avg_aqi=None,
            overall_category="No Data",
            dominant_pollutant="None",
            latest_timestamp=None,
        )

    pm25_vals = [r.pm25 for r in latest_readings if r.pm25 is not None]
    pm10_vals = [r.pm10 for r in latest_readings if r.pm10 is not None]
    aqi_vals = [r.aqi_calculated for r in latest_readings if r.aqi_calculated is not None]

    avg_pm25 = round(sum(pm25_vals) / len(pm25_vals), 1) if pm25_vals else None
    avg_pm10 = round(sum(pm10_vals) / len(pm10_vals), 1) if pm10_vals else None
    avg_aqi = round(sum(aqi_vals) / len(aqi_vals), 1) if aqi_vals else None
    overall_cat = get_aqi_category(avg_aqi)

    # Determine dominant pollutant across stations
    pollutant_counts = {}
    for r in latest_readings:
        if r.dominant_pollutant:
            pollutant_counts[r.dominant_pollutant] = pollutant_counts.get(r.dominant_pollutant, 0) + 1
    dom_poll = max(pollutant_counts, key=pollutant_counts.get) if pollutant_counts else "PM2.5"

    max_ts = max(r.timestamp_utc for r in latest_readings)

    return AirQualityStats(
        total_stations=len(latest_readings),
        avg_pm25=avg_pm25,
        avg_pm10=avg_pm10,
        avg_aqi=avg_aqi,
        overall_category=overall_cat,
        dominant_pollutant=dom_poll,
        latest_timestamp=max_ts,
    )
