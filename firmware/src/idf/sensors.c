#include "sensors.h"
#include <string.h>
#ifdef ESP_PLATFORM /* Host tests compile this adapter without ESP-IDF. */
#include "i2c_bus.h"
#include "pms7003.h"
#include "scd41.h"
#include "esp_log.h"
#include "esp_timer.h"
#endif
#ifndef ZC_PROFILE
#error "Select inlet, outlet or control"
#endif
/* Deliberate test fixtures, not sensor specifications, calibration or setpoints.
 * Replace this adapter with actual drivers later; retain the acquisition interface. */
void zc_sensors_init(void) {
    /* Phase 4 step 1: bring up the shared sensor bus and list what answers.
     * Readings below stay static fixtures until real drivers replace them. */
#ifdef ESP_PLATFORM
    if (!strcmp(ZC_PROFILE,"control")) return; /* Control never configures these pins. */
    if (zc_i2c_init()==ESP_OK) { zc_i2c_scan(); zc_scd41_init(); }
    zc_pms_init();
#endif
}
#ifdef ESP_PLATFORM
/* Phase 4 bench check: print real sensor values to the serial log only.
 * They are not uploaded; telemetry below still carries the static fixtures.
 * Sensors need a few seconds after boot (PMS fan, SCD41 first 5 s period), so
 * "no data" is only reported once that warm-up has passed. */
#define WARMUP_MS 12000
static void log_raw(void) {
    const bool warm=esp_timer_get_time()/1000>WARMUP_MS;
    zc_pms_frame_t pm; uint32_t bytes=0;
    esp_err_t err=zc_pms_latest(&pm,5000,&bytes); /* Non-blocking: acquisition timing is untouched. */
    if (err==ESP_OK) ESP_LOGI("PMS7003","RAW (not uploaded) PM1.0=%u PM2.5=%u PM10=%u ug/m3 atm | CF1 %u/%u/%u | >0.3um=%u/0.1L",
                              (unsigned)pm.pm1_atm,(unsigned)pm.pm25_atm,(unsigned)pm.pm10_atm,
                              (unsigned)pm.pm1_cf1,(unsigned)pm.pm25_cf1,(unsigned)pm.pm10_cf1,(unsigned)pm.count[0]);
    else if (warm) ESP_LOGW("PMS7003","No valid frame in the last 5 s (%lu bytes received since boot): %s",(unsigned long)bytes,
                            bytes ? "data arrives but is unreadable; check RX2/TX wires and baud" : "nothing arrives; check fan/5 V, TX2->sensor rx, RX2<-sensor tx");
    zc_scd41_reading_t co2; uint64_t sn=0;
    err=zc_scd41_latest(&co2,12000,&sn); /* New value every 5 s; allow two missed periods. */
    if (err==ESP_OK) {
        /* Integer tenths: float printf needs more stack than the acquisition task has spare. */
        const int t10=(int)(co2.temperature_c*10.0f+(co2.temperature_c<0 ? -0.5f : 0.5f)), h10=(int)(co2.humidity_pct*10.0f+0.5f);
        ESP_LOGI("SCD41","RAW (not uploaded) CO2=%u ppm | internal T=%s%d.%d C RH=%d.%d %% (compensation only, not official)",
                 (unsigned)co2.co2_ppm,t10<0 ? "-" : "",(t10<0 ? -t10 : t10)/10,(t10<0 ? -t10 : t10)%10,h10/10,h10%10);
    }
    else if (warm) ESP_LOGW("SCD41","No CO2 value in the last 12 s (%s): check SCD41 wiring/power on the I2C bus",
                            sn ? "sensor started" : "sensor never started");
}
#endif
bool zc_sensors_read_all(zc_reading_t *out) {
    memset(out,0,sizeof(*out));
    if (!strcmp(ZC_PROFILE,"control")) {
        out->control_flags=7; /* valve states and both weights known. */
        out->valve_bits=0; /* sv1..sv4 logically closed; outputs remain unconfigured. */
        out->weight1_g=1000; out->weight2_g=2000;
        return true;
    }
#ifdef ESP_PLATFORM
    log_raw();
#endif
    const bool inlet=!strcmp(ZC_PROFILE,"inlet");
    bool outlet = strcmp(ZC_PROFILE,"outlet") == 0;
    if (!inlet && !outlet) return false;
    const float incoming[ZC_FIELDS]={4000,29,63,7,30,1,0,1000,0.2f,0.3f,12,10};
    const float outgoing[ZC_FIELDS]={800,29,63,8,12,1,50,900,0.1f,0.1f,10,8};
    memcpy(out->values,inlet?incoming:outgoing,sizeof(out->values));
    out->flags=(1u<<ZC_FIELDS)-1;
    if (inlet) out->flags &= ~(1u<<ZC_LEVEL); /* No inlet level fixture. */
    return true;
}
