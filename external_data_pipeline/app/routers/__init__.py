from app.routers.air_quality import router as air_quality_router
from app.routers.weather import router as weather_router
from app.routers.fires import router as fires_router
from app.routers.consolidated import router as consolidated_router
from app.routers.ingestion_admin import router as ingestion_admin_router

__all__ = [
    "air_quality_router",
    "weather_router",
    "fires_router",
    "consolidated_router",
    "ingestion_admin_router",
]
