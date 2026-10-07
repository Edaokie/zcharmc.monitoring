#include "zc.h"
#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

zc_config_t zc_config;
nvs_handle_t zc_nvs;
volatile bool zc_maintenance = true; // Control release is a maintenance-only bench image.
volatile bool zc_updating = false;
volatile bool zc_network_ready = false;
const char *zc_status = "not_provisioned";

static void read_string(const char *key, char *dest, size_t capacity) {
    size_t size = capacity;
    if (nvs_get_str(zc_nvs, key, dest, &size) != ESP_OK) dest[0] = 0;
}

void zc_config_init(void) {
    ESP_ERROR_CHECK(nvs_open("zcharmc", NVS_READWRITE, &zc_nvs));
    read_string("device_id", zc_config.device_id, sizeof(zc_config.device_id));
    read_string("device_token", zc_config.device_token, sizeof(zc_config.device_token));
    read_string("backend", zc_config.backend, sizeof(zc_config.backend));
    read_string("ssid", zc_config.ssid, sizeof(zc_config.ssid));
    read_string("password", zc_config.password, sizeof(zc_config.password));
    zc_config.provisioned = zc_config.device_id[0] && zc_config.device_token[0] && zc_config.backend[0] && zc_config.ssid[0];
}

static bool copy_field(cJSON *json, const char *name, char *dest, size_t capacity) {
    cJSON *value = cJSON_GetObjectItemCaseSensitive(json, name);
    if (!cJSON_IsString(value) || strlen(value->valuestring) >= capacity) return false;
    strcpy(dest, value->valuestring);
    return true;
}

void zc_serial_task(void *arg) {
    (void)arg;
    char line[1024]; size_t offset = 0; bool overflow = false;
    for (;;) {
        int ch = getchar();
        if (ch == EOF) { vTaskDelay(pdMS_TO_TICKS(50)); continue; }
        if (ch == '\r') continue;
        if (ch != '\n') {
            if (offset + 1 < sizeof(line)) line[offset++] = (char)ch;
            else overflow = true;
            continue;
        }
        line[offset] = 0; offset = 0;
        if (overflow) { overflow = false; puts("ZC: rejected oversized provisioning input"); continue; }
        cJSON *json = cJSON_Parse(line);
        cJSON *command = json ? cJSON_GetObjectItemCaseSensitive(json, "command") : NULL;
        if (cJSON_IsString(command) && strcmp(command->valuestring, "provision") == 0 && !zc_config.provisioned) {
            zc_config_t next = {0}; char profile[16], hardware[65];
            bool ok = copy_field(json,"profile",profile,sizeof(profile)) && !strcmp(profile,ZC_PROFILE)
                && copy_field(json,"hardware",hardware,sizeof(hardware)) && !strcmp(hardware,ZC_HARDWARE)
                && copy_field(json,"device_id",next.device_id,sizeof(next.device_id))
                && copy_field(json,"device_token",next.device_token,sizeof(next.device_token))
                && copy_field(json,"backend",next.backend,sizeof(next.backend))
                && copy_field(json,"ssid",next.ssid,sizeof(next.ssid))
                && copy_field(json,"password",next.password,sizeof(next.password))
                && !strncmp(next.backend,"https://",8) && next.device_id[0] && next.device_token[0] && next.ssid[0];
            for (const char *p=next.device_id; *p; ++p)
                if (!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='_'||*p=='-')) ok=false;
            if (ok) {
                esp_err_t err = nvs_set_str(zc_nvs,"device_id",next.device_id);
                if (err==ESP_OK) err=nvs_set_str(zc_nvs,"device_token",next.device_token);
                if (err==ESP_OK) err=nvs_set_str(zc_nvs,"backend",next.backend);
                if (err==ESP_OK) err=nvs_set_str(zc_nvs,"ssid",next.ssid);
                if (err==ESP_OK) err=nvs_set_str(zc_nvs,"password",next.password);
                if (err==ESP_OK) err=nvs_commit(zc_nvs);
                if (err==ESP_OK) { puts("ZC: provisioning saved; rebooting"); fflush(stdout); vTaskDelay(pdMS_TO_TICKS(200)); esp_restart(); }
            }
            puts("ZC: provisioning rejected");
        } else if (cJSON_IsString(command) && !strcmp(command->valuestring,"status")) {
            printf("ZC: profile=%s hardware=%s provisioned=%d status=%s\n", ZC_PROFILE,ZC_HARDWARE,zc_config.provisioned,zc_status);
        } else {
            puts("ZC: unsupported command or already provisioned");
        }
        cJSON_Delete(json);
        memset(line,0,sizeof(line));
    }
}
