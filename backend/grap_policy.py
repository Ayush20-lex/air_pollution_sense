"""
Module: GRAP Policy Engine
Implements the official Indian PM2.5-to-AQI conversion and Graded Response Action Plan logic.
SIH26082 · MoES / NCMRWF
"""

def calculate_indian_aqi_pm25(pm25: float) -> int:
    """
    Official Indian AQI piecewise linear conversion for PM2.5 (24-hr average).
    Formula: I = [(I_hi - I_lo) / (C_hi - C_lo)] * (C - C_lo) + I_lo
    """
    pm25 = round(pm25, 1)
    
    # Breakpoints: (C_lo, C_hi, I_lo, I_hi)
    breakpoints = [
        (0.0, 30.0, 0, 50),
        (30.1, 60.0, 51, 100),
        (60.1, 90.0, 101, 200),
        (90.1, 120.0, 201, 300),
        (120.1, 250.0, 301, 400),
        (250.1, 350.0, 401, 500), # Standard caps at 500
    ]
    
    for (C_lo, C_hi, I_lo, I_hi) in breakpoints:
        if C_lo <= pm25 <= C_hi:
            aqi = ((I_hi - I_lo) / (C_hi - C_lo)) * (pm25 - C_lo) + I_lo
            return int(round(aqi))
    
    if pm25 > 350.0:
        # Extrapolate beyond 500 for Severe+ situations
        C_lo, C_hi, I_lo, I_hi = 250.1, 350.0, 401, 500
        aqi = ((I_hi - I_lo) / (C_hi - C_lo)) * (pm25 - C_lo) + I_lo
        return int(round(aqi))
    
    return 0

def evaluate_grap_stage(aqi: int) -> dict:
    """
    Determine the GRAP stage based on AQI and return mitigation actions.
    
    - Stage 1 (Poor): AQI 201-300
    - Stage 2 (Very Poor): AQI 301-400
    - Stage 3 (Severe): AQI 401-450
    - Stage 4 (Severe+): AQI > 450
    """
    if aqi <= 200:
        return {
            "stage": 0,
            "category": "Moderate or Better",
            "actions": ["No emergency GRAP measures active.", "Follow regular pollution control protocols."]
        }
    elif 201 <= aqi <= 300:
        return {
            "stage": 1,
            "category": "Poor",
            "actions": [
                "Strict enforcement of dust mitigation measures.",
                "Ban on open burning of garbage.",
                "Restrict use of DG sets."
            ]
        }
    elif 301 <= aqi <= 400:
        return {
            "stage": 2,
            "category": "Very Poor",
            "actions": [
                "Ban on use of coal and firewood in tandoors in hotels/restaurants.",
                "Enhance parking fees to discourage private transport.",
                "Increase frequency of mechanized sweeping and water sprinkling on roads."
            ]
        }
    elif 401 <= aqi <= 450:
        return {
            "stage": 3,
            "category": "Severe",
            "actions": [
                "Strict ban on construction and demolition activities in NCR.",
                "Ban on BS III petrol and BS IV diesel vehicles.",
                "Close down operations of stone crushers and brick kilns."
            ]
        }
    else:  # AQI > 450
        return {
            "stage": 4,
            "category": "Severe+",
            "actions": [
                "Stop entry of truck traffic into Delhi (except essential commodities).",
                "Ban on construction in linear public projects (highways, roads, flyovers).",
                "State Governments may consider odd-even scheme for vehicles.",
                "Closure of educational institutions and implementation of WFH."
            ]
        }
