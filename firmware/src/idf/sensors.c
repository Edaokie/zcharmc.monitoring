#include "sensors.h"
#include <math.h>
#include <string.h>
#ifdef ESP_PLATFORM /* Host tests compile this adapter without ESP-IDF. */
#include "i2c_bus.h"
#include "pms7003.h"
#include "scd41.h"
#include "aht25.h"
#include "esp_log.h"
#include "esp_timer.h"
#endif
#ifndef ZC_PROFILE
#error "Select inlet, outlet or control"
#endif
/* ZC_MODE_STATIC: deliberate test fixtures, not sensor specifications, calibration
 * or setpoints. ZC_MODE_REAL: the SCD41/AHT25/PMS7003 values below; any value that
 * is missing, stale or outside the backend contract is left out (never invented). */
void zc_sensors_init(void) {
    /* Bring up the shared sensor bus and list what answers. Both modes start the
     * sensors so the serial log shows their raw values. */
#ifdef ESP_PLATFORM
    if (!strcmp(ZC_PROFILE,"control")) return; /* Control never configures these pins. */
    if (zc_i2c_init()==ESP_OK) { zc_i2c_scan(); zc_scd41_init(); zc_aht25_init(); }
    zc_pms_init();
#endif
}
/* Same bounds as backend/monitoring/contract.py: a value the server would reject
 * (HTTP 400) must never enter the queue, or it would block every later upload. */
static bool within(float value,float min,float max) { return isfinite(value) && value>=min && value<=max; }
bool zc_real_fill(const zc_real_inputs_t *in, zc_reading_t *out) {
    out->flags=0;
    if (in->co2_ok && within(in->co2_ppm,0,1000000)) {
        out->values[ZC_CO2]=in->co2_ppm; out->flags|=1u<<ZC_CO2;
    }
    if (in->th_ok && within(in->temperature_c,-273.15f,1000) && within(in->humidity_pct,0,100)) {
        out->values[ZC_TEMPERATURE]=in->temperature_c; out->flags|=1u<<ZC_TEMPERATURE;
        out->values[ZC_HUMIDITY]=in->humidity_pct; out->flags|=1u<<ZC_HUMIDITY;
    }
    if (in->pm_ok && within(in->pm25_ug_m3,0,1000000)) {
        out->values[ZC_PM25]=in->pm25_ug_m3; out->flags|=1u<<ZC_PM25;
    }
    return out->flags!=0;
}
#ifdef ESP_PLATFORM
/* Prints each sensor's newest value to the serial log. In static mode they are not
 * uploaded (telemetry carries the fixtures); in real mode the same values are copied
 * into the reading. Sensors need a few seconds after boot (PMS fan, SCD41 first 5 s
 * period), so "no data" is only reported once that warm-up has passed. */
#define WARMUP_MS 12000
/* PMS7003 datasheet: stable data at least 30 s after the fan starts. */
#define PMS_SETTLE_MS 30000
#if ZC_DATA_MODE == ZC_MODE_REAL
#define LABEL "REAL"
#else
#define LABEL "RAW (not uploaded)"
#endif
static void log_raw(zc_real_inputs_t *in) {
    const int64_t uptime=esp_timer_get_time()/1000;
    const bool warm=uptime>WARMUP_MS;
    zc_pms_frame_t pm; uint32_t bytes=0;
    esp_err_t err=zc_pms_latest(&pm,5000,&bytes); /* Non-blocking: acquisition timing is untouched. */
    if (err==ESP_OK) { in->pm_ok=uptime>PMS_SETTLE_MS; in->pm25_ug_m3=pm.pm25_atm; }
    if (err==ESP_OK) ESP_LOGI("PMS7003",LABEL " PM1.0=%u PM2.5=%u PM10=%u ug/m3 atm | CF1 %u/%u/%u | >0.3um=%u/0.1L",
                              (unsigned)pm.pm1_atm,(unsigned)pm.pm25_atm,(unsigned)pm.pm10_atm,
                              (unsigned)pm.pm1_cf1,(unsigned)pm.pm25_cf1,(unsigned)pm.pm10_cf1,(unsigned)pm.count[0]);
    else if (warm) ESP_LOGW("PMS7003","No valid frame in the last 5 s (%lu bytes received since boot): %s",(unsigned long)bytes,
                            bytes ? "data arrives but is unreadable; check RX2/TX wires and baud" : "nothing arrives; check fan/5 V, TX2->sensor rx, RX2<-sensor tx");
    zc_scd41_reading_t co2; uint64_t sn=0;
    err=zc_scd41_latest(&co2,12000,&sn); /* New value every 5 s; allow two missed periods. */
    if (err==ESP_OK) {
        in->co2_ok=true; in->co2_ppm=co2.co2_ppm;
        /* Integer tenths: float printf needs more stack than the acquisition task has spare. */
        const int t10=(int)(co2.temperature_c*10.0f+(co2.temperature_c<0 ? -0.5f : 0.5f)), h10=(int)(co2.humidity_pct*10.0f+0.5f);
        ESP_LOGI("SCD41",LABEL " CO2=%u ppm | internal T=%s%d.%d C RH=%d.%d %% (compensation only, not official)",
                 (unsigned)co2.co2_ppm,t10<0 ? "-" : "",(t10<0 ? -t10 : t10)/10,(t10<0 ? -t10 : t10)%10,h10/10,h10%10);
    }
    else if (warm) ESP_LOGW("SCD41","No CO2 value in the last 12 s (%s): check SCD41 wiring/power on the I2C bus",
                            sn ? "sensor started" : "sensor never started");
    zc_aht25_reading_t th;
    err=zc_aht25_latest(&th,12000); /* New value every 5 s; allow two missed periods. */
    if (err==ESP_OK) {
        in->th_ok=zc_aht25_calibrated(); in->temperature_c=th.temperature_c; in->humidity_pct=th.humidity_pct;
        const int t10=(int)(th.temperature_c*10.0f+(th.temperature_c<0 ? -0.5f : 0.5f)), h10=(int)(th.humidity_pct*10.0f+0.5f);
        ESP_LOGI("AHT25",LABEL " T=%s%d.%d C RH=%d.%d %% (official temp/RH)%s",
                 t10<0 ? "-" : "",(t10<0 ? -t10 : t10)/10,(t10<0 ? -t10 : t10)%10,h10/10,h10%10,
                 in->th_ok ? "" : " NOT VALID: calibration bits not set");
    } else if (warm) ESP_LOGW("AHT25","No temp/RH value in the last 12 s: check AHT25 wiring/power on the I2C bus");
}
#endif
bool zc_sensors_read_all(zc_reading_t *out) {
    memset(out,0,sizeof(*out));
    if (!strcmp(ZC_PROFILE,"control")) {
#if ZC_DATA_MODE == ZC_MODE_REAL
        return false; /* No real valve/weight inputs exist; never send fixtures as real. */
#endif
        out->control_flags=7; /* valve states and both weights known. */
        out->valve_bits=0; /* sv1..sv4 logically closed; outputs remain unconfigured. */
        out->weight1_g=1000; out->weight2_g=2000;
        return true;
    }
    zc_real_inputs_t in={0};
#ifdef ESP_PLATFORM
    log_raw(&in);
#endif
    (void)in; /* Host builds have no sensor tasks: real mode then has nothing valid. */
    const bool inlet=!strcmp(ZC_PROFILE,"inlet");
    bool outlet = strcmp(ZC_PROFILE,"outlet") == 0;
    if (!inlet && !outlet) return false;
#if ZC_DATA_MODE == ZC_MODE_REAL
    return zc_real_fill(&in,out); /* pH and process fields stay absent: no sensors yet. */
#endif
    const float incoming[ZC_FIELDS]={4000,29,63,7,30,1,0,1000,0.2f,0.3f,12,10};
    const float outgoing[ZC_FIELDS]={800,29,63,8,12,1,50,900,0.1f,0.1f,10,8};
    memcpy(out->values,inlet?incoming:outgoing,sizeof(out->values));
    out->flags=(1u<<ZC_FIELDS)-1;
    if (inlet) out->flags &= ~(1u<<ZC_LEVEL); /* No inlet level fixture. */
    return true;
}
