from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class AirQualityReadingBase(BaseModel):
    station_id: str = Field(..., description="Unique Station Identifier")
    location_name: str = Field(..., description="Monitoring Station / Neighborhood Name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Station Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Station Longitude")
    pm25: Optional[float] = Field(None, ge=0.0, le=2000.0, description="PM2.5 concentration in µg/m³")
    pm10: Optional[float] = Field(None, ge=0.0, le=3000.0, description="PM10 concentration in µg/m³")
    o3: Optional[float] = Field(None, ge=0.0, le=1000.0, description="Ozone (O3) concentration in µg/m³")
    nox: Optional[float] = Field(None, ge=0.0, le=1000.0, description="NOx concentration in µg/m³")
    aqi_calculated: Optional[float] = Field(None, ge=0.0, le=1000.0, description="Calculated CPCB National AQI")
    aqi_category: Optional[str] = Field(None, description="Good, Satisfactory, Moderate, Poor, Very Poor, Severe")
    dominant_pollutant: Optional[str] = Field(None, description="Dominant pollutant driving AQI")
    timestamp_utc: datetime = Field(..., description="Timestamp of observation in UTC")


class AirQualityReadingCreate(AirQualityReadingBase):
    pass


class AirQualityReadingResponse(AirQualityReadingBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AirQualityStats(BaseModel):
    total_stations: int
    avg_pm25: Optional[float]
    avg_pm10: Optional[float]
    avg_aqi: Optional[float]
    overall_category: Optional[str]
    dominant_pollutant: Optional[str]
    latest_timestamp: Optional[datetime]
