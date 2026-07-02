#include "TelemetryPayload.h"
#include <ArduinoJson.h>

bool TelemetryPayload::buildJson(
    const SensorReading& reading,
    const DeviceStatus& status,
    char* output,
    size_t outputSize
) {
    JsonDocument doc;

    doc["device_id"] = status.device_id;
    doc["fw_version"] = status.firmware_version;
    doc["timestamp_ms"] = millis();

    JsonObject sensors = doc["sensors"].to<JsonObject>();
    sensors["co2_ppm"] = reading.co2_ppm;
    sensors["pm25_ugm3"] = reading.pm25_ugm3;
    sensors["so2_ppm"] = reading.so2_ppm;
    sensors["no2_ppm"] = reading.no2_ppm;
    sensors["temperature_c"] = reading.temperature_c;
    sensors["humidity_rh"] = reading.humidity_rh;
    sensors["pressure_kpa"] = reading.pressure_kpa;

    JsonObject valid = doc["valid"].to<JsonObject>();
    valid["co2"] = reading.co2_valid;
    valid["pm25"] = reading.pm25_valid;
    valid["so2"] = reading.so2_valid;
    valid["no2"] = reading.no2_valid;
    valid["temperature"] = reading.temperature_valid;
    valid["humidity"] = reading.humidity_valid;
    valid["pressure"] = reading.pressure_valid;

    JsonObject system = doc["status"].to<JsonObject>();
    system["wifi_rssi"] = status.wifi_rssi;
    system["uptime_s"] = status.uptime_s;
    system["free_heap"] = status.free_heap;

    size_t bytesWritten = serializeJson(doc, output, outputSize);

    return bytesWritten > 0 && bytesWritten < outputSize;
}