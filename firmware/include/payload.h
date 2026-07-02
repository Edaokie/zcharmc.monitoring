#pragma once

#include <Arduino.h>

struct SensorReading {
    float co2_ppm;
    float pm25_ugm3;
    float so2_ppm;
    float no2_ppm;
    float temperature_c;
    float humidity_rh;
    float pressure_kpa;

    bool co2_valid;
    bool pm25_valid;
    bool so2_valid;
    bool no2_valid;
    bool temperature_valid;
    bool humidity_valid;
    bool pressure_valid;
};

struct DeviceStatus {
    const char* device_id;
    const char* firmware_version;
    long wifi_rssi;
    uint32_t uptime_s;
    uint32_t free_heap;
};