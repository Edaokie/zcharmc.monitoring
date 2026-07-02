#include "SensorManager.h"
#include <Arduino.h>

void SensorManager::begin() {
    // Initialize I2C, UART, ADC, or sensor-specific drivers here.
}

SensorReading SensorManager::readAll() {
    SensorReading reading{};

    reading.co2_ppm = readCO2();
    reading.pm25_ugm3 = readPM25();
    reading.so2_ppm = readSO2();
    reading.no2_ppm = readNO2();
    reading.temperature_c = readTemperature();
    reading.humidity_rh = readHumidity();
    reading.pressure_kpa = readPressure();

    reading.co2_valid = isValid(reading.co2_ppm, 0.0f, 10000.0f);
    reading.pm25_valid = isValid(reading.pm25_ugm3, 0.0f, 1000.0f);
    reading.so2_valid = isValid(reading.so2_ppm, 0.0f, 20.0f);
    reading.no2_valid = isValid(reading.no2_ppm, 0.0f, 20.0f);
    reading.temperature_valid = isValid(reading.temperature_c, -40.0f, 85.0f);
    reading.humidity_valid = isValid(reading.humidity_rh, 0.0f, 100.0f);
    reading.pressure_valid = isValid(reading.pressure_kpa, 0.0f, 1000.0f);

    return reading;
}

bool SensorManager::isValid(float value, float minValue, float maxValue) {
    return !isnan(value) && value >= minValue && value <= maxValue;
}

float SensorManager::readCO2() {
    return NAN;
}

float SensorManager::readPM25() {
    return NAN;
}

float SensorManager::readSO2() {
    return NAN;
}

float SensorManager::readNO2() {
    return NAN;
}

float SensorManager::readTemperature() {
    return NAN;
}

float SensorManager::readHumidity() {
    return NAN;
}

float SensorManager::readPressure() {
    return NAN;
}