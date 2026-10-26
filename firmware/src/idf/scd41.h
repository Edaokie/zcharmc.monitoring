#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* Sensirion SCD41 on the shared sensor I2C bus (address 0x62). Periodic measurement
 * gives a new CO2 value every 5 s. Its temperature/RH are internal compensation values;
 * the AHT25 is the official temp/RH sensor. Automatic self-calibration (ASC) is switched
 * off at every start because the column never sees fresh ~400 ppm air; calibration is a
 * separate, recorded step (Phase 6). Settings are not persisted to the sensor's EEPROM. */
#define ZC_SCD41_ADDR 0x62
typedef struct { uint16_t co2_ppm; float temperature_c, humidity_pct; } zc_scd41_reading_t;
/* Sensirion CRC-8 (poly 0x31, init 0xFF) over one 16-bit word. */
uint8_t zc_scd41_crc(const uint8_t *word);
/* Decodes a 9-byte read_measurement response; false on any CRC error. */
bool zc_scd41_decode(const uint8_t *raw, zc_scd41_reading_t *out);
#ifdef ESP_PLATFORM
#include "esp_err.h"
/* Starts the SCD41 task on the bus from zc_i2c_bus(); returns at once. */
esp_err_t zc_scd41_init(void);
/* Never blocks: copies the newest reading if it is at most max_age_ms old.
 * serial (optional) receives the 48-bit serial number once the sensor has started. */
esp_err_t zc_scd41_latest(zc_scd41_reading_t *out, int max_age_ms, uint64_t *serial);
#endif
