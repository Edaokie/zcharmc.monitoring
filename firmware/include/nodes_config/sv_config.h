#pragma once
// ─────────────────────────────────────────────────────────────
// Solenoid-valve node ONLY. Sensor nodes (inlet/outlet) never
// include this file, so they never see valve pins or FSM timing.
// ─────────────────────────────────────────────────────────────

// ── FSM cycle timing ──────────────────────────────────────────
#define ADSORB_DURATION_MS      60000UL    // 1-min adsorption cycle
#define CLEAN_DURATION_MS       120000UL   // 2-min cleaning/purge cycle
#define PRESSURE_TIMEOUT_MS     600000UL   // 10-min max wait for pressure

// ── Pressure ──────────────────────────────────────────────────
#define PRESSURE_THRESHOLD_PSI  150.0f
#define FAKE_PRESSURE_MIN       100        // fake range for testing (PSI)
#define FAKE_PRESSURE_MAX       200

// ── GPIO pins — ESP32 DevKit ──────────────────────────────────
// !! UPDATE THESE TO MATCH YOUR ACTUAL WIRING !!

// Solenoid valves (relay module — active HIGH)
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

// Pressure sensors (analog input — 12-bit ADC, input-only GPIOs)
#define O1_PIN                  34   // Left tank
#define O2_PIN                  35   // Right tank
