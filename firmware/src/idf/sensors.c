#include "sensors.h"
#include <string.h>
#include "esp_random.h"

// Phase 3: FAKE values so the upload path can be tested without hardware.
// Phase 4 replaces only the inside of these functions with real sensor reads.

// Random number between -span and +span (adds a little noise to each reading).
static float jitter(float span) {
    return ((float)(esp_random() % 2001) / 1000.0f - 1.0f) * span;
}

void zc_sensors_init(void) {
    // Nothing to set up for fake sensors. Phase 4: I2C bus, SCD41, AHT31, PM2.5 UART.
}

bool zc_sensors_read_all(zc_reading_t *out) {
    memset(out, 0, sizeof(*out));
    const bool inlet = strcmp(ZC_PROFILE, "inlet") == 0;

    // Adsorption effect: gas leaving the column (outlet) has less CO2 than gas entering it.
    out->has_co2 = true;
    out->co2 = inlet ? 4000.0f + jitter(150.0f) : 800.0f + jitter(60.0f);

    out->has_temperature = true;
    out->temperature = 29.0f + jitter(0.5f);

    out->has_humidity = true;
    out->humidity = 63.0f + jitter(2.0f);

    out->has_pm25 = true;
    out->pm25 = inlet ? 30.0f + jitter(3.0f) : 12.0f + jitter(2.0f);

    return true;
}
