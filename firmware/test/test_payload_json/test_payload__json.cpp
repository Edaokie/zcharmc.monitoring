#include <unity.h>
#include "payload.h"
#include "payload/TelemetryPayload.h"

void test_telemetry_json_builds_successfully() {
    SensorReading reading{};
    reading.co2_ppm = 420.0f;
    reading.pm25_ugm3 = 12.5f;
    reading.so2_ppm = 0.01f;
    reading.no2_ppm = 0.02f;
    reading.temperature_c = 30.2f;
    reading.humidity_rh = 70.0f;
    reading.pressure_kpa = 101.3f;

    reading.co2_valid = true;
    reading.pm25_valid = true;
    reading.so2_valid = true;
    reading.no2_valid = true;
    reading.temperature_valid = true;
    reading.humidity_valid = true;
    reading.pressure_valid = true;

    DeviceStatus status{};
    status.device_id = "zcharmc-node-001";
    status.firmware_version = "0.1.0";
    status.wifi_rssi = -60;
    status.uptime_s = 10;
    status.free_heap = 100000;

    char buffer[1024];

    bool result = TelemetryPayload::buildJson(
        reading,
        status,
        buffer,
        sizeof(buffer)
    );

    TEST_ASSERT_TRUE(result);
    TEST_ASSERT_NOT_NULL(strstr(buffer, "zcharmc-node-001"));
    TEST_ASSERT_NOT_NULL(strstr(buffer, "co2_ppm"));
    TEST_ASSERT_NOT_NULL(strstr(buffer, "pm25_ugm3"));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_telemetry_json_builds_successfully);
    return UNITY_END();
}