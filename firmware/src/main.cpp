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
#include "config.h"

// ─── Uncomment this when real sensor is wired up ───
// #include <Wire.h>
// #include <SensirionI2CScd4x.h>
// SensirionI2CScd4x scd4x;

WiFiClient   espClient;
PubSubClient mqtt(espClient);

unsigned long lastPublish = 0;
const long    publishInterval = 5000; // publish every 5 seconds

// ─────────────────────────────────────────────
// WiFi
// ─────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("\n[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\n[WiFi] Connected! IP: %s\n",
                WiFi.localIP().toString().c_str());
}

// ─────────────────────────────────────────────
// MQTT
// ─────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting to broker %s ...", MQTT_BROKER);

    if (mqtt.connect(NODE_ID)) {
      Serial.println(" connected!");
      // publish online status
      mqtt.publish(TOPIC_STATUS, "online", true);
    } else {
      Serial.printf(" failed (rc=%d), retrying in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

// ─────────────────────────────────────────────
// Fake CO2 reading (swap out for real sensor)
// ─────────────────────────────────────────────
float readCO2() {
  // FAKE: random value between 400 and 1800 ppm
  return random(400, 1800);

  // REAL SCD40 (uncomment when sensor is wired):
  // uint16_t co2Raw; float temp, hum;
  // scd4x.readMeasurement(co2Raw, temp, hum);
  // return (float)co2Raw;
}

float readTemperature() {
  return random(20, 35); // fake °C
  // real: return temp; (from scd4x above)
}

float readHumidity() {
  return random(40, 80); // fake %
  // real: return hum;
}

// ─────────────────────────────────────────────
// Build and publish JSON payload
// ─────────────────────────────────────────────
void publishData() {
  StaticJsonDocument<200> doc;

  doc["node_id"]     = NODE_ID;
  doc["co2"]         = readCO2();
  doc["temperature"] = readTemperature();
  doc["humidity"]    = readHumidity();
  doc["timestamp"]   = millis();

  char payload[200];
  serializeJson(doc, payload);

  if (mqtt.publish(TOPIC_CO2, payload)) {
    Serial.printf("[MQTT] Published to %s: %s\n", TOPIC_CO2, payload);
  } else {
    Serial.println("[MQTT] Publish failed!");
  }
}

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=== CO2 Monitor Node ===");
  Serial.printf("Node ID: %s\n", NODE_ID);

  connectWiFi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  connectMQTT();

  // ── Real sensor init (uncomment when ready) ──
  // Wire.begin();
  // scd4x.begin(Wire);
  // scd4x.startPeriodicMeasurement();
  // delay(5000); // SCD40 needs 5s to warm up
}

// ─────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────
void loop() {
  // reconnect if dropped
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  // publish on interval
  unsigned long now = millis();
  if (now - lastPublish >= publishInterval) {
    lastPublish = now;
    publishData();
  }
}

// #include <Arduino.h>
// #include <WiFi.h>

// void setup() {
//   Serial.begin(115200);
//   delay(1000);

//   Serial.println("\n=== WiFi Network Scanner ===");
//   WiFi.mode(WIFI_STA);
//   WiFi.disconnect();
//   delay(100);

//   int n = WiFi.scanNetworks();
//   Serial.printf("Found %d networks:\n", n);

//   for (int i = 0; i < n; i++) {
//     Serial.printf("%d: %-25s | Ch: %2d | RSSI: %d dBm | %s\n",
//                   i + 1,
//                   WiFi.SSID(i).c_str(),
//                   WiFi.channel(i),
//                   WiFi.RSSI(i),
//                   WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "Open" : "Secured");
//   }
// }

// void loop() {}

