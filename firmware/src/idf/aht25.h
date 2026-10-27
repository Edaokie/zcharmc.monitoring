#pragma once
#include <stdbool.h>
#include <stdint.h>
/* Aosong AHT25 on the shared sensor I2C bus (address 0x38): the official temperature
 * and relative humidity sensor for each node. One measurement every 5 s (the datasheet
 * advises at most one per 2 s to avoid self-heating). */
#define ZC_AHT25_ADDR 0x38
typedef struct { float temperature_c, humidity_pct; } zc_aht25_reading_t;
/* CRC-8 used by the AHT2x family (poly 0x31, init 0xFF) over n bytes. */
uint8_t zc_aht25_crc(const uint8_t *data, int n);
/* Decodes the 7-byte measurement response (status, 5 data bytes, CRC).
 * Returns false if the sensor is still busy or the CRC does not match. */
bool zc_aht25_decode(const uint8_t *raw, zc_aht25_reading_t *out);
#ifdef ESP_PLATFORM
#include "esp_err.h"
/* Starts the AHT25 task on the bus from zc_i2c_bus(); returns at once. */
esp_err_t zc_aht25_init(void);
/* Never blocks: copies the newest reading if it is at most max_age_ms old. */
esp_err_t zc_aht25_latest(zc_aht25_reading_t *out, int max_age_ms);
#endif
