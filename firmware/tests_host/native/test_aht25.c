/* Host test for the AHT25 CRC and measurement decoder (no ESP-IDF). */
#include "aht25.h"
#include <assert.h>
#include <math.h>

static void frame(uint8_t *f, uint8_t status, uint32_t hum, uint32_t temp) {
    f[0]=status; f[1]=(uint8_t)(hum>>12); f[2]=(uint8_t)(hum>>4);
    f[3]=(uint8_t)(((hum&0xF)<<4)|((temp>>16)&0xF)); f[4]=(uint8_t)(temp>>8); f[5]=(uint8_t)temp;
    f[6]=zc_aht25_crc(f,6);
}

int main(void) {
    const uint8_t beef[2]={0xBE,0xEF};
    assert(zc_aht25_crc(beef,2)==0x92);                  /* Same CRC-8 as Sensirion's example. */
    uint8_t f[7]; zc_aht25_reading_t r;
    frame(f,0x1C,0x80000,0x60000);                       /* 50.0 %RH, 25.0 C */
    assert(zc_aht25_decode(f,&r));
    assert(fabsf(r.humidity_pct-50.0f)<0.01f && fabsf(r.temperature_c-25.0f)<0.01f);
    frame(f,0x1C,0xB3333,0x5C28F);                       /* 70.0 %RH, ~22.0 C */
    assert(zc_aht25_decode(f,&r));
    assert(fabsf(r.humidity_pct-70.0f)<0.01f && fabsf(r.temperature_c-22.0f)<0.01f);
    frame(f,0x9C,0x80000,0x60000); assert(!zc_aht25_decode(f,&r));   /* busy bit set */
    frame(f,0x1C,0x80000,0x60000); f[4]^=1; assert(!zc_aht25_decode(f,&r)); /* bad CRC */
    return 0;
}
