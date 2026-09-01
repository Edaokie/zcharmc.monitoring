#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"
#include "comms/wifi_manager.h"
#include "comms/mqtt_manager.h"
#include "system_fsm.h"
#include "valve_control.h"
#include "vacuum_control.h"
#include "pressure.h"

// ─────────────────────────────────────────
// Global MQTT clients — used by mqtt_manager.h
// ─────────────────────────────────────────
WiFiClient   espClient;
PubSubClient mqtt(espClient);

// ─────────────────────────────────────────
// Publish timer (for inlet / outlet nodes)
// ─────────────────────────────────────────
static unsigned long lastPublish = 0;

// ─────────────────────────────────────────
// Valve metadata (solenoid_valves node only)
// ─────────────────────────────────────────
static const char* valveIds[VALVE_COUNT]    = { "sv1","sv2","sv3","sv4","sv5","sv6" };
static const char* valveLabels[VALVE_COUNT] = {
    "Inlet A", "Inlet B", "Outlet Path",
    "Center Inlet", "Purge Left", "Purge Right"
};
static bool valveOpen[VALVE_COUNT] = { false };

// ─────────────────────────────────────────
// Setup — runs once on boot
// ─────────────────────────────────────────
void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    delay(1000);

    Serial.println("\n================================");
    Serial.printf("  ZCharMC Monitor — %s\n",  NODE_ID);
    Serial.printf("  Firmware v%s (%s)\n",      FW_VERSION, FW_ENV);
    Serial.println("================================\n");

    connectWiFi();

    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    mqtt.setCallback(onMessage);
    mqtt.setBufferSize(MQTT_BUFFER_SIZE);
    connectMQTT();

    // solenoid_valves node initializes hardware and starts FSM
    String nodeId = String(NODE_ID);
    if (nodeId == "solenoid_valves") {
        valveControlInit();
        vacuumControlInit();
        pressureInit();
        FSM_init();   // Enter STATE_INIT → STATE_PRESSURIZE
    }
}

// ─────────────────────────────────────────
// Loop — runs continuously
// ─────────────────────────────────────────
void loop() {
    maintainMQTT();  // Reconnects if dropped + calls mqtt.loop()

    String nodeId = String(NODE_ID);

    if (nodeId == "solenoid_valves") {
        // Run the state machine — controls valves, vacuums, adsorption cycle
        FSM_run();

        // Also publish current valve states every PUBLISH_INTERVAL_MS
        unsigned long now = millis();
        if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
            lastPublish = now;
            // Update valveOpen[] from actual GPIO state
            for (uint8_t i = 0; i < VALVE_COUNT; i++) {
                valveOpen[i] = getSVState(i);
            }
            publishValveData(valveIds, valveLabels, valveOpen, VALVE_COUNT);
        }

    } else {
        // inlet / outlet: just publish sensor readings on interval
        unsigned long now = millis();
        if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
            lastPublish = now;
            // TODO: replace 0.0f stubs with real sensor read calls
            // e.g. co2  = mhz19.getCO2();
            //      temp = sht31.readTemperature();
            //      hum  = sht31.readHumidity();
            //      ph   = readAnalogPH(PH_PIN);
            //      etc.
            publishSensorData(
                NODE_ID,
                0.0f,   // co2
                0.0f,   // ph
                0.0f,   // temperature
                0.0f,   // humidity
                0.0f,   // pm25
                0.0f,   // flow_rate
                0.0f,   // level
                0.0f    // weight
            );
        }
    }
}