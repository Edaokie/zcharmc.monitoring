#include "scd41.h"

uint8_t zc_scd41_crc(const uint8_t *word) {
    uint8_t crc=0xFF;
    for (int i=0; i<2; i++) {
        crc^=word[i];
        for (int bit=0; bit<8; bit++) crc=(uint8_t)(crc&0x80 ? (crc<<1)^0x31 : crc<<1);
    }
    return crc;
}

bool zc_scd41_decode(const uint8_t *raw, zc_scd41_reading_t *out) {
    uint16_t w[3];
    for (int i=0; i<3; i++) {
        const uint8_t *p=raw+3*i;
        if (zc_scd41_crc(p)!=p[2]) return false;
        w[i]=(uint16_t)((p[0]<<8)|p[1]);
    }
    out->co2_ppm=w[0];
    out->temperature_c=-45.0f+175.0f*(float)w[1]/65535.0f;
    out->humidity_pct=100.0f*(float)w[2]/65535.0f;
    return true;
}

#ifdef ESP_PLATFORM
#include "i2c_bus.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG="SCD41";
static i2c_master_dev_handle_t dev;
static portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
static zc_scd41_reading_t newest;
static int64_t newest_ms; /* 0 = no reading yet. */
static uint64_t serial_no;

/* Datasheet execution times are minimums; +1 tick guarantees at least that long. */
static void wait_ms(uint32_t ms) { vTaskDelay(pdMS_TO_TICKS(ms)+1); }

static esp_err_t command(uint16_t cmd, uint32_t exec_ms) {
    const uint8_t b[2]={(uint8_t)(cmd>>8),(uint8_t)cmd};
    esp_err_t err=i2c_master_transmit(dev,b,sizeof(b),100);
    if (err==ESP_OK && exec_ms) wait_ms(exec_ms);
    return err;
}
static esp_err_t command_word(uint16_t cmd, uint16_t arg, uint32_t exec_ms) {
    uint8_t b[5]={(uint8_t)(cmd>>8),(uint8_t)cmd,(uint8_t)(arg>>8),(uint8_t)arg,0};
    b[4]=zc_scd41_crc(b+2);
    esp_err_t err=i2c_master_transmit(dev,b,sizeof(b),100);
    if (err==ESP_OK && exec_ms) wait_ms(exec_ms);
    return err;
}
/* Sends cmd, waits the execution time, then reads n CRC-checked words. */
static esp_err_t read_words(uint16_t cmd, uint8_t *raw, size_t words) {
    esp_err_t err=command(cmd,1);
    if (err!=ESP_OK) return err;
    err=i2c_master_receive(dev,raw,words*3,100);
    if (err!=ESP_OK) return err;
    for (size_t i=0; i<words; i++) if (zc_scd41_crc(raw+3*i)!=raw[3*i+2]) return ESP_ERR_INVALID_CRC;
    return ESP_OK;
}

static esp_err_t start(void) {
    /* After an ESP32 reset the sensor may still be measuring; stop first (500 ms). */
    command(0x3F86,500);
    uint8_t raw[9];
    esp_err_t err=read_words(0x3682,raw,3); /* get_serial_number */
    if (err!=ESP_OK) return err;
    uint64_t sn=((uint64_t)raw[0]<<40)|((uint64_t)raw[1]<<32)|((uint64_t)raw[3]<<24)|((uint64_t)raw[4]<<16)|((uint64_t)raw[6]<<8)|raw[7];
    err=command_word(0x2416,0,1); /* set_automatic_self_calibration_enabled = 0 */
    if (err!=ESP_OK) return err;
    err=command(0x21B1,0); /* start_periodic_measurement: new value every 5 s */
    if (err!=ESP_OK) return err;
    portENTER_CRITICAL(&mux); serial_no=sn; portEXIT_CRITICAL(&mux);
    ESP_LOGI(TAG,"Started: serial 0x%012llx, automatic self-calibration OFF, periodic 5 s (first value in ~5 s)",(unsigned long long)sn);
    return ESP_OK;
}

static void scd41_task(void *arg) {
    (void)arg;
    for (;;) {
        esp_err_t err=start();
        if (err!=ESP_OK) { ESP_LOGW(TAG,"Start failed (%s); retrying in 10 s",esp_err_to_name(err)); wait_ms(10000); continue; }
        unsigned failures=0;
        while (failures<5) {
            wait_ms(1000);
            uint8_t raw[9];
            if (read_words(0xE4B8,raw,1)!=ESP_OK) { failures++; continue; } /* get_data_ready_status */
            if (!(((raw[0]<<8)|raw[1])&0x07FF)) continue;                      /* no new value yet */
            zc_scd41_reading_t r;
            if (read_words(0xEC05,raw,3)!=ESP_OK || !zc_scd41_decode(raw,&r)) { failures++; continue; }
            failures=0;
            int64_t now=esp_timer_get_time()/1000;
            portENTER_CRITICAL(&mux); newest=r; newest_ms=now ? now : 1; portEXIT_CRITICAL(&mux);
        }
        ESP_LOGW(TAG,"5 read errors in a row; restarting the sensor");
    }
}

esp_err_t zc_scd41_init(void) {
    if (dev) return ESP_OK;
    i2c_master_bus_handle_t bus=zc_i2c_bus();
    if (!bus) return ESP_ERR_INVALID_STATE;
    const i2c_device_config_t cfg={.dev_addr_length=I2C_ADDR_BIT_LEN_7,.device_address=ZC_SCD41_ADDR,.scl_speed_hz=100000};
    esp_err_t err=i2c_master_bus_add_device(bus,&cfg,&dev);
    if (err==ESP_OK && xTaskCreate(scd41_task,"scd41",4096,NULL,2,NULL)!=pdPASS) err=ESP_ERR_NO_MEM;
    if (err!=ESP_OK) { dev=NULL; ESP_LOGE(TAG,"Init failed: %s",esp_err_to_name(err)); }
    return err;
}

esp_err_t zc_scd41_latest(zc_scd41_reading_t *out, int max_age_ms, uint64_t *serial) {
    if (!dev) return ESP_ERR_INVALID_STATE;
    portENTER_CRITICAL(&mux);
    zc_scd41_reading_t r=newest; int64_t at=newest_ms; uint64_t sn=serial_no;
    portEXIT_CRITICAL(&mux);
    if (serial) *serial=sn;
    if (!at || esp_timer_get_time()/1000-at>max_age_ms) return ESP_ERR_TIMEOUT;
    *out=r;
    return ESP_OK;
}
#endif
