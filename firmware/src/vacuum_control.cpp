#include "vacuum_control.h"
#include "config.h"

static const uint8_t VACUUM_PINS[3] = { VACUUM1_PIN, VACUUM2_PIN, VACUUM3_PIN };
static bool vacuumState[3] = { false };

void vacuumControlInit() {
    for (uint8_t i = 0; i < 3; i++) {
        pinMode(VACUUM_PINS[i], OUTPUT);
        digitalWrite(VACUUM_PINS[i], LOW);
        vacuumState[i] = false;
    }
    Serial.println("[VACUUM] All 3 vacuum pumps initialized and OFF");
}

void setVacuum(uint8_t vacuumId, bool on) {
    if (vacuumId >= 3) return;
    digitalWrite(VACUUM_PINS[vacuumId], on ? HIGH : LOW);
    vacuumState[vacuumId] = on;
    Serial.printf("[VACUUM] Vacuum(%d) %s\n", vacuumId + 1, on ? "ON" : "OFF");
}

bool getVacuumState(uint8_t vacuumId) {
    if (vacuumId >= 3) return false;
    return vacuumState[vacuumId];
}

void stopAllVacuums() {
    for (uint8_t i = 0; i < 3; i++) {
        digitalWrite(VACUUM_PINS[i], LOW);
        vacuumState[i] = false;
    }
    Serial.println("[VACUUM] All vacuum pumps OFF");
}
