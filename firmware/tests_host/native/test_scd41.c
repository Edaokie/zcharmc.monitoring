/* Host test for the SCD41 CRC and measurement decoder (no ESP-IDF). */
#include "scd41.h"
#include <assert.h>
#include <math.h>

static void word(uint8_t *p, uint16_t v) { p[0]=(uint8_t)(v>>8); p[1]=(uint8_t)v; p[2]=zc_scd41_crc(p); }

int main(void) {
    const uint8_t beef[2]={0xBE,0xEF};
    assert(zc_scd41_crc(beef)==0x92);            /* Sensirion datasheet example. */
    uint8_t raw[9]; zc_scd41_reading_t r;
    word(raw,1234); word(raw+3,0x6667); word(raw+6,0x5EB9);
    assert(zc_scd41_decode(raw,&r));
    assert(r.co2_ppm==1234);
    assert(fabsf(r.temperature_c-25.0f)<0.05f);  /* -45 + 175*0x6667/65535 = 25.0 C */
    assert(fabsf(r.humidity_pct-37.0f)<0.05f);   /* 100*0x5EB9/65535 = 37.0 %RH */
    raw[2]^=1; assert(!zc_scd41_decode(raw,&r)); /* corrupted CO2 CRC */
    raw[2]^=1; raw[8]^=0x80; assert(!zc_scd41_decode(raw,&r)); /* corrupted RH CRC */
    return 0;
}
