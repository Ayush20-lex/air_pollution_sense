from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.schemas.air_quality import AirQualityReadingResponse
from app.schemas.weather import WeatherReadingResponse
from app.schemas.fires import RegionalFireCount


class AQISummary(BaseModel):
    ncr_avg_pm25: Optional[float]
    ncr_avg_pm10: Optional[float]
    ncr_avg_aqi: Optional[float]
    overall_category: str
    dominant_pollutant: str
    total_reporting_stations: int
    latest_timestamp_utc: Optional[datetime]


class WeatherSummary(BaseModel):
    ncr_avg_temperature: Optional[float]
    ncr_avg_humidity: Optional[float]
    ncr_avg_wind_speed: Optional[float]
    ncr_avg_wind_direction: Optional[float]
    ncr_avg_pbl_height: Optional[float]
    ncr_avg_ventilation_index: Optional[float]
    inversion_risk_flag: bool
    inversion_risk_level: str  # LOW, MODERATE, HIGH, CRITICAL
    latest_timestamp_utc: Optional[datetime]


class FireSummary(BaseModel):
    active_fires_24h: int
    active_fires_48h: int
    regional_counts: List[RegionalFireCount]
    last_detected_utc: Optional[datetime]


class ModelFeaturePayload(BaseModel):
    """Normalized feature vector ready for WRF-Chem / ML coupled model ingestion."""
    timestamp_utc: datetime
    pm25: Optional[float]
    pm10: Optional[float]
    o3: Optional[float]
    nox: Optional[float]
    temperature: Optional[float]
    humidity: Optional[float]
    wind_speed: Optional[float]
    wind_direction: Optional[float]
    pbl_height: Optional[float]
    ventilation_index: Optional[float]
    inversion_flag: bool
    upstream_fire_count_24h: int


class ConsolidatedDashboardResponse(BaseModel):
    """Consolidated payload for Frontend UI Dashboard & Coupled ML Inference."""
    generated_at_utc: datetime = Field(default_factory=datetime.utcnow)
    aqi_summary: AQISummary
    weather_summary: WeatherSummary
    fire_summary: FireSummary
    latest_station_readings: List[AirQualityReadingResponse]
    latest_weather_readings: List[WeatherReadingResponse]
    ml_feature_vector: ModelFeaturePayload
