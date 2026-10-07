#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "nvs.h"

#ifndef ZC_PROFILE
#error "Select a PlatformIO role profile"
#endif
#ifndef ZC_HARDWARE
#error "Set the hardware compatibility ID"
#endif

typedef struct {
    char device_id[65];
    char device_token[129];
    char backend[192];
    char ssid[33];
    char password[65];
    bool provisioned;
} zc_config_t;
extern zc_config_t zc_config;
extern nvs_handle_t zc_nvs;
extern volatile bool zc_maintenance;
extern volatile bool zc_updating;
extern volatile bool zc_network_ready;
extern const char *zc_status;
extern volatile bool zc_boot_ready;
bool zc_control_health(void);
void zc_config_init(void);
void zc_serial_task(void *arg);
void zc_network_task(void *arg);
void zc_ota_poll(void);
void zc_report(void);
