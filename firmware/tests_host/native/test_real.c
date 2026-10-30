#include "sensors.h"
#include "sample.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
/* Real-data adapter: only fresh, successful, in-contract values become valid fields. */
int main(int argc,char **argv) {
    zc_reading_t r; zc_sensors_init();
    /* No sensor tasks on the host: real mode must produce nothing (control never). */
    assert(!zc_sensors_read_all(&r)); assert(r.flags==0);

    zc_real_inputs_t in={.co2_ok=true,.co2_ppm=1234,.th_ok=true,.temperature_c=24.5f,.humidity_pct=45.6f,
                         .pm_ok=true,.pm25_ug_m3=12};
    memset(&r,0,sizeof(r)); assert(zc_real_fill(&in,&r));
    assert(r.flags==((1u<<ZC_CO2)|(1u<<ZC_TEMPERATURE)|(1u<<ZC_HUMIDITY)|(1u<<ZC_PM25)));
    assert(r.values[ZC_CO2]==1234 && r.values[ZC_TEMPERATURE]==24.5f && r.values[ZC_HUMIDITY]==45.6f && r.values[ZC_PM25]==12);
    assert(!(r.flags&(1u<<ZC_PH))); /* No pH sensor: never sent, never zero. */

    zc_real_inputs_t only_co2={.co2_ok=true,.co2_ppm=300}; /* Below 400 is legal (adsorbing outlet). */
    memset(&r,0,sizeof(r)); assert(zc_real_fill(&only_co2,&r)); assert(r.flags==1u<<ZC_CO2);

    zc_real_inputs_t bad=in; bad.co2_ppm=NAN; bad.humidity_pct=100.5f; bad.pm25_ug_m3=-1;
    memset(&r,0,sizeof(r)); assert(!zc_real_fill(&bad,&r)); assert(r.flags==0);

    zc_real_inputs_t uncalibrated=in; uncalibrated.th_ok=false; uncalibrated.pm_ok=false; /* PMS settling. */
    memset(&r,0,sizeof(r)); assert(zc_real_fill(&uncalibrated,&r)); assert(r.flags==1u<<ZC_CO2);

    zc_real_inputs_t none={0}; memset(&r,0,sizeof(r)); assert(!zc_real_fill(&none,&r));

    /* Queue records carry their source; real control records and unknown sources are refused. */
    unsigned role=!strcmp(ZC_PROFILE,"inlet")?1:!strcmp(ZC_PROFILE,"outlet")?2:3;
    memset(&r,0,sizeof(r)); assert(zc_real_fill(&in,&r));
    zc_sample_t sample={.version=2,.profile=role,.flags=r.flags,.sequence=7,.uptime_ms=15000,
                        .utc_ms=1760000000123LL,.source=ZC_SOURCE_REAL};
    memcpy(sample.values,r.values,sizeof(sample.values));
    snprintf(sample.device_id,sizeof(sample.device_id),"bench-%s",ZC_PROFILE);
    zc_sample_t decoded;
    assert(zc_sample_decode(&sample,sizeof(sample),&decoded)==(role!=3));
    zc_sample_t unknown=sample; unknown.source=2; assert(!zc_sample_decode(&unknown,sizeof(unknown),&decoded));
    zc_sample_t simulated=sample; simulated.source=ZC_SOURCE_SIMULATED;
    assert(zc_sample_decode(&simulated,sizeof(simulated),&decoded) && decoded.source==ZC_SOURCE_SIMULATED);
    if (argc>1 && role!=3) { FILE *f=fopen(argv[1],"wb"); assert(f); assert(fwrite(&sample,1,sizeof(sample),f)==sizeof(sample)); fclose(f); }
    puts("Real adapter and source marking passed");
}
