"""NASA FIRMS Active Fire Hotspots REST API Endpoints."""

from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from app.db.session import get_db
from app.db.models import FireHotspot
from app.schemas.fires import (
    FireHotspotResponse,
    FireStats,
    RegionalFireCount,
)

router = APIRouter(prefix="/api/fires", tags=["Fire Hotspots (NASA FIRMS)"])


@router.get("", response_model=List[FireHotspotResponse], summary="Query Active Fire Hotspots")
def get_fire_hotspots(
    region: Optional[str] = Query(None, description="Filter by region (Punjab, Haryana, Western UP, etc.)"),
    min_confidence: Optional[str] = Query(None, description="Filter by min confidence (nominal, high)"),
    start_date: Optional[datetime] = Query(None, description="Filter detections on or after this UTC timestamp"),
    end_date: Optional[datetime] = Query(None, description="Filter detections on or before this UTC timestamp"),
    min_lat: Optional[float] = Query(None, ge=-90.0, le=90.0, description="Bounding Box Min Latitude"),
    min_lon: Optional[float] = Query(None, ge=-180.0, le=180.0, description="Bounding Box Min Longitude"),
    max_lat: Optional[float] = Query(None, ge=-90.0, le=90.0, description="Bounding Box Max Latitude"),
    max_lon: Optional[float] = Query(None, ge=-180.0, le=180.0, description="Bounding Box Max Longitude"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Records to skip"),
    db: Session = Depends(get_db),
):
    """Retrieve active fire hotspot coordinates detected by NASA VIIRS/MODIS."""
    query = db.query(FireHotspot)

    if region:
        query = query.filter(FireHotspot.region.ilike(f"%{region}%"))
    if min_confidence:
        query = query.filter(FireHotspot.confidence.ilike(f"%{min_confidence}%"))
    if start_date:
        query = query.filter(FireHotspot.acq_datetime_utc >= start_date)
    if end_date:
        query = query.filter(FireHotspot.acq_datetime_utc <= end_date)

    # Bounding Box Filter
    if min_lat is not None:
        query = query.filter(FireHotspot.latitude >= min_lat)
    if max_lat is not None:
        query = query.filter(FireHotspot.latitude <= max_lat)
    if min_lon is not None:
        query = query.filter(FireHotspot.longitude >= min_lon)
    if max_lon is not None:
        query = query.filter(FireHotspot.longitude <= max_lon)

    return query.order_by(desc(FireHotspot.acq_datetime_utc)).offset(offset).limit(limit).all()


@router.get("/stats", response_model=FireStats, summary="Regional Active Fire Statistical Summary")
def get_fire_stats(db: Session = Depends(get_db)):
    """Compute active fire counts in the 24-hour and 48-hour buffer windows grouped by state/region."""
    now = datetime.now(timezone.utc)
    t_24h = now - timedelta(hours=24)
    t_48h = now - timedelta(hours=48)

    # Count fires in past 24 hours
    count_24h = (
        db.query(func.count(FireHotspot.id))
        .filter(FireHotspot.acq_datetime_utc >= t_24h)
        .scalar()
        or 0
    )

    # Count fires in past 48 hours
    count_48h = (
        db.query(func.count(FireHotspot.id))
        .filter(FireHotspot.acq_datetime_utc >= t_48h)
        .scalar()
        or 0
    )

    # Regional breakdown (24h)
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

    # Highest brightness intensity
    max_bright = (
        db.query(func.max(FireHotspot.brightness))
        .filter(FireHotspot.acq_datetime_utc >= t_24h)
        .scalar()
    )

    # Latest detection timestamp
    last_detected = (
        db.query(func.max(FireHotspot.acq_datetime_utc))
        .scalar()
    )

    return FireStats(
        total_active_fires_24h=count_24h,
        total_active_fires_48h=count_48h,
        regional_breakdown=reg_breakdown,
        highest_intensity_brightness=max_bright,
        last_detected_utc=last_detected,
    )
