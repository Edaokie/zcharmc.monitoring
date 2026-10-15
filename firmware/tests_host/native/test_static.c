#include "sensors.h"
#include "sample.h"
#include "outbox.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv) {
    zc_reading_t first,second; zc_sensors_init();
    assert(zc_sensors_read_all(&first)); assert(zc_sensors_read_all(&second));
    assert(!memcmp(&first,&second,sizeof(first)));
    unsigned role=!strcmp(ZC_PROFILE,"inlet")?1:!strcmp(ZC_PROFILE,"outlet")?2:3;
    if (role==3) { assert(first.flags==0 && first.control_flags==7 && first.valve_bits==0); assert(first.weight1_g==1000 && first.weight2_g==2000); }
    else { assert(first.values[ZC_CO2]==(role==1?4000:800)); assert(first.flags&(1u<<ZC_PH)); }
    zc_sample_v1_t old={.version=1,.flags=15,.profile=1,.co2=4000,.temperature=29,.humidity=63,.pm25=30};
    strcpy(old.device_id,"legacy-inlet"); zc_sample_t converted;
    assert(zc_sample_decode(&old,sizeof(old),&converted));
    assert(converted.flags==23 && converted.values[4]==30 && converted.profile==1);
    old.version=99; assert(!zc_sample_decode(&old,sizeof(old),&converted));
    zc_sample_t sample={.version=2,.profile=role,.flags=first.flags,.sequence=1,.uptime_ms=15000,.utc_ms=1760000000123LL};
    memcpy(sample.values,first.values,sizeof(sample.values)); sample.valve_bits=first.valve_bits;
    sample.control_flags=first.control_flags; sample.weight1_g=first.weight1_g; sample.weight2_g=first.weight2_g;
    snprintf(sample.device_id,sizeof(sample.device_id),"bench-%s",ZC_PROFILE);
    assert(zc_sample_decode(&sample,sizeof(sample),&converted));
    if (argc>1) { FILE *f=fopen(argv[1],"wb"); assert(f); assert(fwrite(&sample,1,sizeof(sample),f)==sizeof(sample)); fclose(f); }
    puts("Static adapter and v1/v2 compatibility passed");
}
