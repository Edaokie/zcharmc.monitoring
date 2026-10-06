#pragma once
#include <Arduino.h>

// Vacuum pump relay control — Vacuum 1, 2, 3
#define VACUUM_1  0   // Bottom — main inlet pump
#define VACUUM_2  1   // Top-left — left column
#define VACUUM_3  2   // Top-right — right column

#define VACUUM_ON  true
#define VACUUM_OFF false

void vacuumControlInit();
void setVacuum(uint8_t vacuumId, bool on);
bool getVacuumState(uint8_t vacuumId);
void stopAllVacuums();
