from app.schemas.air_quality import (
    AirQualityReadingBase,
    AirQualityReadingCreate,
    AirQualityReadingResponse,
    AirQualityStats,
)
from app.schemas.weather import (
    WeatherReadingBase,
    WeatherReadingCreate,
    WeatherReadingResponse,
    InversionStats,
)
from app.schemas.fires import (
    FireHotspotBase,
    FireHotspotCreate,
    FireHotspotResponse,
    FireStats,
)
from app.schemas.consolidated import (
    ConsolidatedDashboardResponse,
    AQISummary,
    WeatherSummary,
    FireSummary,
    ModelFeaturePayload,
)

__all__ = [
    "AirQualityReadingBase",
    "AirQualityReadingCreate",
    "AirQualityReadingResponse",
    "AirQualityStats",
    "WeatherReadingBase",
    "WeatherReadingCreate",
    "WeatherReadingResponse",
    "InversionStats",
    "FireHotspotBase",
    "FireHotspotCreate",
    "FireHotspotResponse",
    "FireStats",
    "ConsolidatedDashboardResponse",
    "AQISummary",
    "WeatherSummary",
    "FireSummary",
    "ModelFeaturePayload",
]
