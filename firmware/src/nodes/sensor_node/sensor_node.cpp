#include <Arduino.h>
#include "nodes/node.h"

void node_setup() {
    Serial.println("[NODE] sensor node setup");
}

void node_loop() {
    delay(1000);
    Serial.println("[NODE] tick");
}