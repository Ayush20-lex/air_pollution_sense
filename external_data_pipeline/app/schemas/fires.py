from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class FireHotspotBase(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Hotspot Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Hotspot Longitude")
    brightness: Optional[float] = Field(None, ge=0.0, description="Brightness temperature in Kelvin")
    confidence: Optional[str] = Field(None, description="Detection confidence (nominal, high, low, %)")
    satellite: Optional[str] = Field(None, description="Satellite sensor (e.g. VIIRS, MODIS)")
    region: Optional[str] = Field(None, description="Geographical State / Region (Punjab, Haryana, UP, etc.)")
    acq_datetime_utc: datetime = Field(..., description="Acquisition datetime in UTC")


class FireHotspotCreate(FireHotspotBase):
    pass


class FireHotspotResponse(FireHotspotBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RegionalFireCount(BaseModel):
    region: str
    count: int


class FireStats(BaseModel):
    total_active_fires_24h: int
    total_active_fires_48h: int
    regional_breakdown: List[RegionalFireCount]
    highest_intensity_brightness: Optional[float]
    last_detected_utc: Optional[datetime]
