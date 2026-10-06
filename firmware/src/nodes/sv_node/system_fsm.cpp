#include "system_fsm.h"
#include "app_state.h"
#include "valve_control.h"
#include "vacuum_control.h"
#include "pressure.h"
#include "config.h"
#include <Arduino.h>

// ─────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────
static SystemState currentState = STATE_INIT;
static unsigned long stateStartMs  = 0;
static bool firstTick = true;

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
static void transitionTo(SystemState next) {
    Serial.printf("[FSM] %d → %d\n", (int)currentState, (int)next);
    currentState  = next;
    stateStartMs  = millis();
    firstTick     = true;
}

static unsigned long elapsed() {
    return millis() - stateStartMs;
}

// ─────────────────────────────────────────
// Public API
// ─────────────────────────────────────────
void FSM_init() {
    transitionTo(STATE_INIT);
}

void FSM_run() {
    switch (currentState) {

        // ── STATE 0: INIT ─────────────────────────
        // Runs ONCE on power-on only.
        // Puts hardware into a known-safe state before the first cycle.
        case STATE_INIT:
            closeAllSV();
            stopAllVacuums();
            Serial.println("[FSM] INIT complete → PRESSURIZE");
            transitionTo(STATE_PRESSURIZE);
            break;

        // ── STATE 1: PRESSURIZE ───────────────────
        // Close all valves, start Vacuum(1) to build tank pressure.
        case STATE_PRESSURIZE:
            if (firstTick) {
                closeAllSV();
                setVacuum(VACUUM_1, VACUUM_ON);
                Serial.println("[FSM] PRESSURIZE: Vacuum(1) ON, all SVs closed");
                firstTick = false;
            }
            // Immediately read inlet and begin pressure check
            transitionTo(STATE_READ_INLET);
            break;

        // ── STATE 2: READ INLET ───────────────────
        // Read Node 1 sensors and publish via MQTT.
        // (Publish is handled by the main loop for sensor nodes;
        //  the FSM node can call publishSensorData() here if needed.)
        case STATE_READ_INLET:
            Serial.println("[FSM] READ_INLET: Inlet sensors read → publish");
            // TODO: call publishSensorData("inlet") here if FSM node also reads sensors
            transitionTo(STATE_CHECK_PRESSURE);
            break;

        // ── STATE 3: CHECK PRESSURE ───────────────
        // Wait until tank O1 reaches >= 150 PSI.
        // Timeout after 10 minutes → FAULT.
        case STATE_CHECK_PRESSURE:
            if (isPressureReady(SENSOR_O1)) {
                Serial.printf("[FSM] O1 pressure ready (%.1f PSI) → ADSORB\n",
                              readPressure(SENSOR_O1));
                transitionTo(STATE_ADSORB);
            } else if (elapsed() >= PRESSURE_TIMEOUT_MS) {
                Serial.println("[FSM] FAULT: O1 pressure timeout (10 min)");
                transitionTo(STATE_FAULT);
            }
            // else: keep waiting — do nothing this tick
            break;

        // ── STATE 4: ADSORB (1-MIN CYCLE) ─────────
        // Open outlet path, start Vacuum(2) and Vacuum(3).
        // CO2 flows from inlet column through to outlet.
        case STATE_ADSORB:
            if (firstTick) {
                openSV(SV3);                   // Outlet path open
                closeSV(SV4);                  // Center inlet closed
                closeSV(SV6);                  // Purge right closed
                setVacuum(VACUUM_2, VACUUM_ON); // Left column
                setVacuum(VACUUM_3, VACUUM_ON); // Right column
                Serial.println("[FSM] ADSORB: 1-MIN cycle started");
                firstTick = false;
            }
            if (elapsed() >= ADSORB_DURATION_MS) {
                Serial.println("[FSM] ADSORB complete → READ_OUTLET");
                transitionTo(STATE_READ_OUTLET);
            }
            break;

        // ── STATE 5: READ OUTLET ──────────────────
        // Read Node 2 sensors and publish via MQTT.
        case STATE_READ_OUTLET:
            Serial.println("[FSM] READ_OUTLET: Outlet sensors read → publish");
            // TODO: call publishSensorData("outlet") here if needed
            transitionTo(STATE_CLEAN);
            break;

        // ── STATE 6: CLEAN (2-MIN CYCLE) ──────────
        // Close outlet path, open purge valve (SV6) for open-air flush.
        // Resets column for next adsorption cycle.
        case STATE_CLEAN:
            if (firstTick) {
                closeSV(SV3);                   // Outlet path closed
                closeSV(SV2);                   // Inlet B closed
                openSV(SV6);                    // Open air purge
                setVacuum(VACUUM_2, VACUUM_ON);  // Keep running for purge
                setVacuum(VACUUM_3, VACUUM_ON);
                Serial.println("[FSM] CLEAN: 2-MIN purge cycle started");
                firstTick = false;
            }
            if (elapsed() >= CLEAN_DURATION_MS) {
                Serial.println("[FSM] CLEAN complete → CYCLE_COMPLETE");
                transitionTo(STATE_CYCLE_COMPLETE);
            }
            break;

        // ── STATE 7: CYCLE COMPLETE ───────────────
        // E connector: SKIP INIT, go directly back to PRESSURIZE.
        case STATE_CYCLE_COMPLETE:
            closeSV(SV3);
            closeSV(SV6);
            setVacuum(VACUUM_2, VACUUM_OFF);
            setVacuum(VACUUM_3, VACUUM_OFF);
            Serial.println("[FSM] CYCLE_COMPLETE → PRESSURIZE (E: skip INIT)");
            transitionTo(STATE_PRESSURIZE);  // ← E connector behavior
            break;

        // ── STATE 8: FAULT ────────────────────────
        // All actuators off. Stay here until MQTT reset command or hardware button.
        case STATE_FAULT:
            if (firstTick) {
                closeAllSV();
                stopAllVacuums();
                Serial.println("[FSM] FAULT: All actuators OFF. Manual reset required.");
                firstTick = false;
            }
            // Stay in this state — operator must send MQTT "reset" command
            break;
    }
}
