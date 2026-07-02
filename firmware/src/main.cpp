#include <Arduino.h>
#include "payload.h"
#include "sensors/SensorManager.h"

QueueHandle_t telemetryQueue = nullptr;
void sensorTask(void* parameter) {
    SensorManager sensorManager;
    sensorManager.begin();

    while (true) {
        SensorReading reading = sensorManager.readAll();

        if (telemetryQueue != nullptr) {
            xQueueSend(telemetryQueue, &reading, pdMS_TO_TICKS(100));
        }

        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

void mqttTask(void* parameter) {
    SensorReading reading{};

    while (true) {
        if (telemetryQueue != nullptr) {
            if (xQueueReceive(telemetryQueue, &reading, pdMS_TO_TICKS(1000)) == pdTRUE) {
                Serial.println("Telemetry received by MQTT task.");

                Serial.print("CO2: ");
                Serial.println(reading.co2_ppm);

                Serial.print("PM2.5: ");
                Serial.println(reading.pm25_ugm3);

                Serial.print("Temperature: ");
                Serial.println(reading.temperature_c);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void otaTask(void* parameter) {
    while (true) {
        // Placeholder for OTA update checking.
        vTaskDelay(pdMS_TO_TICKS(30000));
    }
}

void healthTask(void* parameter) {
    while (true) {
        Serial.print("Free heap: ");
        Serial.println(ESP.getFreeHeap());

        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}
void setup()
{
    Serial.begin(115200);
    delay(1000);

    telemetryQueue = xQueueCreate(10, sizeof(SensorReading));

    xTaskCreate(sensorTask, "Sensor Task", 4096, nullptr, 1, nullptr);
    xTaskCreate(mqttTask, "MQTT Task", 4096, nullptr, 1, nullptr);
    xTaskCreate(otaTask, "OTA Task", 4096, nullptr, 1, nullptr);
    xTaskCreate(healthTask, "Health Task", 4096, nullptr, 1, nullptr);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));
}