"""Background Automated Scheduler using APScheduler for Periodic Ingestion."""

import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from app.config import settings
from app.db.session import SessionLocal
from app.ingestion.pipeline import pipeline_coordinator

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def scheduled_aqi_job():
    """Periodic job for Air Quality data ingestion."""
    logger.info("Executing scheduled Air Quality ingestion job...")
    db = SessionLocal()
    try:
        res = await pipeline_coordinator.ingest_air_quality(db)
        logger.info(f"Scheduled AQI job completed: {res['inserted']} inserted.")
    except Exception as e:
        logger.error(f"Error in scheduled AQI job: {e}", exc_info=True)
    finally:
        db.close()


async def scheduled_weather_job():
    """Periodic job for Meteorological data ingestion."""
    logger.info("Executing scheduled Weather ingestion job...")
    db = SessionLocal()
    try:
        res = await pipeline_coordinator.ingest_weather(db)
        logger.info(f"Scheduled Weather job completed: {res['inserted']} inserted.")
    except Exception as e:
        logger.error(f"Error in scheduled Weather job: {e}", exc_info=True)
    finally:
        db.close()


async def scheduled_firms_job():
    """Periodic job for NASA FIRMS fire hotspot data ingestion."""
    logger.info("Executing scheduled NASA FIRMS ingestion job...")
    db = SessionLocal()
    try:
        res = await pipeline_coordinator.ingest_firms(db)
        logger.info(f"Scheduled FIRMS job completed: {res['inserted']} inserted.")
    except Exception as e:
        logger.error(f"Error in scheduled FIRMS job: {e}", exc_info=True)
    finally:
        db.close()


def start_scheduler():
    """Initialize and start the background ingestion scheduler."""
    if scheduler.running:
        logger.warning("Scheduler is already running.")
        return

    # Add AQI periodic ingestion
    scheduler.add_job(
        scheduled_aqi_job,
        trigger=IntervalTrigger(minutes=settings.AQI_INGESTION_INTERVAL_MINUTES),
        id="aqi_ingestion_job",
        name="Delhi NCR Air Quality Ingestion",
        replace_existing=True,
    )

    # Add Weather periodic ingestion
    scheduler.add_job(
        scheduled_weather_job,
        trigger=IntervalTrigger(minutes=settings.WEATHER_INGESTION_INTERVAL_MINUTES),
        id="weather_ingestion_job",
        name="Delhi NCR Meteorology Ingestion",
        replace_existing=True,
    )

    # Add FIRMS periodic ingestion
    scheduler.add_job(
        scheduled_firms_job,
        trigger=IntervalTrigger(minutes=settings.FIRMS_INGESTION_INTERVAL_MINUTES),
        id="firms_ingestion_job",
        name="NASA FIRMS Fire Hotspot Ingestion",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Background ingestion scheduler started successfully.")


def shutdown_scheduler():
    """Gracefully shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Background ingestion scheduler shut down.")
