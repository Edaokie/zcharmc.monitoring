#pragma once

#include <Arduino.h>
#include "payload.h"

class TelemetryPayload {
public:
    static bool buildJson(
        const SensorReading& reading,
        const DeviceStatus& status,
        char* output,
        size_t outputSize
    );
};