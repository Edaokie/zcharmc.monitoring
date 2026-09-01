#ifndef CONFIG_H
#define CONFIG_H

// ─────────────────────────────────────────
// Firmware metadata
// ─────────────────────────────────────────
#define FW_VERSION              "1.0.0"
#define FW_ENV                  "dev"     // change to "prod" before deployment

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
#define WIFI_MAX_RETRY          20

// ─────────────────────────────────────────
// MQTT Broker — Mosquitto on Raspberry Pi
// ─────────────────────────────────────────
#define MQTT_BROKER             "10.10.79.142"
#define MQTT_PORT               1883
#define MQTT_BUFFER_SIZE        512

// ─────────────────────────────────────────
// MQTT Topics
// ─────────────────────────────────────────
#define TOPIC_DATA              "co2monitor/" NODE_ID "/data"
#define TOPIC_STATUS            "co2monitor/" NODE_ID "/status"
#define TOPIC_CMD               "co2monitor/" NODE_ID "/cmd"

// ─────────────────────────────────────────
// Timing — sensor publish interval
// ─────────────────────────────────────────
#define PUBLISH_INTERVAL_MS     5000UL

// ─────────────────────────────────────────
// FSM Cycle Timing
// solenoid_valves node only
// ─────────────────────────────────────────
#define ADSORB_DURATION_MS      60000UL    // 1-MIN adsorption cycle
#define CLEAN_DURATION_MS       120000UL   // 2-MIN cleaning/purge cycle
#define PRESSURE_TIMEOUT_MS     600000UL   // 10-MIN max wait for pressure

// ─────────────────────────────────────────
// Pressure threshold
// ─────────────────────────────────────────
#define PRESSURE_THRESHOLD_PSI  150.0f

// ─────────────────────────────────────────
// GPIO Pin Assignments — ESP32 DevKit
// !! UPDATE THESE TO MATCH YOUR ACTUAL WIRING !!
// ─────────────────────────────────────────

// Solenoid Valves (relay module — active HIGH)
#define SV1_PIN                 2    // Inlet A
#define SV2_PIN                 4    // Inlet B
#define SV3_PIN                 5    // Outlet path
#define SV4_PIN                 12   // Center inlet
#define SV5_PIN                 13   // Purge open air (left)
#define SV6_PIN                 14   // Purge open air (right)
#define VALVE_COUNT             6

// Vacuum pumps (relay module — active HIGH)
#define VACUUM1_PIN             15   // Bottom — main inlet pump
#define VACUUM2_PIN             16   // Top-left — left column
#define VACUUM3_PIN             17   // Top-right — right column

// Pressure sensors (analog input — 12-bit ADC)
#define O1_PIN                  34   // Left tank (input-only GPIO)
#define O2_PIN                  35   // Right tank (input-only GPIO)

// ─────────────────────────────────────────
// CO2 thresholds (ppm) — industrial ranges
// ─────────────────────────────────────────
#define CO2_NORMAL_MAX          3000.0f
#define CO2_WARN_MAX            5000.0f

// Fake pressure range (PSI) for solenoid_valves node testing
#define FAKE_PRESSURE_MIN       100
#define FAKE_PRESSURE_MAX       200

#endif // CONFIG_H