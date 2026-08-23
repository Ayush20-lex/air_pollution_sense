"""Ingestion Management and System Health Endpoints."""

import time
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from app.db.session import get_db
from app.db.models import AirQualityReading, WeatherReading, FireHotspot
from app.ingestion.pipeline import pipeline_coordinator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Pipeline Administration & Health"])


@router.get("/health", summary="System Health & Database Status")
def get_system_health(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Check API operational status, database connectivity, and telemetry record counts."""
    start_time = time.time()
    db_status = "healthy"
    db_latency_ms = None

    try:
        # Check DB roundtrip
        db.execute(text("SELECT 1"))
        db_latency_ms = round((time.time() - start_time) * 1000, 2)
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    # Record counts
    aq_count = db.query(func.count(AirQualityReading.id)).scalar() or 0
    weather_count = db.query(func.count(WeatherReading.id)).scalar() or 0
    fire_count = db.query(func.count(FireHotspot.id)).scalar() or 0

    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "database": {
            "status": db_status,
            "latency_ms": db_latency_ms,
            "total_air_quality_records": aq_count,
            "total_weather_records": weather_count,
            "total_fire_hotspots": fire_count,
        },
        "services": {
            "cpcb_openaq_ingestion": "operational",
            "open_meteo_ingestion": "operational",
            "nasa_firms_ingestion": "operational",
            "inversion_coupler_engine": "operational",
        },
    }


@router.post("/ingest/trigger", summary="Manual Pipeline Ingestion Trigger")
async def trigger_manual_ingestion(
    source: str = Query(
        "all",
        pattern="^(all|air_quality|weather|firms)$",
        description="Source to ingest ('all', 'air_quality', 'weather', 'firms')",
    ),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Manually invoke the ingestion pipeline for real-time testing, seeding, or ad-hoc updates."""
    try:
        if source == "air_quality":
            res = await pipeline_coordinator.ingest_air_quality(db)
            return {"status": "success", "result": res}
        elif source == "weather":
            res = await pipeline_coordinator.ingest_weather(db)
            return {"status": "success", "result": res}
        elif source == "firms":
            res = await pipeline_coordinator.ingest_firms(db)
            return {"status": "success", "result": res}
        else:
            res = await pipeline_coordinator.run_full_pipeline(db)
            return res
    except Exception as e:
        logger.error(f"Manual ingestion trigger failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline ingestion error: {str(e)}",
        )
