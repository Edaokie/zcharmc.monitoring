#pragma once
#include <stdbool.h>
void zc_telemetry_start(void);
bool zc_telemetry_healthy(void);
/* Records waiting in the durable queue and how many it can hold; false until storage opens. */
bool zc_telemetry_queue(unsigned *queued, unsigned *capacity);
