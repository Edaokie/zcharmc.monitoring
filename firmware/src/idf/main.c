#include "zc.h"
#include <string.h>
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "esp_app_desc.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_netif_sntp.h"
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "psa/crypto.h"

// Preserve the existing pin map for bench inspection. Never run the legacy fake-pressure FSM.
volatile bool zc_boot_ready = false;
static volatile unsigned health_ticks;
static const int outputs[] = {2,4,5,12,13,14,15,16,17};
bool zc_control_health(void) {
    if (strcmp(ZC_PROFILE,"control")) return true;
    for (unsigned i=0;i<sizeof(outputs)/sizeof(outputs[0]);++i)
        if (gpio_get_level(outputs[i]) != 0) return false;
    return zc_maintenance;
}

static void control_task(void *arg) {
    (void)arg;
    // Bench maintenance-only adapter. Real control/sensor health hooks require hardware validation.
    for (;;) {
        ++health_ticks;
        if (!zc_control_health()) { zc_status="failed"; }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

static void wifi_event(void *arg, esp_event_base_t base, int32_t event, void *data) {
    (void)arg; (void)data;
    if (base==WIFI_EVENT && event==WIFI_EVENT_STA_DISCONNECTED) zc_network_ready=false;
    if (base==IP_EVENT && event==IP_EVENT_STA_GOT_IP) zc_network_ready=true;
}

void zc_network_task(void *arg) {
    (void)arg;
    // Cloud reachability is never a local-health prerequisite.
    while (!zc_config.provisioned) vTaskDelay(pdMS_TO_TICKS(1000));
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    wifi_config_t config={0};
    strcpy((char *)config.sta.ssid,zc_config.ssid);
    strcpy((char *)config.sta.password,zc_config.password);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&config));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_sntp_config_t clock=ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    ESP_ERROR_CHECK(esp_netif_sntp_init(&clock));
    for (;;) {
        if (!zc_network_ready) esp_wifi_connect();
        else if (zc_boot_ready && time(NULL)>1735689600) { zc_report(); zc_ota_poll(); }
        vTaskDelay(pdMS_TO_TICKS(60000));
    }
}

void app_main(void) {
    // Never erase NVS silently: credentials and OTA attempt records must survive updates.
    ESP_ERROR_CHECK(nvs_flash_init());
    zc_config_init();
    ESP_ERROR_CHECK(psa_crypto_init()==PSA_SUCCESS ? ESP_OK : ESP_FAIL);
    if (!strcmp(ZC_PROFILE,"control")) {
        uint64_t mask=0;
        for (unsigned i=0;i<sizeof(outputs)/sizeof(outputs[0]);++i) mask |= 1ULL<<outputs[i];
        gpio_config_t pins={.pin_bit_mask=mask,.mode=GPIO_MODE_INPUT_OUTPUT,.pull_up_en=GPIO_PULLUP_DISABLE,.pull_down_en=GPIO_PULLDOWN_DISABLE};
        ESP_ERROR_CHECK(gpio_config(&pins));
        for (unsigned i=0;i<sizeof(outputs)/sizeof(outputs[0]);++i) ESP_ERROR_CHECK(gpio_set_level(outputs[i],0));
    }
    zc_status="pending";
    char attempt[32]={0}; size_t len=sizeof(attempt);
    if (nvs_get_str(zc_nvs,"attempt_ver",attempt,&len)==ESP_OK && strcmp(attempt,esp_app_get_description()->version)) zc_status="rolled_back";
    ESP_LOGI("ZCharMC","Native ESP-IDF/FreeRTOS %s %s (%s)",ZC_PROFILE,esp_app_get_description()->version,ZC_HARDWARE);
    configASSERT(xTaskCreate(zc_serial_task,"provision",4096,NULL,2,NULL)==pdPASS);
    configASSERT(xTaskCreate(control_task,"local_health",3072,NULL,5,NULL)==pdPASS);
    configASSERT(xTaskCreate(zc_network_task,"cloud_ota",16384,NULL,2,NULL)==pdPASS);
    // Validate local task progress and maintenance outputs before accepting a pending image.
    vTaskDelay(pdMS_TO_TICKS(3000));
    bool healthy=zc_config.provisioned && health_ticks>10 && zc_control_health()
        && esp_get_free_heap_size()>32768;
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(),&state)==ESP_OK && state==ESP_OTA_IMG_PENDING_VERIFY) {
        if (!healthy) ESP_ERROR_CHECK(esp_ota_mark_app_invalid_rollback_and_reboot());
        else ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
    }
    if (!strcmp(zc_status,"pending")) zc_status=healthy ? "healthy" : "not_provisioned";
    zc_boot_ready=healthy;
}
