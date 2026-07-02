#include <Arduino.h>
#include <WiFi.h>

#include "payload.h"
#include "config.h"

QueueHandle_t telemetryQueue;

void sensorTask(void* parameter);
void mqttTask(void* parameter);
void otaTask(void* parameter);
void healthTask(void* parameter);

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(1000);

    telemetryQueue = xQueueCreate(5, sizeof(SensorReading));

    if (telemetryQueue == nullptr) {
        Serial.println("Failed to create telemetry queue");
        while (true) {
            delay(1000);
        }
    }

    xTaskCreatePinnedToCore(
        sensorTask,
        "SensorTask",
        8192,
        nullptr,
        2,
        nullptr,
        1
    );

    xTaskCreatePinnedToCore(
        mqttTask,
        "MqttTask",
        8192,
        nullptr,
        2,
        nullptr,
        1
    );

    xTaskCreatePinnedToCore(
        otaTask,
        "OtaTask",
        8192,
        nullptr,
        1,
        nullptr,
        0
    );

    xTaskCreatePinnedToCore(
        healthTask,
        "HealthTask",
        4096,
        nullptr,
        1,
        nullptr,
        0
    );
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));
}