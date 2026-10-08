#include <Arduino.h>
#include "config.h"
#include "nodes/node.h"

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    delay(500);
    Serial.printf("\n[BOOT] node=%s fw=%s\n", NODE_ID, FW_VERSION);
    node_setup();
}

void loop() {
    node_loop();
}