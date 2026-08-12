#pragma once
#include <Arduino.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

extern WiFiClient   espClient;
extern PubSubClient mqtt;

// Called when an MQTT message is received (valve commands, reset, etc.)
inline void onMessage(char* topic, byte* payload, unsigned int length) {
    String msg;
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    Serial.printf("[MQTT] Received on %s: %s\n", topic, msg.c_str());
    // TODO: parse msg for "reset" command → call FSM_init() to recover from FAULT
}

// Connect (or reconnect) to MQTT broker
inline void connectMQTT() {
    while (!mqtt.connected()) {
        Serial.printf("[MQTT] Connecting to %s ...", MQTT_BROKER);
        if (mqtt.connect(NODE_ID)) {
            Serial.println(" connected!");
            mqtt.subscribe(TOPIC_CMD);  // Listen for valve/reset commands
            mqtt.publish(TOPIC_STATUS, "online", true);
        } else {
            Serial.printf(" failed (rc=%d), retrying in 5s\n", mqtt.state());
            delay(5000);
        }
    }
}

// Call every loop() — reconnects if dropped
inline void maintainMQTT() {
    if (!mqtt.connected()) {
        connectMQTT();
    }
    mqtt.loop();
}

// Publish all 9 sensor fields for inlet or outlet nodes
inline void publishSensorData(
    const char* nodeId,
    float co2, float no2, float so2, float ph,
    float temp, float hum, float pm25, float flow, float level
) {
    JsonDocument doc;
    doc["node_id"]     = nodeId;
    doc["co2"]         = co2;
    doc["no2"]         = no2;
    doc["so2"]         = so2;
    doc["ph"]          = ph;
    doc["temperature"] = temp;
    doc["humidity"]    = hum;
    doc["pm25"]        = pm25;
    doc["flow_rate"]   = flow;
    doc["level"]       = level;
    doc["timestamp"]   = millis();

    char buf[MQTT_BUFFER_SIZE];
    serializeJson(doc, buf);

    if (mqtt.publish(TOPIC_DATA, buf)) {
        Serial.printf("[MQTT] Published to %s: %s\n", TOPIC_DATA, buf);
    } else {
        Serial.println("[MQTT] Publish FAILED");
    }
}

// Publish valve states (solenoid_valves node only)
inline void publishValveData(
    const char** valveIds,
    const char** valveLabels,
    const bool* valveOpen,
    uint8_t count
) {
    JsonDocument doc;
    doc["node_id"] = NODE_ID;
    JsonArray valves = doc["valves"].to<JsonArray>();
    for (uint8_t i = 0; i < count; i++) {
        JsonObject v = valves.add<JsonObject>();
        v["id"]    = valveIds[i];
        v["label"] = valveLabels[i];
        v["open"]  = valveOpen[i];
    }
    doc["timestamp"] = millis();

    char buf[MQTT_BUFFER_SIZE];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_DATA, buf);
    Serial.printf("[MQTT] Published valve states to %s\n", TOPIC_DATA);
}
