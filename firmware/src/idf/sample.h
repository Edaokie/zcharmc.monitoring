#pragma once
#include <stdint.h>
/* On-flash schema v1. Change version and provide migration if this layout changes. */
typedef struct {
    uint32_t version, flags;
    uint8_t boot[16];
    uint64_t sequence;
    int64_t uptime_ms, utc_ms;
    float co2, temperature, humidity, pm25;
    uint32_t profile, reserved;
    char device_id[72];
} zc_sample_t;
_Static_assert(sizeof(zc_sample_t)==144,"Update the queue decoder when changing sample layout");
