#pragma once
#include <Arduino.h>

// Solenoid valve control — SV1 through SV6
// Uses relay modules wired to GPIO pins in config.h (active HIGH)

// Valve index constants — use these instead of raw numbers
#define SV1  0   // Inlet A
#define SV2  1   // Inlet B
#define SV3  2   // Outlet path
#define SV4  3   // Center inlet
#define SV5  4   // Purge open air (left)
#define SV6  5   // Purge open air (right)

void valveControlInit();      // Set all SV pins as OUTPUT and close all valves
void openSV(uint8_t sv);      // Open one solenoid valve (sv = SV1 to SV6)
void closeSV(uint8_t sv);     // Close one solenoid valve
void closeAllSV();            // Close all 6 solenoid valves at once
bool getSVState(uint8_t sv);  // Returns true if valve is currently open
