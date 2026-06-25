// #include <Arduino.h>

// #define LED 2

// void setup() {
//   // put your setup code here, to run once:
//   Serial.begin(115200);
//   pinMode(LED, OUTPUT);
// }

// void loop() {
//   // put your main code here, to run repeatedly:
//   digitalWrite(LED, HIGH);
//   Serial.println("LED is on");
//   delay(1000);
//   digitalWrite(LED, LOW);
//   Serial.println("LED is off");
//   delay(1000);
// }

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "secrets.h"
#include "config.h"

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ─── WiFi ───────────────────────────────────────────
void connectWiFi() {
  Serial.printf("\nConnecting to WiFi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < WIFI_MAX_RETRY) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi failed! Check credentials.");
  }
}

// ─── MQTT ───────────────────────────────────────────
void connectMQTT() {
  mqttClient.setServer(TB_HOST, TB_PORT);
  while (!mqttClient.connected()) {
    Serial.print("Connecting to ThingsBoard...");
    if (mqttClient.connect(DEVICE_ID, TB_ACCESS_TOKEN, NULL)) {
      Serial.println(" connected!");
    } else {
      Serial.printf(" failed (rc=%d), retrying in 3s\n", mqttClient.state());
      delay(3000);
    }
  }
}

// ─── Send Fake Sensor Data ──────────────────────────
void sendTelemetry() {
  StaticJsonDocument<256> doc;

  // Fake values — replace with real sensor reads later
  doc["co2"]         = random(400, 1200);
  doc["ph"]          = random(60, 85) / 10.0;
  doc["humidity"]    = random(40, 90);
  doc["temperature"] = random(200, 350) / 10.0;
  doc["pm25"]        = random(0, 150);

  char buffer[256];
  serializeJson(doc, buffer);

  if (mqttClient.publish("v1/devices/me/telemetry", buffer)) {
    Serial.printf("Sent: %s\n", buffer);
  } else {
    Serial.println("Publish failed!");
  }
}

// ─── Setup ──────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  connectWiFi();
  connectMQTT();
}

// ─── Loop ───────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();

  sendTelemetry();
  delay(MQTT_PUBLISH_INTERVAL);
}