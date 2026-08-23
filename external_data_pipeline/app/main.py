"""FastAPI Application Main Entrypoint.

Smart India Hackathon (SIH) Problem ID: SIH26082
Air Pollution–Weather Coupled Forecasting System (Delhi NCR Focus)
Data Pipeline & REST API Service
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db.session import init_db, SessionLocal
from app.scheduler.cron import start_scheduler, shutdown_scheduler
from app.ingestion.pipeline import pipeline_coordinator
from app.routers import (
    air_quality_router,
    weather_router,
    fires_router,
    consolidated_router,
    ingestion_admin_router,
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("delhi_pipeline")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager: sets up DB tables, seeds initial data if empty, and manages scheduler."""
    logger.info("Initializing Delhi NCR Pollution–Weather Pipeline Service...")
    
    # 1. Ensure database schema exists
    try:
        init_db()
        logger.info("Database schema initialized.")
    except Exception as e:
        logger.error(f"Failed to initialize database schema: {e}", exc_info=True)

    # 2. Seed initial baseline telemetry if DB is clean
    try:
        db = SessionLocal()
        from app.db.models import AirQualityReading
        count = db.query(AirQualityReading).count()
        if count == 0:
            logger.info("Database is empty. Triggering initial startup telemetry ingestion...")
            await pipeline_coordinator.run_full_pipeline(db)
        db.close()
    except Exception as e:
        logger.warning(f"Initial startup seeding warning: {e}", exc_info=False)

    # 3. Start APScheduler background ingestion
    try:
        start_scheduler()
    except Exception as e:
        logger.error(f"Failed to start APScheduler: {e}", exc_info=True)

    yield

    # 4. Graceful Shutdown
    logger.info("Shutting down background scheduler...")
    shutdown_scheduler()
    logger.info("Pipeline service stopped gracefully.")


# Create FastAPI instance
app = FastAPI(
    title="Air Pollution–Weather Coupled Forecasting Pipeline (Delhi NCR Focus)",
    description=(
        "Production-ready backend data ingestion and REST API service for Smart India Hackathon "
        "(Problem ID SIH26082). Continuously collects, cleans, validates, and serves CPCB/OpenAQ air quality, "
        "meteorology & planetary boundary layer (PBL) height, and NASA FIRMS active stubble burning data."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API Routers
app.include_router(consolidated_router)
app.include_router(air_quality_router)
app.include_router(weather_router)
app.include_router(fires_router)
app.include_router(ingestion_admin_router)


@app.get("/", summary="Root API Information")
def root_info():
    """System overview and documentation links."""
    return {
        "service": "Delhi NCR Air Pollution–Weather Coupled Data Pipeline",
        "sih_problem_id": "SIH26082",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "endpoints": {
            "interactive_docs": "/docs",
            "consolidated_dashboard": "/api/data/latest",
            "air_quality": "/api/air-quality",
            "weather_inversion": "/api/weather",
            "fire_hotspots": "/api/fires",
            "system_health": "/api/health",
            "manual_ingest": "/api/ingest/trigger",
        },
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler for unhandled server errors."""
    logger.error(f"Unhandled error processing {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "detail": "An unexpected error occurred within the data pipeline service.",
            "path": str(request.url.path),
        },
    )
