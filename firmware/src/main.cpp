#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

// ─────────────────────────────────────────
// MQTT + WiFi clients
// ─────────────────────────────────────────
WiFiClient   espClient;
PubSubClient mqtt(espClient);

unsigned long lastPublish = 0;

// ─────────────────────────────────────────
// Valve states (only used by solenoid_valves node)
// ─────────────────────────────────────────
bool valveStates[VALVE_COUNT] = { true, false, true, false };
const char* valveIds[VALVE_COUNT] = { "v1a", "v1b", "v2a", "v2b" };
const char* valveLabels[VALVE_COUNT] = {
  "Inlet valve A",
  "Inlet valve B",
  "Outlet valve A",
  "Outlet valve B"
};

// ─────────────────────────────────────────
// WiFi
// ─────────────────────────────────────────
void connectWiFi() {
  Serial.printf("\n[WiFi] Connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < WIFI_MAX_RETRY) {
    delay(500);
    retry++;
    Serial.printf("Attempt %d - Status: %d\n", retry, WiFi.status());
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] FAILED — restarting in 5s");
    delay(5000);
    ESP.restart();
  }
}

// ─────────────────────────────────────────
// MQTT
// ─────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting to %s ...", MQTT_BROKER);
    if (mqtt.connect(NODE_ID)) {
      Serial.println(" connected!");
      mqtt.publish(TOPIC_STATUS, "online", true);
    } else {
      Serial.printf(" failed (rc=%d), retrying in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

// ─────────────────────────────────────────
// Fake sensor readings
// Replace each function body with real
// sensor reads when hardware is connected
// ─────────────────────────────────────────
float readCO2() {
  return random(FAKE_CO2_MIN, FAKE_CO2_MAX);
  // REAL SCD40:
  // uint16_t co2Raw; float t, h;
  // scd4x.readMeasurement(co2Raw, t, h);
  // return (float)co2Raw;
}

float readNO2() {
  return random(FAKE_NO2_MIN, FAKE_NO2_MAX);
  // REAL: return mics6814.readNO2();
}

float readSO2() {
  return random(FAKE_SO2_MIN, FAKE_SO2_MAX);
  // REAL: return mics6814.readSO2();
}

float readPH() {
  // divide by 10 to get float pH (e.g. 65 → 6.5)
  float raw = random(FAKE_PH_MIN_X10, FAKE_PH_MAX_X10);
  return raw / 10.0;
  // REAL: return analogRead(PH_PIN) * (14.0 / 4095.0);
}

float readTemperature() {
  return random(FAKE_TEMP_MIN, FAKE_TEMP_MAX);
  // REAL SCD40: return temp;
}

float readHumidity() {
  return random(FAKE_HUM_MIN, FAKE_HUM_MAX);
  // REAL SCD40: return hum;
}

float readPM25() {
  return random(FAKE_PM25_MIN, FAKE_PM25_MAX);
  // REAL PMS5003: return pms.pm25;
}

float readFlowRate() {
  // divide by 10 to get float (e.g. 18 → 1.8 L/min)
  float raw = random(FAKE_FLOW_MIN_X10, FAKE_FLOW_MAX_X10);
  return raw / 10.0;
  // REAL: return pulseCount / calibrationFactor;
}

float readLiquidLevel() {
  return random(FAKE_LEVEL_MIN, FAKE_LEVEL_MAX);
  // REAL: return (analogRead(LEVEL_PIN) / 4095.0) * 100.0;
}

// ─────────────────────────────────────────
// Build and publish sensor payload
// Called for inlet and outlet nodes
// ─────────────────────────────────────────
void publishSensorData() {
  JsonDocument doc;

  doc["node_id"]     = NODE_ID;
  doc["co2"]         = readCO2();
  doc["no2"]         = readNO2();
  doc["so2"]         = readSO2();
  doc["ph"]          = readPH();
  doc["temperature"] = readTemperature();
  doc["humidity"]    = readHumidity();
  doc["pm25"]        = readPM25();
  doc["flow_rate"]   = readFlowRate();
  doc["level"]       = readLiquidLevel();
  doc["timestamp"]   = millis();

  char payload[512];
  serializeJson(doc, payload);

  if (mqtt.publish(TOPIC_DATA, payload)) {
    Serial.printf("[MQTT] Published to %s:\n  %s\n", TOPIC_DATA, payload);
  } else {
    Serial.println("[MQTT] Publish FAILED");
  }
}

// ─────────────────────────────────────────
// Build and publish valve payload
// Called for solenoid_valves node only
// ─────────────────────────────────────────
void publishValveData() {
  JsonDocument doc;
  doc["node_id"] = NODE_ID;

  JsonArray valves = doc["valves"].to<JsonArray>();
  for (int i = 0; i < VALVE_COUNT; i++) {
    JsonObject v = valves.add<JsonObject>();
    v["id"]    = valveIds[i];
    v["label"] = valveLabels[i];
    v["open"]  = valveStates[i];
  }

  doc["timestamp"] = millis();

  char payload[512];
  serializeJson(doc, payload);

  if (mqtt.publish(TOPIC_DATA, payload)) {
    Serial.printf("[MQTT] Published valves to %s:\n  %s\n", TOPIC_DATA, payload);
  } else {
    Serial.println("[MQTT] Valve publish FAILED");
  }
}

// ─────────────────────────────────────────
// MQTT message handler
// (for future: receive valve commands)
// ─────────────────────────────────────────
void onMessage(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[MQTT] Received on %s: %s\n", topic, msg.c_str());
}

// ─────────────────────────────────────────
// Setup
// ─────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(1000);

  Serial.println("\n================================");
  Serial.printf("  CO2 Monitor — %s\n", NODE_ID);
  Serial.printf("  Firmware v%s\n", FIRMWARE_VERSION);
  Serial.println("================================\n");

  connectWiFi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  connectMQTT();
}

// ─────────────────────────────────────────
// Loop
// ─────────────────────────────────────────
void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;

    // solenoid_valves node sends valve states
    // inlet and outlet nodes send sensor readings
    String nodeId = String(NODE_ID);
    if (nodeId == "solenoid_valves") {
      publishValveData();
    } else {
      publishSensorData();
    }
  }
}