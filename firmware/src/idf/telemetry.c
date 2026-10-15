#include "telemetry.h"
#include "sensors.h"
#include "zc.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Phase 3B: every 15 s build one reading and POST it to
// <backend>/api/devices/<device_id>/readings with this board's own device token.

static const char *TAG = "TELEMETRY";
#define ZC_TELEMETRY_PERIOD_MS 15000
#define ZC_CLOCK_VALID_AFTER   1735689600 // 2025-01-01 UTC, same check as main.c
#define ZC_RETRY_MAX_MS        300000     // no answer / 429 / 5xx: back off up to 5 min
#define ZC_NOT_READY_WAIT_MS   300000     // 404: endpoint not deployed yet
#define ZC_AUTH_FAIL_WAIT_MS   600000     // 401/403: credential rejected, don't hammer the server

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

// POST one reading. Returns the HTTP status code, or -1 when there was no answer
// (Wi-Fi drop, DNS, TLS, timeout). The first bytes of the reply go into `reply`.
static int post_reading(const char *json, char *reply, size_t reply_size) {
    char url[320], auth[160];
    snprintf(url, sizeof(url), "%s/api/devices/%s/readings", zc_config.backend, zc_config.device_id);
    snprintf(auth, sizeof(auth), "Bearer %s", zc_config.device_token);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach, // verify Railway's HTTPS certificate
        .timeout_ms = 10000,
        .disable_auto_redirect = true,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return -1;
    esp_http_client_set_header(client, "Authorization", auth);
    esp_http_client_set_header(client, "Content-Type", "application/json");

    int status = -1;
    int length = (int)strlen(json);
    reply[0] = 0;
    if (esp_http_client_open(client, length) == ESP_OK
        && esp_http_client_write(client, json, length) == length
        && esp_http_client_fetch_headers(client) >= 0) {
        status = esp_http_client_get_status_code(client);
        int n = esp_http_client_read(client, reply, (int)reply_size - 1);
        reply[n > 0 ? n : 0] = 0;
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return status;
}

static void telemetry_task(void *arg) {
    (void)arg;
    boot_id = esp_random();
    zc_sensors_init();
    ESP_LOGI(TAG, "started: %s every %d s -> /api/devices/%s/readings",
             ZC_PROFILE, ZC_TELEMETRY_PERIOD_MS / 1000, zc_config.device_id);

    char *pending = NULL;        // reading not delivered yet (same message_id on every retry)
    char pending_id[64] = "";
    uint32_t wait_ms = ZC_TELEMETRY_PERIOD_MS;
    uint32_t retry_ms = ZC_TELEMETRY_PERIOD_MS;

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(wait_ms));
        wait_ms = ZC_TELEMETRY_PERIOD_MS;

        // Never sample before Wi-Fi and the real clock exist: the timestamp would be wrong.
        if (!zc_network_ready) { ESP_LOGI(TAG, "waiting for Wi-Fi"); continue; }
        if (!clock_synced())   { ESP_LOGI(TAG, "waiting for clock (SNTP)"); continue; }

        // Take a new reading only when the previous one is finished (delivered or rejected).
        if (!pending) {
            zc_reading_t reading;
            if (!zc_sensors_read_all(&reading)) { ESP_LOGW(TAG, "sensor read failed"); continue; }
            pending = build_payload(&reading, pending_id, sizeof(pending_id));
            if (!pending) { ESP_LOGE(TAG, "out of memory building JSON"); continue; }
            ++seq;
        }

        char reply[160];
        int status = post_reading(pending, reply, sizeof(reply));
        bool finished = true;

        if (status == 201 || status == 200) {
            ESP_LOGI(TAG, "POST %s -> %d %s", pending_id, status, status == 201 ? "stored" : "duplicate (already stored)");
            retry_ms = ZC_TELEMETRY_PERIOD_MS;
        } else if (status == 404) {
            ESP_LOGW(TAG, "POST %s -> 404: readings endpoint not deployed yet, next try in 5 min", pending_id);
            wait_ms = ZC_NOT_READY_WAIT_MS;
        } else if (status == 401 || status == 403) {
            ESP_LOGE(TAG, "POST %s -> %d: device credential rejected, next try in 10 min", pending_id, status);
            wait_ms = ZC_AUTH_FAIL_WAIT_MS;
        } else if (status >= 400 && status < 500 && status != 429) {
            // 400 bad data, 409 conflict, 415 wrong type...: retrying the same data won't help.
            ESP_LOGE(TAG, "POST %s -> %d rejected, dropped: %s", pending_id, status, reply);
        } else {
            // -1 (no answer), 429 (too many requests), 5xx (server problem):
            // keep the SAME reading and try again later, waiting longer each time (+ random jitter).
            finished = false;
            wait_ms = retry_ms + esp_random() % 3000;
            ESP_LOGW(TAG, "POST %s -> %d, retry in %lu s", pending_id, status, (unsigned long)(wait_ms / 1000));
            retry_ms = retry_ms * 2 > ZC_RETRY_MAX_MS ? ZC_RETRY_MAX_MS : retry_ms * 2;
        }

        if (finished) {
            cJSON_free(pending);
            pending = NULL;
        }
    }
}

void zc_telemetry_start(void) {
    // Readings come only from inlet/outlet boards, never from control.
    if (strcmp(ZC_PROFILE, "inlet") != 0 && strcmp(ZC_PROFILE, "outlet") != 0) return;
    // 16 KB stack like Sir Paul's cloud task: the HTTPS (TLS) handshake runs inside this task.
    configASSERT(xTaskCreate(telemetry_task, "telemetry", 16384, NULL, 2, NULL) == pdPASS);
}
