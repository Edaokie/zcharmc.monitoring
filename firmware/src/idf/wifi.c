#include "zc.h"
#include "retry.h"
#include <string.h>
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static const char *TAG="WIFI";
static TaskHandle_t worker;
static _Atomic bool associating=false;
static void wifi_event(void *arg,esp_event_base_t base,int32_t event,void *data) {
    (void)arg;
    if (base==IP_EVENT && event==IP_EVENT_STA_GOT_IP) {
        zc_network_ready=true; associating=false;
        ESP_LOGI(TAG,"2.4 GHz station has an IP address");
    } else if ((base==WIFI_EVENT && event==WIFI_EVENT_STA_DISCONNECTED)
            || (base==IP_EVENT && event==IP_EVENT_STA_LOST_IP)) {
        zc_network_ready=false; associating=false;
        if (base==WIFI_EVENT && data)
            ESP_LOGW(TAG,"Disconnected (reason=%u); readings stay in the local queue",((wifi_event_sta_disconnected_t *)data)->reason);
    }
    if (worker) xTaskNotifyGive(worker);
}
static void clock_synced(struct timeval *time) {
    (void)time; zc_clock_ready=true;
    ESP_LOGI(TAG,"SNTP synchronized; offline acquisition keeps its boot clock mapping");
}
static void wifi_task(void *arg) {
    (void)arg;
    while (!zc_config.provisioned) vTaskDelay(pdMS_TO_TICKS(1000));
    worker=xTaskGetCurrentTaskHandle();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    configASSERT(esp_netif_create_default_wifi_sta());
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM)); /* Avoid repeated credential writes. */
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_LOST_IP,wifi_event,NULL));
    wifi_config_t config={0};
    memcpy(config.sta.ssid,zc_config.ssid,strnlen(zc_config.ssid,sizeof(config.sta.ssid)));
    memcpy(config.sta.password,zc_config.password,strnlen(zc_config.password,sizeof(config.sta.password)));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&config));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_sntp_config_t clock=ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    clock.sync_cb=clock_synced;
    ESP_ERROR_CHECK(esp_netif_sntp_init(&clock));
    unsigned failures=0; int64_t retry_at=0,deadline=0;
    for (;;) {
        int64_t now=esp_timer_get_time()/1000;
        if (zc_network_ready) { failures=0; retry_at=0; }
        else if (associating && now>=deadline) {
            esp_err_t err=esp_wifi_disconnect(); associating=false;
            retry_at=now+zc_retry_ms(failures,esp_random());
            ESP_LOGW(TAG,"Association/DHCP timeout; disconnect=%s",esp_err_to_name(err));
        } else if (!associating && now>=retry_at) {
            /* Also abort an association which never produces a disconnect event.
             * Restart only the Wi-Fi driver after five unsuccessful attempts. */
            if (failures && failures%5==0) {
                esp_err_t stop=esp_wifi_stop(),start=esp_wifi_start();
                ESP_LOGW(TAG,"Wi-Fi driver recovery stop=%s start=%s",esp_err_to_name(stop),esp_err_to_name(start));
            } else if (failures) esp_wifi_disconnect();
            associating=true; deadline=now+30000;
            esp_err_t err=esp_wifi_connect();
            if (err!=ESP_OK) associating=false;
            uint32_t delay=zc_retry_ms(failures,esp_random());
            ESP_LOGI(TAG,"Connection attempt %u result=%s; retry in %lu ms if still offline",failures+1,esp_err_to_name(err),(unsigned long)delay);
            if (failures<1000000) failures++;
            retry_at=now+delay;
        }
        ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(1000));
    }
}
void zc_wifi_start(void) {
    configASSERT(xTaskCreate(wifi_task,"wifi_recovery",4096,NULL,3,NULL)==pdPASS);
}
