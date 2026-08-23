"""Unified Ingestion Pipeline Coordinator for Air Quality, Weather, and Fire Hotspots."""

import logging
from datetime import datetime, timezone
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import AirQualityReading, WeatherReading, FireHotspot
from app.ingestion.cpcb_fetcher import AirQualityFetcher
from app.ingestion.weather_fetcher import WeatherFetcher
from app.ingestion.firms_fetcher import FirmsFetcher

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """Orchestrates end-to-end data acquisition, cleaning, deduplication, and database persistence."""

    def __init__(self):
        self.aq_fetcher = AirQualityFetcher()
        self.weather_fetcher = WeatherFetcher()
        self.firms_fetcher = FirmsFetcher()

    async def ingest_air_quality(self, db: Session, target_time: datetime = None) -> Dict[str, Any]:
        """Fetch, clean, and store air quality readings for Delhi NCR stations."""
        records = await self.aq_fetcher.fetch_all(target_time=target_time)
        inserted_count = 0
        skipped_count = 0

        for rec in records:
            # Check for existing record to avoid duplicate constraint violations
            existing = (
                db.query(AirQualityReading)
                .filter(
                    AirQualityReading.station_id == rec["station_id"],
                    AirQualityReading.timestamp_utc == rec["timestamp_utc"],
                )
                .first()
            )

            if existing:
                skipped_count += 1
                continue

            reading = AirQualityReading(**rec)
            db.add(reading)
            try:
                db.commit()
                inserted_count += 1
            except IntegrityError:
                db.rollback()
                skipped_count += 1
            except Exception as e:
                db.rollback()
                logger.error(f"Error persisting AQ record {rec['station_id']}: {e}")

        logger.info(f"Air Quality Ingestion Complete: {inserted_count} inserted, {skipped_count} skipped.")
        return {
            "source": "air_quality",
            "inserted": inserted_count,
            "skipped": skipped_count,
            "total_processed": len(records),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def ingest_weather(self, db: Session, target_time: datetime = None) -> Dict[str, Any]:
        """Fetch, clean, and store meteorological & boundary layer readings for Delhi NCR."""
        records = await self.weather_fetcher.fetch_all(target_time=target_time)
        inserted_count = 0
        skipped_count = 0

        for rec in records:
            existing = (
                db.query(WeatherReading)
                .filter(
                    WeatherReading.location_name == rec["location_name"],
                    WeatherReading.timestamp_utc == rec["timestamp_utc"],
                )
                .first()
            )

            if existing:
                skipped_count += 1
                continue

            reading = WeatherReading(**rec)
            db.add(reading)
            try:
                db.commit()
                inserted_count += 1
            except IntegrityError:
                db.rollback()
                skipped_count += 1
            except Exception as e:
                db.rollback()
                logger.error(f"Error persisting weather record {rec['location_name']}: {e}")

        logger.info(f"Weather Ingestion Complete: {inserted_count} inserted, {skipped_count} skipped.")
        return {
            "source": "weather",
            "inserted": inserted_count,
            "skipped": skipped_count,
            "total_processed": len(records),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def ingest_firms(self, db: Session, days: int = 1) -> Dict[str, Any]:
        """Fetch, clean, and store active fire hotspots for stubble burning regions."""
        records = await self.firms_fetcher.fetch_all(days=days)
        inserted_count = 0
        skipped_count = 0

        for rec in records:
            existing = (
                db.query(FireHotspot)
                .filter(
                    FireHotspot.latitude == rec["latitude"],
                    FireHotspot.longitude == rec["longitude"],
                    FireHotspot.acq_datetime_utc == rec["acq_datetime_utc"],
                )
                .first()
            )

            if existing:
                skipped_count += 1
                continue

            hotspot = FireHotspot(**rec)
            db.add(hotspot)
            try:
                db.commit()
                inserted_count += 1
            except IntegrityError:
                db.rollback()
                skipped_count += 1
            except Exception as e:
                db.rollback()
                logger.error(f"Error persisting fire hotspot: {e}")

        logger.info(f"FIRMS Fire Ingestion Complete: {inserted_count} inserted, {skipped_count} skipped.")
        return {
            "source": "nasa_firms",
            "inserted": inserted_count,
            "skipped": skipped_count,
            "total_processed": len(records),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def run_full_pipeline(self, db: Session) -> Dict[str, Any]:
        """Run all data ingestion tasks sequentially and return combined metrics."""
        now = datetime.now(timezone.utc)
        aq_res = await self.ingest_air_quality(db, target_time=now)
        weather_res = await self.ingest_weather(db, target_time=now)
        firms_res = await self.ingest_firms(db, days=1)

        return {
            "status": "success",
            "pipeline_executed_at": now.isoformat(),
            "results": {
                "air_quality": aq_res,
                "weather": weather_res,
                "firms_fires": firms_res,
            },
        }


# Global pipeline instance
pipeline_coordinator = IngestionPipeline()
