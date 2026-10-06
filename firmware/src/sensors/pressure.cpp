#include "pressure.h"
#include "config.h"

static const uint8_t PRESSURE_PINS[2] = { O1_PIN, O2_PIN };

void pressureInit() {
    // GPIO 34 and 35 are input-only on ESP32 — no pinMode needed
    // but analogReadResolution can be set here
    analogReadResolution(12);  // 0–4095 range
    Serial.println("[PRESSURE] Pressure sensors initialized (O1, O2)");
}

float readPressure(uint8_t sensorId) {
    if (sensorId >= 2) return 0.0f;

    // FAKE: random value between FAKE_PRESSURE_MIN and FAKE_PRESSURE_MAX
    // REAL: map analogRead (0–4095) to PSI using your sensor's datasheet formula
    //   Example formula: float psi = (analogRead(pin) / 4095.0f) * MAX_PSI;
    return (float)random(FAKE_PRESSURE_MIN, FAKE_PRESSURE_MAX);
}

bool isPressureReady(uint8_t sensorId) {
    return readPressure(sensorId) >= PRESSURE_THRESHOLD_PSI;
}
