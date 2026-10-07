#pragma once
// ─────────────────────────────────────────────────────────────
// Shared config for ALL nodes. Safe to commit: no secrets here.
// Credentials live in include/secrets.h (gitignored).
// Valve-node-only settings live in include/nodes_config/sv_config.h.
// FW_VERSION / FW_ENV come from platformio.ini build flags.
// ─────────────────────────────────────────────────────────────
#include "secrets.h"

// ── Node identity ─────────────────────────────────────────────
// NODE_ID is set per build environment in platformio.ini (Phase 1):
//   pio run -e inlet    → NODE_ID = "inlet"
//   pio run -e outlet   → NODE_ID = "outlet"
#ifndef NODE_ID
#error "NODE_ID not set - build with: pio run -e inlet  (or -e outlet)"
#endif

// ── Serial ────────────────────────────────────────────────────
#define SERIAL_BAUD_RATE        115200

// ── WiFi / MQTT behaviour (not secrets) ───────────────────────
#define WIFI_MAX_RETRY          20
#define MQTT_BUFFER_SIZE        512

// ── MQTT topics ───────────────────────────────────────────────
#define TOPIC_DATA              "co2monitor/" NODE_ID "/data"
#define TOPIC_STATUS            "co2monitor/" NODE_ID "/status"
#define TOPIC_CMD               "co2monitor/" NODE_ID "/cmd"

// ── Timing ────────────────────────────────────────────────────
#define PUBLISH_INTERVAL_MS     5000UL

// ── CO2 alert thresholds (ppm) ────────────────────────────────
#define CO2_NORMAL_MAX          3000.0f
#define CO2_WARN_MAX            5000.0f

// ── Fake sensor ranges (only used with -D USE_FAKE_SENSORS) ───
// Inlet = gas going into the column; outlet = after adsorption (lower CO2)
#define FAKE_CO2_INLET_MIN      3000    // ppm
#define FAKE_CO2_INLET_MAX      6000
#define FAKE_CO2_OUTLET_MIN     800
#define FAKE_CO2_OUTLET_MAX     2500

#define FAKE_TEMP_MIN           25      // °C
#define FAKE_TEMP_MAX           35
#define FAKE_HUM_MIN            55      // %RH
#define FAKE_HUM_MAX            75
#define FAKE_PM25_MIN           20      // µg/m³
#define FAKE_PM25_MAX           55
