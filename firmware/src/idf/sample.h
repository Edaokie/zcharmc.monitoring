#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
/* v1 remains readable across OTA. Never reinterpret its four-field payload as v2. */
/* v2 "source" (formerly a reserved zero word): 0 = simulated fixtures for the test
 * endpoint, 1 = real sensor values for research /api/ingest. Old records read as 0.
 * Firmware older than this rejects source 1 (queue fault, nothing erased): export the
 * queue before downgrading a real-mode board. */
#define ZC_SOURCE_SIMULATED 0u
#define ZC_SOURCE_REAL 1u
typedef struct {
    uint32_t version, flags; uint8_t boot[16]; uint64_t sequence;
    int64_t uptime_ms, utc_ms;
    float co2, temperature, humidity, pm25;
    uint32_t profile, reserved; char device_id[72];
} zc_sample_v1_t;
typedef struct {
    uint32_t version, flags; uint8_t boot[16]; uint64_t sequence;
    int64_t uptime_ms, utc_ms;
    float values[12], weight1_g, weight2_g;
    uint32_t profile, valve_bits, control_flags, source;
    char device_id[72];
} zc_sample_t;
_Static_assert(sizeof(zc_sample_v1_t)==144,"Legacy layout must not change");
_Static_assert(sizeof(zc_sample_t)==192,"Update decoder if v2 changes");
static inline bool zc_sample_decode(const void *raw,size_t size,zc_sample_t *out) {
    uint32_t version=0;
    if (size<sizeof(version)) return false;
    memcpy(&version,raw,sizeof(version)); memset(out,0,sizeof(*out));
    if (version==1 && size==sizeof(zc_sample_v1_t)) {
        zc_sample_v1_t old; memcpy(&old,raw,sizeof(old));
        if (old.reserved || old.profile<1 || old.profile>2 || old.flags&~15u) return false;
        out->version=2; memcpy(out->boot,old.boot,16); out->sequence=old.sequence;
        out->uptime_ms=old.uptime_ms; out->utc_ms=old.utc_ms; out->profile=old.profile;
        memcpy(out->device_id,old.device_id,72);
        const unsigned positions[]={0,1,2,4}; const float values[]={old.co2,old.temperature,old.humidity,old.pm25};
        for (unsigned i=0;i<4;i++) if (old.flags&(1u<<i)) { out->flags|=1u<<positions[i]; out->values[positions[i]]=values[i]; }
    } else if (version==2 && size==sizeof(*out)) memcpy(out,raw,size);
    else return false;
    return out->profile>=1 && out->profile<=3 && out->source<=ZC_SOURCE_REAL
        && !(out->source==ZC_SOURCE_REAL && out->profile==3) && !(out->flags&~4095u)
        && !(out->valve_bits&~15u) && !(out->control_flags&~7u)
        && memchr(out->device_id,0,sizeof(out->device_id)) && out->uptime_ms>=0 && out->utc_ms>=0;
}
