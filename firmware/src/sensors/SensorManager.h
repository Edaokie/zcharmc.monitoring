#pragma once

#include "payload.h"

class SensorManager {
public:
    void begin();
    SensorReading readAll();

private:
    float readCO2();
    float readPM25();
    float readSO2();
    float readNO2();
    float readTemperature();
    float readHumidity();
    float readPressure();

    bool isValid(float value, float minValue, float maxValue);
};