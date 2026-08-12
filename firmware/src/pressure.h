#pragma once
#include <Arduino.h>

// Pressure sensor reading — O1 (left tank) and O2 (right tank)
#define SENSOR_O1  0   // Left tank — gates LEFT COLUMN cycle
#define SENSOR_O2  1   // Right tank — gates RIGHT COLUMN cycle

void pressureInit();
float readPressure(uint8_t sensorId);  // Returns PSI
bool isPressureReady(uint8_t sensorId); // Returns true if >= PRESSURE_THRESHOLD_PSI
