#include "valve_control.h"
#include "config.h"

// Pin lookup table — index matches SV1..SV6 constants
static const uint8_t SV_PINS[VALVE_COUNT] = {
    SV1_PIN, SV2_PIN, SV3_PIN, SV4_PIN, SV5_PIN, SV6_PIN
};

// Runtime state of each valve
static bool svState[VALVE_COUNT] = { false };

void valveControlInit() {
    for (uint8_t i = 0; i < VALVE_COUNT; i++) {
        pinMode(SV_PINS[i], OUTPUT);
        digitalWrite(SV_PINS[i], LOW);  // Start closed
        svState[i] = false;
    }
    Serial.println("[VALVE] All 6 solenoid valves initialized and closed");
}

void openSV(uint8_t sv) {
    if (sv >= VALVE_COUNT) return;
    digitalWrite(SV_PINS[sv], HIGH);
    svState[sv] = true;
    Serial.printf("[VALVE] SV%d OPEN\n", sv + 1);
}

void closeSV(uint8_t sv) {
    if (sv >= VALVE_COUNT) return;
    digitalWrite(SV_PINS[sv], LOW);
    svState[sv] = false;
    Serial.printf("[VALVE] SV%d CLOSE\n", sv + 1);
}

void closeAllSV() {
    for (uint8_t i = 0; i < VALVE_COUNT; i++) {
        digitalWrite(SV_PINS[i], LOW);
        svState[i] = false;
    }
    Serial.println("[VALVE] All SVs closed");
}

bool getSVState(uint8_t sv) {
    if (sv >= VALVE_COUNT) return false;
    return svState[sv];
}
