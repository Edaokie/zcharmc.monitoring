#pragma once
#include <stdbool.h>
#include <stdint.h>
#define ZC_MODE_STATIC 1 /* Fixed fixtures; uploaded as source "simulated" to the test table. */
#define ZC_MODE_REAL 2   /* SCD41, AHT25, PMS7003 values; uploaded to research /api/ingest. */
#ifndef ZC_DATA_MODE
#error "Select an explicit acquisition mode"
#endif
#if ZC_DATA_MODE != ZC_MODE_STATIC && ZC_DATA_MODE != ZC_MODE_REAL
#error "Unknown acquisition mode; do not label static values as real"
#endif
/* Stable wire units/order shared by static fixtures, payloads and queue schema v2. */
enum { ZC_CO2, ZC_TEMPERATURE, ZC_HUMIDITY, ZC_PH, ZC_PM25, ZC_FLOW,
       ZC_LEVEL, ZC_WEIGHT, ZC_NO2, ZC_SO2, ZC_PRESSURE1, ZC_PRESSURE2, ZC_FIELDS };
typedef struct {
    uint32_t flags;
    float values[ZC_FIELDS];
    float weight1_g, weight2_g;
    uint32_t valve_bits, control_flags; /* Four logical bench valves; no GPIO writes. */
} zc_reading_t;
void zc_sensors_init(void);
bool zc_sensors_read_all(zc_reading_t *out);

/* Real mode: what the sensor tasks currently offer. A value is used only when its
 * driver reports a fresh, successful measurement (ok=true); nothing is substituted. */
typedef struct {
    bool co2_ok; float co2_ppm;                 /* SCD41, ASC off, factory calibration. */
    bool th_ok; float temperature_c, humidity_pct; /* AHT25 with calibration bits set. */
    bool pm_ok; float pm25_ug_m3;               /* PMS7003 PM2.5, atmospheric value. */
} zc_real_inputs_t;
/* Fills values and validity flags from real inputs; returns false if none is valid. */
bool zc_real_fill(const zc_real_inputs_t *in, zc_reading_t *out);
