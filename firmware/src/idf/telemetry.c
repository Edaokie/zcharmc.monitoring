#include "telemetry.h"
#include "sensors.h"
#include "zc.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Phase 3A: build the reading JSON and PRINT it (dry run). Phase 3B adds the HTTPS POST.

static const char *TAG = "TELEMETRY";
#define ZC_TELEMETRY_PERIOD_MS 15000
#define ZC_CLOCK_VALID_AFTER 1735689600 // 2025-01-01 UTC, same check as main.c

static uint32_t boot_id; // random per boot -> message_id stays unique across reboots
static uint32_t seq;     // counts readings since boot

static bool clock_synced(void) {
    return time(NULL) > ZC_CLOCK_VALID_AFTER;
}

// "2026-10-14T07:55:00Z" (UTC, as the backend expects)
static void utc_now(char *buf, size_t size) {
    time_t now = time(NULL);
    struct tm utc;
    gmtime_r(&now, &utc);
    strftime(buf, size, "%Y-%m-%dT%H:%M:%SZ", &utc);
}

// Round in double so the JSON shows 29.3, not 29.299999237060547.
static double round_to(float value, int decimals) {
    double scale = pow(10.0, decimals);
    return (double)lround((double)value * scale) / scale;
}

// Returns a malloc'd JSON string (free it with cJSON_free), or NULL if out of memory.
static char *build_payload(const zc_reading_t *r, char *message_id, size_t id_size) {
    char timestamp[32];
    snprintf(message_id, id_size, "test-%s-%08lx-%lu",
             ZC_PROFILE, (unsigned long)boot_id, (unsigned long)seq);
    utc_now(timestamp, sizeof(timestamp));

    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;
    cJSON_AddStringToObject(root, "node_id", ZC_PROFILE);
    cJSON_AddStringToObject(root, "message_id", message_id);
    cJSON_AddStringToObject(root, "timestamp", timestamp);
    // Only valid measurements are sent; missing ones are left out (never 0).
    if (r->has_co2)         cJSON_AddNumberToObject(root, "co2", round_to(r->co2, 0));
    if (r->has_temperature) cJSON_AddNumberToObject(root, "temperature", round_to(r->temperature, 1));
    if (r->has_humidity)    cJSON_AddNumberToObject(root, "humidity", round_to(r->humidity, 1));
    if (r->has_pm25)        cJSON_AddNumberToObject(root, "pm25", round_to(r->pm25, 1));

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
}

static void telemetry_task(void *arg) {
    (void)arg;
    boot_id = esp_random();
    zc_sensors_init();
    ESP_LOGI(TAG, "started: %s every %d s (DRY RUN, printing only)",
             ZC_PROFILE, ZC_TELEMETRY_PERIOD_MS / 1000);

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(ZC_TELEMETRY_PERIOD_MS));

        // Never sample before Wi-Fi and the real clock exist: the timestamp would be wrong.
        if (!zc_network_ready) { ESP_LOGI(TAG, "waiting for Wi-Fi"); continue; }
        if (!clock_synced())   { ESP_LOGI(TAG, "waiting for clock (SNTP)"); continue; }

        zc_reading_t reading;
        if (!zc_sensors_read_all(&reading)) { ESP_LOGW(TAG, "sensor read failed"); continue; }

        char message_id[64];
        char *json = build_payload(&reading, message_id, sizeof(message_id));
        if (!json) { ESP_LOGE(TAG, "out of memory building JSON"); continue; }
        ++seq;

        ESP_LOGI(TAG, "DRY RUN %s", json);
        cJSON_free(json);
    }
}

void zc_telemetry_start(void) {
    // Readings come only from inlet/outlet boards, never from control.
    if (strcmp(ZC_PROFILE, "inlet") != 0 && strcmp(ZC_PROFILE, "outlet") != 0) return;
    configASSERT(xTaskCreate(telemetry_task, "telemetry", 12288, NULL, 2, NULL) == pdPASS);
}