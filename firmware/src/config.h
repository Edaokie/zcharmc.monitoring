
#ifndef CONFIG_H
#define CONFIG_H

// Serial
#define SERIAL_BAUD_RATE        115200

// Device identity
#define FIRMWARE_VERSION        "1.0.0"
#define NODE_ID                 "node1"   // change to node2, node3 for other units

// WiFi credentials
#define WIFI_SSID     "MSCA"
#define WIFI_PASSWORD "@MSCA_2k26!"

// MQTT Broker — Mosquitto on Raspberry Pi
#define MQTT_BROKER             "10.10.79.142"
#define MQTT_PORT               1883

// MQTT Topics
#define TOPIC_CO2               "co2monitor/" NODE_ID "/data"
#define TOPIC_STATUS            "co2monitor/" NODE_ID "/status"

// Timing
#define SENSOR_READ_INTERVAL    5000   // read every 5 seconds
#define MQTT_PUBLISH_INTERVAL   5000   // publish every 5 seconds

// CO2 thresholds (ppm)
#define CO2_SAFE_THRESHOLD      800.0
#define CO2_HIGH_THRESHOLD      1200.0

// WiFi
#define WIFI_MAX_RETRY          20

#endif