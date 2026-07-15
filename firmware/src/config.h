
// #ifndef CONFIG_H
// #define CONFIG_H

// // Serial
// #define SERIAL_BAUD_RATE        115200

// // Device identity
// #define FIRMWARE_VERSION        "1.0.0"
// #define NODE_ID                 "node1"   // change to node2, node3 for other units

// // WiFi credentials
// #define WIFI_SSID     "MSCA"
// #define WIFI_PASSWORD "@MSCA_2k26!"

// // MQTT Broker — Mosquitto on Raspberry Pi
// #define MQTT_BROKER             "10.10.79.142"
// #define MQTT_PORT               1883

// // MQTT Topics
// #define TOPIC_CO2               "co2monitor/" NODE_ID "/data"
// #define TOPIC_STATUS            "co2monitor/" NODE_ID "/status"

// // Timing
// #define SENSOR_READ_INTERVAL    5000   // read every 5 seconds
// #define MQTT_PUBLISH_INTERVAL   5000   // publish every 5 seconds

// // CO2 thresholds (ppm)
// #define CO2_SAFE_THRESHOLD      800.0
// #define CO2_HIGH_THRESHOLD      1200.0

// // WiFi
// #define WIFI_MAX_RETRY          20

// #endif

#ifndef CONFIG_H
#define CONFIG_H

// ─────────────────────────────────────────
// Serial
// ─────────────────────────────────────────
#define SERIAL_BAUD_RATE        115200

// ─────────────────────────────────────────
// Firmware version
// ─────────────────────────────────────────
#define FIRMWARE_VERSION        "1.0.0"

// ─────────────────────────────────────────
// Node identity
// Options: "inlet" | "outlet" | "solenoid_valves"
// Change this per ESP32 board before flashing
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
// Fake sensor ranges — INLET node
// (change these for outlet node)
// ─────────────────────────────────────────
#define FAKE_CO2_MIN            3000    // inlet: high CO2 entering adsorber
#define FAKE_CO2_MAX            6000    // outlet: change to 800-2500
#define FAKE_NO2_MIN            35      // ppb
#define FAKE_NO2_MAX            60
#define FAKE_SO2_MIN            20      // ppb
#define FAKE_SO2_MAX            45
#define FAKE_PH_MIN_X10         65      // pH x10 to avoid float in macro (6.5)
#define FAKE_PH_MAX_X10         82      // 8.2
#define FAKE_TEMP_MIN           25      // °C
#define FAKE_TEMP_MAX           35
#define FAKE_HUM_MIN            55      // %
#define FAKE_HUM_MAX            75
#define FAKE_PM25_MIN           20      // µg/m³
#define FAKE_PM25_MAX           55
#define FAKE_FLOW_MIN_X10       18      // L/min x10 (1.8)
#define FAKE_FLOW_MAX_X10       30      // 3.0
#define FAKE_LEVEL_MIN          40      // % liquid level
#define FAKE_LEVEL_MAX          85

// ─────────────────────────────────────────
// Valve defaults (solenoid_valves node only)
// ─────────────────────────────────────────
#define VALVE_COUNT             4

#endif