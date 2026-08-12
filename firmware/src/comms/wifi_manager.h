#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include "config.h"

// Connect to WiFi. Restarts ESP32 after WIFI_MAX_RETRY failed attempts.
void connectWiFi() {
    Serial.printf("\n[WiFi] Connecting to %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < WIFI_MAX_RETRY) {
        delay(500);
        retry++;
        Serial.printf("  Attempt %d/%d — status: %d\n", retry, WIFI_MAX_RETRY, WiFi.status());
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("[WiFi] FAILED — restarting in 5s");
        delay(5000);
        ESP.restart();
    }
}
