"""Wire units and broad validity bounds, NOT equipment safety/alarm thresholds.

Weight is reserved: grams are the new API contract, pending hardware calibration.
Bounds intentionally allow abnormal process values to be recorded and alarmed.
"""
MAX_FUTURE_SECONDS = 60
SENSOR_CONTRACT = {
    "co2": {"unit": "ppm", "min": 0, "max": 1_000_000},
    "temperature": {"unit": "degC", "min": -273.15, "max": 1000},
    "humidity": {"unit": "%RH", "min": 0, "max": 100},
    "ph": {"unit": "pH", "min": 0, "max": 14},
    "pm25": {"unit": "ug/m3", "min": 0, "max": 1_000_000},
    "flow_rate": {"unit": "L/min", "min": 0, "max": 1_000_000},
    "level": {"unit": "%", "min": 0, "max": 100},
    "weight": {"unit": "g", "min": 0, "max": 1_000_000_000},
    "no2": {"unit": "ppm", "min": 0, "max": 1_000_000},
    "so2": {"unit": "ppm", "min": 0, "max": 1_000_000},
    # Gauge pressure may be negative under vacuum.
    "pressure1": {"unit": "psi (gauge)", "min": -14.7, "max": 10_000},
    "pressure2": {"unit": "psi (gauge)", "min": -14.7, "max": 10_000},
}
