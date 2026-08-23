"""Data cleaning, validation, standard CPCB NAQI calculation,
and atmospheric inversion pre-processing.
"""

import math
from datetime import datetime, timezone
from typing import Optional, Dict, Tuple, Any
import numpy as np
import pandas as pd


# CPCB NAQI Breakpoint Table
# format: (C_low, C_high, I_low, I_high)
NAQI_BREAKPOINTS = {
    "pm25": [
        (0.0, 30.0, 0, 50),
        (30.1, 60.0, 51, 100),
        (60.1, 90.0, 101, 200),
        (90.1, 120.0, 201, 300),
        (120.1, 250.0, 301, 400),
        (250.1, 500.0, 401, 500),
    ],
    "pm10": [
        (0.0, 50.0, 0, 50),
        (50.1, 100.0, 51, 100),
        (100.1, 250.0, 101, 200),
        (250.1, 350.0, 201, 300),
        (350.1, 430.0, 301, 400),
        (430.1, 600.0, 401, 500),
    ],
    "nox": [
        (0.0, 40.0, 0, 50),
        (40.1, 80.0, 51, 100),
        (80.1, 180.0, 101, 200),
        (180.1, 280.0, 201, 300),
        (280.1, 400.0, 301, 400),
        (400.1, 600.0, 401, 500),
    ],
    "o3": [
        (0.0, 50.0, 0, 50),
        (50.1, 100.0, 51, 100),
        (100.1, 168.0, 101, 200),
        (168.1, 208.0, 201, 300),
        (208.1, 748.0, 301, 400),
        (748.1, 1000.0, 401, 500),
    ],
}


def sanitize_numeric(
    val: Any,
    min_val: Optional[float] = None,
    max_val: Optional[float] = None,
) -> Optional[float]:
    """Sanitize float input, rejecting sensor error codes (e.g. -999, negative) and out-of-range spikes."""
    if val is None:
        return None
    try:
        f_val = float(val)
        if math.isnan(f_val) or math.isinf(f_val):
            return None
        if min_val is not None and f_val < min_val:
            return None
        if max_val is not None and f_val > max_val:
            return None
        return round(f_val, 2)
    except (ValueError, TypeError):
        return None


def normalize_utc_timestamp(ts: Any) -> datetime:
    """Normalize any datetime/string timestamp to UTC ISO 8601 aware datetime."""
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)
    if isinstance(ts, (int, float)):
        # Epoch seconds or milliseconds
        if ts > 1e11:  # milliseconds
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(ts, str):
        # Clean string format
        dt = pd.to_datetime(ts, utc=True)
        return dt.to_pydatetime()
    # Fallback to current UTC
    return datetime.now(timezone.utc)


def calculate_sub_index(pollutant: str, concentration: float) -> Optional[float]:
    """Calculate single pollutant sub-index based on CPCB breakpoint interpolation."""
    if concentration is None or concentration < 0:
        return None

    breakpoints = NAQI_BREAKPOINTS.get(pollutant.lower())
    if not breakpoints:
        return None

    for c_low, c_high, i_low, i_high in breakpoints:
        if c_low <= concentration <= c_high:
            # Linear interpolation formula
            sub_index = ((i_high - i_low) / (c_high - c_low)) * (concentration - c_low) + i_low
            return round(sub_index, 1)

    # Beyond severe breakpoint threshold
    if concentration > breakpoints[-1][1]:
        # Extrapolate beyond 500 capped at 500
        return 500.0

    return None


def get_aqi_category(aqi: Optional[float]) -> str:
    """Classify AQI value into official CPCB categories."""
    if aqi is None:
        return "Unknown"
    if aqi <= 50:
        return "Good"
    elif aqi <= 100:
        return "Satisfactory"
    elif aqi <= 200:
        return "Moderate"
    elif aqi <= 300:
        return "Poor"
    elif aqi <= 400:
        return "Very Poor"
    else:
        return "Severe"


def calculate_cpcb_aqi(
    pm25: Optional[float] = None,
    pm10: Optional[float] = None,
    nox: Optional[float] = None,
    o3: Optional[float] = None,
) -> Tuple[Optional[float], Optional[str], Optional[str]]:
    """Calculate overall Indian National AQI (NAQI) from available pollutant concentrations.

    Returns:
        (aqi_value, aqi_category, dominant_pollutant)
    """
    sub_indices: Dict[str, float] = {}

    if pm25 is not None and pm25 >= 0:
        si = calculate_sub_index("pm25", pm25)
        if si is not None:
            sub_indices["PM2.5"] = si

    if pm10 is not None and pm10 >= 0:
        si = calculate_sub_index("pm10", pm10)
        if si is not None:
            sub_indices["PM10"] = si

    if nox is not None and nox >= 0:
        si = calculate_sub_index("nox", nox)
        if si is not None:
            sub_indices["NOx"] = si

    if o3 is not None and o3 >= 0:
        si = calculate_sub_index("o3", o3)
        if si is not None:
            sub_indices["O3"] = si

    if not sub_indices:
        return None, None, None

    dominant_pollutant = max(sub_indices, key=sub_indices.get)
    max_aqi = sub_indices[dominant_pollutant]
    category = get_aqi_category(max_aqi)

    return round(max_aqi, 1), category, dominant_pollutant


def evaluate_inversion_and_dispersion(
    pbl_height: Optional[float],
    wind_speed: Optional[float],
) -> Tuple[bool, Optional[float], str]:
    """Calculate atmospheric inversion flag, ventilation coefficient, and risk level.

    Formulas:
        Ventilation Index (m²/s) = Wind Speed (m/s) * PBL Height (m)
        Inversion Trap Flag = True if PBL Height < 400m AND Wind Speed < 2.0 m/s

    Returns:
        (inversion_flag, ventilation_index, risk_level)
    """
    if pbl_height is None or wind_speed is None:
        return False, None, "UNKNOWN"

    ventilation_idx = round(wind_speed * pbl_height, 2)
    inversion_flag = bool(pbl_height < 400.0 and wind_speed < 2.0)

    # Risk level classification
    if pbl_height < 300.0 and wind_speed < 1.5:
        risk_level = "CRITICAL"
    elif pbl_height < 500.0 and wind_speed < 2.5:
        risk_level = "HIGH"
    elif pbl_height < 800.0 or wind_speed < 3.5:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    return inversion_flag, ventilation_idx, risk_level


def clean_air_quality_record(raw_record: Dict[str, Any]) -> Dict[str, Any]:
    """Validate, clean, and augment a raw air quality observation."""
    pm25 = sanitize_numeric(raw_record.get("pm25"), min_val=0.0, max_val=1500.0)
    pm10 = sanitize_numeric(raw_record.get("pm10"), min_val=0.0, max_val=2500.0)
    nox = sanitize_numeric(raw_record.get("nox"), min_val=0.0, max_val=1000.0)
    o3 = sanitize_numeric(raw_record.get("o3"), min_val=0.0, max_val=1000.0)

    aqi_calc, category, dom_poll = calculate_cpcb_aqi(pm25=pm25, pm10=pm10, nox=nox, o3=o3)

    return {
        "station_id": str(raw_record.get("station_id", "DEL_UNKNOWN")),
        "location_name": str(raw_record.get("location_name", "Delhi NCR")),
        "latitude": float(raw_record.get("latitude", 28.6139)),
        "longitude": float(raw_record.get("longitude", 77.2090)),
        "pm25": pm25,
        "pm10": pm10,
        "nox": nox,
        "o3": o3,
        "aqi_calculated": aqi_calc,
        "aqi_category": category,
        "dominant_pollutant": dom_poll,
        "timestamp_utc": normalize_utc_timestamp(raw_record.get("timestamp_utc") or raw_record.get("timestamp")),
    }


def clean_weather_record(raw_record: Dict[str, Any]) -> Dict[str, Any]:
    """Validate, clean, and augment a raw meteorological observation."""
    temp = sanitize_numeric(raw_record.get("temperature"), min_val=-20.0, max_val=60.0)
    humidity = sanitize_numeric(raw_record.get("humidity"), min_val=0.0, max_val=100.0)
    wind_speed = sanitize_numeric(raw_record.get("wind_speed"), min_val=0.0, max_val=100.0)
    wind_dir = sanitize_numeric(raw_record.get("wind_direction"), min_val=0.0, max_val=360.0)
    pbl_height = sanitize_numeric(raw_record.get("pbl_height"), min_val=0.0, max_val=10000.0)

    inversion_flag, vent_idx, _ = evaluate_inversion_and_dispersion(pbl_height, wind_speed)

    return {
        "location_name": str(raw_record.get("location_name", "Delhi Central")),
        "latitude": float(raw_record.get("latitude", 28.6139)),
        "longitude": float(raw_record.get("longitude", 77.2090)),
        "temperature": temp,
        "humidity": humidity,
        "wind_speed": wind_speed,
        "wind_direction": wind_dir,
        "pbl_height": pbl_height,
        "inversion_flag": inversion_flag,
        "ventilation_index": vent_idx,
        "timestamp_utc": normalize_utc_timestamp(raw_record.get("timestamp_utc") or raw_record.get("timestamp")),
    }


def clean_fire_record(raw_record: Dict[str, Any]) -> Dict[str, Any]:
    """Validate, clean, and augment a NASA FIRMS fire hotspot record."""
    lat = float(raw_record.get("latitude", 0.0))
    lon = float(raw_record.get("longitude", 0.0))
    brightness = sanitize_numeric(raw_record.get("brightness"), min_val=200.0, max_val=600.0)
    confidence = str(raw_record.get("confidence", "nominal"))
    satellite = str(raw_record.get("satellite", "VIIRS"))

    # Determine state/region based on geographic coordinates
    region = raw_record.get("region")
    if not region:
        if 29.5 <= lat <= 32.5 and 74.0 <= lon <= 76.8:
            region = "Punjab"
        elif 27.5 <= lat <= 30.8 and 75.8 <= lon <= 77.8:
            region = "Haryana"
        elif 26.5 <= lat <= 30.5 and 77.5 <= lon <= 80.5:
            region = "Western UP"
        elif 28.3 <= lat <= 28.9 and 76.8 <= lon <= 77.5:
            region = "Delhi NCR"
        else:
            region = "Surrounding Buffer"

    return {
        "latitude": lat,
        "longitude": lon,
        "brightness": brightness,
        "confidence": confidence,
        "satellite": satellite,
        "region": region,
        "acq_datetime_utc": normalize_utc_timestamp(raw_record.get("acq_datetime_utc") or raw_record.get("timestamp")),
    }
