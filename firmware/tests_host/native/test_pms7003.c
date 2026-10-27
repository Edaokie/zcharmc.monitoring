/* Host test for the PMS7003 frame decoder (no ESP-IDF). */
#include "pms7003.h"
#include <assert.h>
#include <string.h>

static void frame(uint8_t *f, uint16_t pm25_atm) {
    memset(f,0,ZC_PMS_FRAME);
    f[0]=0x42; f[1]=0x4D; f[3]=28;
    f[5]=7; f[7]=9; f[9]=11;                 /* CF1: PM1.0=7, PM2.5=9, PM10=11 */
    f[11]=5; f[12]=(uint8_t)(pm25_atm>>8); f[13]=(uint8_t)pm25_atm; f[15]=10;
    f[16]=0x04; f[17]=0xD2;                  /* >0.3 um = 1234 */
    uint16_t sum=0; for (int k=0;k<30;k++) sum+=f[k];
    f[30]=(uint8_t)(sum>>8); f[31]=(uint8_t)sum;
}

int main(void) {
    uint8_t f[ZC_PMS_FRAME], buf[80]; zc_pms_frame_t out; size_t used;
    frame(f,300);
    assert(zc_pms_parse(f,sizeof(f),&out,&used) && used==32);
    assert(out.pm1_cf1==7 && out.pm25_cf1==9 && out.pm10_cf1==11);
    assert(out.pm1_atm==5 && out.pm25_atm==300 && out.pm10_atm==10 && out.count[0]==1234);
    /* Garbage (including a fake 0x42 0x4D) before a real frame is skipped. */
    memset(buf,0xAA,sizeof(buf)); buf[3]=0x42; buf[4]=0x4D; memcpy(buf+20,f,32);
    assert(zc_pms_parse(buf,52,&out,&used) && used==52 && out.pm25_atm==300);
    /* A corrupted checksum is rejected. */
    f[13]^=1; assert(!zc_pms_parse(f,sizeof(f),&out,&used));
    /* An incomplete frame is not parsed and its start is kept for the next read. */
    frame(f,42); assert(!zc_pms_parse(f,20,&out,&used) && used==0);
    memcpy(buf,f,10); assert(!zc_pms_parse(buf,10,&out,&used) && used==0);
    return 0;
}
