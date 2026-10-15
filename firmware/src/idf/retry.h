#pragma once
#include <stdint.h>
/* 2, 4, 8, 16, 32, 60 seconds, plus bounded positive jitter. */
static inline uint32_t zc_retry_ms(unsigned failures, uint32_t random) {
    uint32_t base=failures>=5 ? 60000u : 2000u<<failures;
    uint32_t delay=base+random%(base/4u+1u);
    return delay>60000u ? 60000u : delay;
}
