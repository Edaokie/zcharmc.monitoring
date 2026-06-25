// #ifndef CONFIG_H
// #define CONFIG_H

// // Serial configuration
// constexpr unsigned long SERIAL_BAUD_RATE = 115200;

// // Device identity
// constexpr const char* DEVICE_ID = "ESP32_NODE_001";
// constexpr const char* FIRMWARE_VERSION = "1.0.0";

// // Timing intervals
// constexpr unsigned long SENSOR_READ_INTERVAL_MS = 5000;
// constexpr unsigned long MQTT_PUBLISH_INTERVAL_MS = 10000;
// constexpr unsigned long DISPLAY_UPDATE_INTERVAL_MS = 1000;
// constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;

// // Sensor calibration
// constexpr float SOIL_MOISTURE_DRY_VALUE = 3200.0;
// constexpr float SOIL_MOISTURE_WET_VALUE = 1200.0;

// // Thresholds
// constexpr float TEMPERATURE_HIGH_THRESHOLD_C = 35.0;
// constexpr float HUMIDITY_LOW_THRESHOLD_PERCENT = 40.0;
// constexpr float SOIL_MOISTURE_LOW_THRESHOLD_PERCENT = 30.0;

// // MQTT configuration
// constexpr const char* MQTT_SERVER = "192.168.1.10";
// constexpr int MQTT_PORT = 1883;
// constexpr const char* MQTT_CLIENT_ID = "ESP32_NODE_001";

// constexpr const char* MQTT_TOPIC_SENSOR = "esp32/node001/sensors";
// constexpr const char* MQTT_TOPIC_STATUS = "esp32/node001/status";
// constexpr const char* MQTT_TOPIC_COMMAND = "esp32/node001/command";

// // System behavior
// constexpr int MAX_WIFI_RETRY = 10;
// constexpr int MAX_MQTT_RETRY = 5;
// constexpr bool ENABLE_DEBUG_LOGS = true;

// #endif
#ifndef CONFIG_H
#define CONFIG_H

// Serial
#define SERIAL_BAUD_RATE        115200

// Device identity
#define DEVICE_ID               "ESP32-Test-Node"
#define FIRMWARE_VERSION        "1.0.0"

// ThingsBoard MQTT
#define TB_HOST                 "10.10.79.142"
#define TB_PORT                 1883

// Timing
#define SENSOR_READ_INTERVAL    5000   // read every 5 seconds
#define MQTT_PUBLISH_INTERVAL   5000   // publish every 5 seconds

// Fake sensor thresholds (for testing)
#define CO2_HIGH_THRESHOLD      1000.0  // ppm
#define PH_LOW_THRESHOLD        6.0
#define PH_HIGH_THRESHOLD       8.5
#define HUMIDITY_LOW_THRESHOLD  40.0

// WiFi
#define WIFI_MAX_RETRY          20

#endif