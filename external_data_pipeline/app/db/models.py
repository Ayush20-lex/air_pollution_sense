import datetime
from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    Boolean,
    DateTime,
    Index,
    UniqueConstraint,
)
from app.db.session import Base


class AirQualityReading(Base):
    """Air Quality Monitoring Readings for Delhi NCR stations."""

    __tablename__ = "air_quality_readings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    station_id = Column(String(100), nullable=False, index=True)
    location_name = Column(String(255), nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    # Pollutant concentrations (in µg/m³)
    pm25 = Column(Float, nullable=True)
    pm10 = Column(Float, nullable=True)
    o3 = Column(Float, nullable=True)
    nox = Column(Float, nullable=True)

    # Calculated CPCB National AQI metrics
    aqi_calculated = Column(Float, nullable=True)
    aqi_category = Column(String(50), nullable=True)
    dominant_pollutant = Column(String(20), nullable=True)

    # Timestamps
    timestamp_utc = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "station_id", "timestamp_utc", name="uq_station_timestamp"
        ),
        Index("idx_aq_loc_time", "location_name", "timestamp_utc"),
        Index("idx_aq_spatial", "latitude", "longitude"),
    )

    def __repr__(self) -> str:
        return f"<AirQualityReading {self.station_id} @ {self.timestamp_utc}: AQI={self.aqi_calculated}>"


class WeatherReading(Base):
    """Meteorological & Atmospheric Boundary Layer readings for Delhi NCR."""

    __tablename__ = "weather_readings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    location_name = Column(String(255), nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    # Core Meteorological Parameters
    temperature = Column(Float, nullable=True)  # in °C
    humidity = Column(Float, nullable=True)     # in %
    wind_speed = Column(Float, nullable=True)   # in m/s
    wind_direction = Column(Float, nullable=True)  # in degrees

    # Atmospheric Coupler & Boundary Layer Indicators
    pbl_height = Column(Float, nullable=True)        # Planetary Boundary Layer height in meters
    inversion_flag = Column(Boolean, default=False)  # True = High inversion pollution trap
    ventilation_index = Column(Float, nullable=True) # m²/s (Wind Speed * PBL Height)

    # Timestamps
    timestamp_utc = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "location_name", "timestamp_utc", name="uq_weather_loc_timestamp"
        ),
        Index("idx_weather_loc_time", "location_name", "timestamp_utc"),
        Index("idx_weather_spatial", "latitude", "longitude"),
    )

    def __repr__(self) -> str:
        return f"<WeatherReading {self.location_name} @ {self.timestamp_utc}: Temp={self.temperature}°C, PBL={self.pbl_height}m>"


class FireHotspot(Base):
    """Active fire hotspot detections from NASA FIRMS (MODIS/VIIRS) for stubble burning zones."""

    __tablename__ = "fire_hotspots"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    latitude = Column(Float, nullable=False, index=True)
    longitude = Column(Float, nullable=False, index=True)
    brightness = Column(Float, nullable=True)      # Brightness temperature in Kelvin
    confidence = Column(String(50), nullable=True) # Low, Nominal, High, or percentage
    satellite = Column(String(50), nullable=True)  # VIIRS / MODIS
    region = Column(String(100), nullable=True, index=True) # Punjab, Haryana, Western UP, Delhi NCR

    # Timestamps
    acq_datetime_utc = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "latitude", "longitude", "acq_datetime_utc", name="uq_fire_location_time"
        ),
        Index("idx_fire_time_region", "acq_datetime_utc", "region"),
        Index("idx_fire_spatial", "latitude", "longitude"),
    )

    def __repr__(self) -> str:
        return f"<FireHotspot ({self.latitude}, {self.longitude}) @ {self.acq_datetime_utc}: Conf={self.confidence}>"
