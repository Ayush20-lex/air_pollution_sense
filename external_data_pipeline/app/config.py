import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    """Application and environment configuration."""

    # Database
    DB_URL: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/delhi_aqi_db",
        description="SQLAlchemy database connection URL (PostgreSQL or SQLite)",
    )

    # External APIs
    NASA_FIRMS_KEY: str = Field(
        default="",
        description="NASA FIRMS MAP Key for active fire hotspot data",
    )
    OPENAQ_API_KEY: str = Field(
        default="",
        description="Optional API key for OpenAQ v3",
    )

    # Ingestion Scheduling (Intervals in Minutes)
    AQI_INGESTION_INTERVAL_MINUTES: int = Field(
        default=60,
        description="Interval between air quality data fetches",
    )
    WEATHER_INGESTION_INTERVAL_MINUTES: int = Field(
        default=60,
        description="Interval between meteorological data fetches",
    )
    FIRMS_INGESTION_INTERVAL_MINUTES: int = Field(
        default=180,
        description="Interval between NASA FIRMS hotspot data fetches",
    )

    # Application Settings
    APP_NAME: str = "Air Pollution–Weather Coupled Forecasting Pipeline (Delhi NCR Focus)"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # Delhi NCR Coordinate Bounding Box & Centroid
    DELHI_LAT: float = 28.6139
    DELHI_LON: float = 77.2090
    
    # Regional Bounding Box for Stubble Burning Corridor (Punjab, Haryana, Western UP)
    # min_lat, min_lon, max_lat, max_lon
    FIRMS_BBOX: str = "74.0,27.0,78.5,32.5"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
