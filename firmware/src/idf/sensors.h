#pragma once
#include <stdbool.h>
#include <stdint.h>
#define ZC_MODE_STATIC 1
#ifndef ZC_DATA_MODE
#error "Select an explicit acquisition mode"
#endif
#if ZC_DATA_MODE != ZC_MODE_STATIC
#error "Real sensor adapters are not implemented; do not label static values as real"
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
