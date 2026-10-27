#include "pms7003.h"
#include <string.h>

static uint16_t be16(const uint8_t *p) { return (uint16_t)((p[0]<<8)|p[1]); }

bool zc_pms_parse(const uint8_t *buf, size_t len, zc_pms_frame_t *out, size_t *consumed) {
    size_t i=0;
    for (; i+ZC_PMS_FRAME<=len; i++) {
        const uint8_t *f=buf+i;
        if (f[0]!=0x42 || f[1]!=0x4D || be16(f+2)!=ZC_PMS_FRAME-4) continue;
        uint16_t sum=0;
        for (int k=0; k<ZC_PMS_FRAME-2; k++) sum+=f[k];
        if (sum!=be16(f+ZC_PMS_FRAME-2)) continue; /* Corrupt or misaligned: keep scanning. */
        out->pm1_cf1=be16(f+4); out->pm25_cf1=be16(f+6); out->pm10_cf1=be16(f+8);
        out->pm1_atm=be16(f+10); out->pm25_atm=be16(f+12); out->pm10_atm=be16(f+14);
        for (int k=0; k<6; k++) out->count[k]=be16(f+16+2*k);
        if (consumed) *consumed=i+ZC_PMS_FRAME;
        return true;
    }
    if (consumed) *consumed=i; /* Bytes before i can never start a complete frame. */
    return false;
}

#ifdef ESP_PLATFORM
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define PMS_UART UART_NUM_2
static const char *TAG="PMS7003";
static bool ready;
static portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
static zc_pms_frame_t newest;
static int64_t newest_ms; /* 0 = no valid frame yet. */
static uint32_t bytes_total;

/* Runs beside acquisition so a slow or missing sensor never delays a sample. */
static void pms_task(void *arg) {
    (void)arg;
    uint8_t buf[2*ZC_PMS_FRAME]; size_t have=0;
    for (;;) {
        int n=uart_read_bytes(PMS_UART,buf+have,sizeof(buf)-have,pdMS_TO_TICKS(500));
        if (n<=0) continue;
        have+=(size_t)n;
        portENTER_CRITICAL(&mux); bytes_total+=(uint32_t)n; portEXIT_CRITICAL(&mux);
        zc_pms_frame_t f; size_t used=0;
        while (zc_pms_parse(buf,have,&f,&used)) {
            int64_t now=esp_timer_get_time()/1000;
            portENTER_CRITICAL(&mux); newest=f; newest_ms=now ? now : 1; portEXIT_CRITICAL(&mux);
            memmove(buf,buf+used,have-used); have-=used;
        }
        memmove(buf,buf+used,have-used); have-=used;
    }
}

esp_err_t zc_pms_init(void) {
    if (ready) return ESP_OK;
    const uart_config_t cfg={
        .baud_rate=9600, .data_bits=UART_DATA_8_BITS, .parity=UART_PARITY_DISABLE,
        .stop_bits=UART_STOP_BITS_1, .flow_ctrl=UART_HW_FLOWCTRL_DISABLE, .source_clk=UART_SCLK_DEFAULT,
    };
    esp_err_t err=uart_driver_install(PMS_UART,1024,0,0,NULL,0);
    if (err==ESP_OK) err=uart_param_config(PMS_UART,&cfg);
    if (err==ESP_OK) err=uart_set_pin(PMS_UART,ZC_PMS_TX,ZC_PMS_RX,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);
    if (err==ESP_OK && xTaskCreate(pms_task,"pms7003",3072,NULL,2,NULL)!=pdPASS) err=ESP_ERR_NO_MEM;
    ready=err==ESP_OK;
    if (ready) ESP_LOGI(TAG,"UART2 ready: TX2=GPIO%d -> sensor RX, RX2=GPIO%d <- sensor TX, 9600 baud",ZC_PMS_TX,ZC_PMS_RX);
    else ESP_LOGE(TAG,"UART2 init failed: %s",esp_err_to_name(err));
    return err;
}

esp_err_t zc_pms_latest(zc_pms_frame_t *out, int max_age_ms, uint32_t *bytes_seen) {
    if (!ready) return ESP_ERR_INVALID_STATE;
    portENTER_CRITICAL(&mux);
    zc_pms_frame_t f=newest; int64_t at=newest_ms; uint32_t bytes=bytes_total;
    portEXIT_CRITICAL(&mux);
    if (bytes_seen) *bytes_seen=bytes;
    if (!at || esp_timer_get_time()/1000-at>max_age_ms) return ESP_ERR_TIMEOUT;
    *out=f;
    return ESP_OK;
}
#endif
