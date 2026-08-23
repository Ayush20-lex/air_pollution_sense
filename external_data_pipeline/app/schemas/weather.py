from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class WeatherReadingBase(BaseModel):
    location_name: str = Field(..., description="Location / Grid Cell Name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude")
    temperature: Optional[float] = Field(None, ge=-50.0, le=60.0, description="Temperature in °C")
    humidity: Optional[float] = Field(None, ge=0.0, le=100.0, description="Relative Humidity in %")
    wind_speed: Optional[float] = Field(None, ge=0.0, le=150.0, description="Wind Speed in m/s")
    wind_direction: Optional[float] = Field(None, ge=0.0, le=360.0, description="Wind Direction in degrees")
    pbl_height: Optional[float] = Field(None, ge=0.0, le=10000.0, description="Planetary Boundary Layer Height in meters")
    inversion_flag: Optional[bool] = Field(False, description="True if low PBL height + calm wind trap pollution")
    ventilation_index: Optional[float] = Field(None, ge=0.0, description="Ventilation Coefficient in m²/s (Wind Speed * PBLH)")
    timestamp_utc: datetime = Field(..., description="Timestamp of observation in UTC")


class WeatherReadingCreate(WeatherReadingBase):
    pass


class WeatherReadingResponse(WeatherReadingBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InversionStats(BaseModel):
    inversion_active: bool
    risk_level: str  # LOW, MODERATE, HIGH, CRITICAL
    avg_pbl_height: Optional[float]
    avg_wind_speed: Optional[float]
    avg_ventilation_index: Optional[float]
    summary: str
