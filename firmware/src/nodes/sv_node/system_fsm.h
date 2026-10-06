#pragma once

// FSM entry points — call from main.cpp only
void FSM_init();  // Call once from setup() — sets initial state
void FSM_run();   // Call every loop() tick — advances the state machine one step
