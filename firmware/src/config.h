#ifndef CONFIG_H
#define CONFIG_H

// ─────────────────────────────────────────
// Serial
// ─────────────────────────────────────────
#define SERIAL_BAUD_RATE        115200

// ─────────────────────────────────────────
// Node identity
// !! CHANGE THIS PER BOARD BEFORE FLASHING !!
// Options: "inlet" | "outlet" | "solenoid_valves"
// ─────────────────────────────────────────
#define NODE_ID                 "inlet"

// ─────────────────────────────────────────
// WiFi credentials
// ─────────────────────────────────────────
#define WIFI_SSID               "MSCA"
#define WIFI_PASSWORD           "@MSCA_2K26!"

// ─────────────────────────────────────────
// MQTT Broker — Mosquitto on Raspberry Pi
// ─────────────────────────────────────────
#define MQTT_BROKER             "10.10.79.142"
#define MQTT_PORT               1883

// ─────────────────────────────────────────
// MQTT Topics
// ─────────────────────────────────────────
#define TOPIC_DATA              "co2monitor/" NODE_ID "/data"
#define TOPIC_STATUS            "co2monitor/" NODE_ID "/status"

// ─────────────────────────────────────────
// Timing
// ─────────────────────────────────────────
#define PUBLISH_INTERVAL_MS     5000
#define WIFI_MAX_RETRY          20

// ─────────────────────────────────────────
// CO2 thresholds (ppm) — industrial ranges
// ─────────────────────────────────────────
#define CO2_NORMAL_MAX          3000.0
#define CO2_WARN_MAX            5000.0

// ─────────────────────────────────────────
// Fake sensor ranges
// INLET node  → high CO2 entering adsorber
// OUTLET node → low CO2 after adsorption
// ─────────────────────────────────────────

// CO2 (ppm)
#define FAKE_CO2_MIN            3000    // outlet: change to 800
#define FAKE_CO2_MAX            6000    // outlet: change to 2500

// NO2 (ppb)
#define FAKE_NO2_MIN            35
#define FAKE_NO2_MAX            60

// SO2 (ppb)
#define FAKE_SO2_MIN            20
#define FAKE_SO2_MAX            45

// pH x10 to avoid float in macro
// 65 = 6.5, 82 = 8.2
#define FAKE_PH_MIN_X10         65
#define FAKE_PH_MAX_X10         82

// Temperature (°C)
#define FAKE_TEMP_MIN           25
#define FAKE_TEMP_MAX           35

// Humidity (%)
#define FAKE_HUM_MIN            55
#define FAKE_HUM_MAX            75

// PM2.5 (µg/m³)
#define FAKE_PM25_MIN           20
#define FAKE_PM25_MAX           55

// Flow rate x10
// 18 = 1.8 L/min, 30 = 3.0 L/min
#define FAKE_FLOW_MIN_X10       18
#define FAKE_FLOW_MAX_X10       30

// Liquid level (%)
#define FAKE_LEVEL_MIN          40
#define FAKE_LEVEL_MAX          85

// ─────────────────────────────────────────
// Valve config (solenoid_valves node only)
// ─────────────────────────────────────────
#define VALVE_COUNT             4

#endif