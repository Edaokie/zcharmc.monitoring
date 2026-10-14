#pragma once
#include <stdbool.h>

// One snapshot of every measurement this node can make.
// has_* = false means "no valid value": the field is left out of the upload,
// never sent as 0 (backend contract: omit unknown values, don't fabricate zeros).
typedef struct {
    bool has_co2;         float co2;          // ppm
    bool has_temperature; float temperature;  // °C
    bool has_humidity;    float humidity;     // %RH
    bool has_pm25;        float pm25;         // µg/m³
} zc_reading_t;

void zc_sensors_init(void);
bool zc_sensors_read_all(zc_reading_t *out);
