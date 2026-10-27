#include "aht25.h"

uint8_t zc_aht25_crc(const uint8_t *data, int n) {
    uint8_t crc=0xFF;
    for (int i=0; i<n; i++) {
        crc^=data[i];
        for (int bit=0; bit<8; bit++) crc=(uint8_t)(crc&0x80 ? (crc<<1)^0x31 : crc<<1);
    }
    return crc;
}

bool zc_aht25_decode(const uint8_t *raw, zc_aht25_reading_t *out) {
    if (raw[0]&0x80) return false;                 /* Busy: measurement not finished. */
    if (zc_aht25_crc(raw,6)!=raw[6]) return false;
    const uint32_t hum=((uint32_t)raw[1]<<12)|((uint32_t)raw[2]<<4)|(raw[3]>>4);
    const uint32_t temp=((uint32_t)(raw[3]&0x0F)<<16)|((uint32_t)raw[4]<<8)|raw[5];
    out->humidity_pct=(float)hum*100.0f/1048576.0f;
    out->temperature_c=(float)temp*200.0f/1048576.0f-50.0f;
    return true;
}

#ifdef ESP_PLATFORM
#include "i2c_bus.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG="AHT25";
static i2c_master_dev_handle_t dev;
static portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
static zc_aht25_reading_t newest;
static int64_t newest_ms; /* 0 = no reading yet. */

static void wait_ms(uint32_t ms) { vTaskDelay(pdMS_TO_TICKS(ms)+1); }

static esp_err_t measure(zc_aht25_reading_t *out) {
    const uint8_t trigger[3]={0xAC,0x33,0x00};
    esp_err_t err=i2c_master_transmit(dev,trigger,sizeof(trigger),100);
    if (err!=ESP_OK) return err;
    wait_ms(80);                                   /* Datasheet: >=80 ms conversion. */
    uint8_t raw[7];
    for (int attempt=0; attempt<3; attempt++) {
        err=i2c_master_receive(dev,raw,sizeof(raw),100);
        if (err!=ESP_OK) return err;
        if (!(raw[0]&0x80)) return zc_aht25_decode(raw,out) ? ESP_OK : ESP_ERR_INVALID_CRC;
        wait_ms(20);                               /* Still busy: give it a little longer. */
    }
    return ESP_ERR_TIMEOUT;
}

static void aht25_task(void *arg) {
    (void)arg;
    wait_ms(100);                                  /* Datasheet: >=100 ms after power-up. */
    uint8_t status=0; const uint8_t get_status=0x71;
    if (i2c_master_transmit_receive(dev,&get_status,1,&status,1,100)==ESP_OK) {
        if ((status&0x18)==0x18) ESP_LOGI(TAG,"Ready (status 0x%02X, calibrated), measuring every 5 s",status);
        else ESP_LOGW(TAG,"Status 0x%02X: calibration bits not set; readings may be invalid (vendor reset routine needed)",status);
    } else ESP_LOGW(TAG,"No answer to status request; will keep trying");
    unsigned failures=0;
    for (;;) {
        zc_aht25_reading_t r;
        esp_err_t err=measure(&r);
        if (err==ESP_OK) {
            failures=0;
            int64_t now=esp_timer_get_time()/1000;
            portENTER_CRITICAL(&mux); newest=r; newest_ms=now ? now : 1; portEXIT_CRITICAL(&mux);
        } else if (++failures==5) ESP_LOGW(TAG,"5 failed measurements in a row (%s)",esp_err_to_name(err));
        wait_ms(5000);
    }
}

esp_err_t zc_aht25_init(void) {
    if (dev) return ESP_OK;
    i2c_master_bus_handle_t bus=zc_i2c_bus();
    if (!bus) return ESP_ERR_INVALID_STATE;
    const i2c_device_config_t cfg={.dev_addr_length=I2C_ADDR_BIT_LEN_7,.device_address=ZC_AHT25_ADDR,.scl_speed_hz=100000};
    esp_err_t err=i2c_master_bus_add_device(bus,&cfg,&dev);
    if (err==ESP_OK && xTaskCreate(aht25_task,"aht25",4096,NULL,2,NULL)!=pdPASS) err=ESP_ERR_NO_MEM;
    if (err!=ESP_OK) { dev=NULL; ESP_LOGE(TAG,"Init failed: %s",esp_err_to_name(err)); }
    return err;
}

esp_err_t zc_aht25_latest(zc_aht25_reading_t *out, int max_age_ms) {
    if (!dev) return ESP_ERR_INVALID_STATE;
    portENTER_CRITICAL(&mux);
    zc_aht25_reading_t r=newest; int64_t at=newest_ms;
    portEXIT_CRITICAL(&mux);
    if (!at || esp_timer_get_time()/1000-at>max_age_ms) return ESP_ERR_TIMEOUT;
    *out=r;
    return ESP_OK;
}
#endif
