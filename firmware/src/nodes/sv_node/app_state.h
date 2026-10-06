#pragma once
#include <stdint.h>

// SystemState — maps 1:1 to the flowchart phases
// Used only by the solenoid_valves node FSM.
enum SystemState : uint8_t {
    STATE_INIT           = 0,  // Power-on: one-time setup. Never runs again after boot.
    STATE_PRESSURIZE     = 1,  // Close all SVs, Vacuum(1) ON, build pressure
    STATE_READ_INLET     = 2,  // Read Node 1 sensors, publish via MQTT
    STATE_CHECK_PRESSURE = 3,  // Wait for O1 >= 150 PSI (10-min timeout → FAULT)
    STATE_ADSORB         = 4,  // 1-MIN cycle: CO2 flows inlet → outlet column
    STATE_READ_OUTLET    = 5,  // Read Node 2 sensors, publish via MQTT
    STATE_CLEAN          = 6,  // 2-MIN cycle: flush residual CO2 via open-air purge
    STATE_CYCLE_COMPLETE = 7,  // Transition back to PRESSURIZE (E connector: skip INIT)
    STATE_FAULT          = 8,  // All off, alarm triggered, wait for manual reset
};
