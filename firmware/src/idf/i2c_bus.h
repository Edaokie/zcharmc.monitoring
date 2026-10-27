#pragma once
#include "esp_err.h"
#include "driver/i2c_master.h"
/* Shared sensor I2C bus (wiring v1): SDA GPIO21, SCL GPIO22, 4.7 kOhm pull-ups to 3V3.
 * Inlet/outlet only; the control image never configures these pins. */
#define ZC_I2C_SDA 21
#define ZC_I2C_SCL 22
esp_err_t zc_i2c_init(void);
i2c_master_bus_handle_t zc_i2c_bus(void); /* NULL until zc_i2c_init succeeds. */
int zc_i2c_scan(void); /* Logs every 7-bit address that acknowledges; returns the count. */
