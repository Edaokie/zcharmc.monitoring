#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* Plantower PMS7003 (wiring v1): UART2 at 9600 8N1, ESP32 TX2=GPIO17 -> sensor RX,
 * RX2=GPIO16 <- sensor TX, 5 V supply from VIN. Default active mode: the sensor
 * streams a 32-byte frame every ~0.2-2.3 s. Values in ug/m3 and counts per 0.1 L. */
#define ZC_PMS_TX 17
#define ZC_PMS_RX 16
#define ZC_PMS_FRAME 32
typedef struct {
    uint16_t pm1_cf1, pm25_cf1, pm10_cf1;   /* "CF=1" standard-particle values. */
    uint16_t pm1_atm, pm25_atm, pm10_atm;   /* Atmospheric-environment values. */
    uint16_t count[6];                      /* >0.3, >0.5, >1.0, >2.5, >5.0, >10 um per 0.1 L. */
} zc_pms_frame_t;
/* Finds the first complete frame with a valid header, length and checksum in buf.
 * Returns true and fills out; *consumed is how many bytes the caller may discard. */
bool zc_pms_parse(const uint8_t *buf, size_t len, zc_pms_frame_t *out, size_t *consumed);
#ifdef ESP_PLATFORM
#include "esp_err.h"
/* Starts UART2 and a small reader task that keeps the newest valid frame. */
esp_err_t zc_pms_init(void);
/* Never blocks: copies the newest frame if it is at most max_age_ms old.
 * bytes_seen (optional) reports how many bytes arrived since boot, for wiring checks. */
esp_err_t zc_pms_latest(zc_pms_frame_t *out, int max_age_ms, uint32_t *bytes_seen);
#endif
