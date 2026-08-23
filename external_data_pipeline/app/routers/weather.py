"""Meteorology and Inversion Pre-processing REST API Endpoints."""

from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.db.session import get_db
from app.db.models import WeatherReading
from app.schemas.weather import (
    WeatherReadingResponse,
    InversionStats,
)
from app.ingestion.cleaner import evaluate_inversion_and_dispersion

router = APIRouter(prefix="/api/weather", tags=["Meteorology & Inversion"])


@router.get("", response_model=List[WeatherReadingResponse], summary="Query Weather Readings")
def get_weather_readings(
    location: Optional[str] = Query(None, description="Partial search by location name"),
    start_time: Optional[datetime] = Query(None, description="Filter on or after UTC timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter on or before UTC timestamp"),
    inversion_only: Optional[bool] = Query(None, description="Filter for active inversion conditions only"),
    limit: int = Query(50, ge=1, le=500, description="Max number of records to return"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    db: Session = Depends(get_db),
):
    """Retrieve meteorological and atmospheric boundary layer readings."""
    query = db.query(WeatherReading)

    if location:
        query = query.filter(WeatherReading.location_name.ilike(f"%{location}%"))
    if start_time:
        query = query.filter(WeatherReading.timestamp_utc >= start_time)
    if end_time:
        query = query.filter(WeatherReading.timestamp_utc <= end_time)
    if inversion_only is not None:
        query = query.filter(WeatherReading.inversion_flag == inversion_only)

    return query.order_by(desc(WeatherReading.timestamp_utc)).offset(offset).limit(limit).all()


@router.get("/latest", response_model=List[WeatherReadingResponse], summary="Latest Weather per NCR Node")
def get_latest_weather(db: Session = Depends(get_db)):
    """Retrieve the most recent meteorological observation for each grid node in Delhi NCR."""
    subquery = (
        db.query(
            WeatherReading.location_name,
            func.max(WeatherReading.timestamp_utc).label("max_ts"),
        )
        .group_by(WeatherReading.location_name)
        .subquery()
    )

    latest = (
        db.query(WeatherReading)
        .join(
            subquery,
            (WeatherReading.location_name == subquery.c.location_name)
            & (WeatherReading.timestamp_utc == subquery.c.max_ts),
        )
        .all()
    )

    return latest


@router.get("/inversion-analysis", response_model=InversionStats, summary="Atmospheric Inversion Trap Analysis")
def get_inversion_analysis(db: Session = Depends(get_db)):
    """Compute current atmospheric boundary layer trapping risks for Delhi NCR."""
    latest_nodes = get_latest_weather(db)

    if not latest_nodes:
        return InversionStats(
            inversion_active=False,
            risk_level="UNKNOWN",
            avg_pbl_height=None,
            avg_wind_speed=None,
            avg_ventilation_index=None,
            summary="No meteorological data available to compute boundary layer inversion.",
        )

    pbl_list = [w.pbl_height for w in latest_nodes if w.pbl_height is not None]
    wind_list = [w.wind_speed for w in latest_nodes if w.wind_speed is not None]
    vent_list = [w.ventilation_index for w in latest_nodes if w.ventilation_index is not None]

    avg_pbl = round(sum(pbl_list) / len(pbl_list), 1) if pbl_list else None
    avg_wind = round(sum(wind_list) / len(wind_list), 2) if wind_list else None
    avg_vent = round(sum(vent_list) / len(vent_list), 1) if vent_list else None

    inversion_flag, _, risk = evaluate_inversion_and_dispersion(avg_pbl, avg_wind)

    if risk in ["HIGH", "CRITICAL"]:
        summary = (
            f"Active nocturnal/shallow boundary layer trap detected (PBLH: {avg_pbl}m, Wind: {avg_wind}m/s). "
            f"Atmospheric dispersion is severely constricted (Ventilation Index: {avg_vent} m²/s). "
            f"High likelihood of particulate pollutant accumulation."
        )
    elif risk == "MODERATE":
        summary = (
            f"Moderate dispersion conditions (PBLH: {avg_pbl}m, Wind: {avg_wind}m/s). "
            f"Ventilation Index is {avg_vent} m²/s. Partial pollutant accumulation expected."
        )
    else:
        summary = (
            f"Favorable atmospheric dispersion (PBLH: {avg_pbl}m, Wind: {avg_wind}m/s). "
            f"High boundary layer mixing (Ventilation Index: {avg_vent} m²/s)."
        )

    return InversionStats(
        inversion_active=inversion_flag,
        risk_level=risk,
        avg_pbl_height=avg_pbl,
        avg_wind_speed=avg_wind,
        avg_ventilation_index=avg_vent,
        summary=summary,
    )
