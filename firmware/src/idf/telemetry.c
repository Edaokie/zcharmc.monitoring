#include "telemetry.h"
#include "sensors.h"
#include "outbox.h"
#include "sample.h"
#include "retry.h"
#include "zc.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#define PERIOD_MS 15000
#define CLOCK_VALID_AFTER 1735689600
#define RESERVE_SLOTS (ZC_OUTBOX_SECTOR/ZC_OUTBOX_SLOT)
static const char *TAG="TELEMETRY";
static const char format[16]="ZCHARMC-OUTBOX1";
typedef zc_sample_t sample_t;
static const esp_partition_t *partition;
static zc_outbox_t queue;
static SemaphoreHandle_t lock;
static uint8_t boot[16];
static int64_t anchor; /* Fixed UTC-minus-uptime mapping for this boot. */
static _Atomic bool storage_ready=false;
static _Atomic unsigned sample_ticks=0;
static int flash_read(void *ctx,size_t offset,void *data,size_t size) {
    return esp_partition_read(ctx,offset+ZC_OUTBOX_SECTOR,data,size)==ESP_OK ? 0 : -1;
}
static int flash_write(void *ctx,size_t offset,const void *data,size_t size) {
    return esp_partition_write(ctx,offset+ZC_OUTBOX_SECTOR,data,size)==ESP_OK ? 0 : -1;
}
static int flash_erase(void *ctx,size_t offset,size_t size) {
    return esp_partition_erase_range(ctx,offset+ZC_OUTBOX_SECTOR,size)==ESP_OK ? 0 : -1;
}
static bool open_queue(void) {
    partition=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_SPIFFS,"spiffs");
    if (!partition || partition->size<3*ZC_OUTBOX_SECTOR) return false;
    char header[sizeof(format)];
    if (esp_partition_read(partition,0,header,sizeof(header))!=ESP_OK) return false;
    if (memcmp(header,format,sizeof(format))) {
        /* First use is allowed only on an entirely erased reserved partition.
         * Never format an existing filesystem or silently discard an old queue. */
        uint8_t data[256];
        for (size_t offset=0;offset<partition->size;offset+=sizeof(data)) {
            if (esp_partition_read(partition,offset,data,sizeof(data))!=ESP_OK) return false;
            for (size_t j=0;j<sizeof(data);j++) if (data[j]!=0xff) return false;
        }
        if (esp_partition_write(partition,0,format,sizeof(format))!=ESP_OK) return false;
        if (esp_partition_read(partition,0,header,sizeof(header))!=ESP_OK || memcmp(header,format,sizeof(format))) return false;
    }
    zc_flash_t flash={.context=(void *)partition,.size=partition->size-ZC_OUTBOX_SECTOR,
        .read=flash_read,.write=flash_write,.erase=flash_erase};
    return zc_outbox_open(&queue,flash)==ZC_OUTBOX_OK;
}
static int64_t utc_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_REALTIME,&t);
    return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;
}
static double rounded(float value,unsigned decimals) {
    double scale=decimals ? 10.0 : 1.0;
    return round((double)value*scale)/scale;
}
/* Simulated: {"source":"simulated","reading":{...}} for the device test endpoint.
 * Real: the flat reading from docs/CLOUD_SETUP.md "Sensor upload contract" for
 * POST /api/ingest. The message ID is unique per node across reboots (random boot ID)
 * and identical on every retry, so the backend can deduplicate. */
static char *payload(const sample_t *r,char id[96]) {
    char hex[33],timestamp[32];
    const bool real=r->source==ZC_SOURCE_REAL;
    for (unsigned i=0;i<16;i++) snprintf(hex+2*i,3,"%02x",r->boot[i]);
    const char *profile=r->profile==1 ? "inlet" : r->profile==2 ? "outlet" : "control";
    snprintf(id,96,"%s-%s-%s-%llu",real ? "real" : "test",profile,hex,(unsigned long long)r->sequence);
    time_t seconds=(time_t)(r->utc_ms/1000); struct tm utc;
    gmtime_r(&seconds,&utc); strftime(timestamp,sizeof(timestamp),"%Y-%m-%dT%H:%M:%S",&utc);
    char exact[40]; snprintf(exact,sizeof(exact),"%s.%03uZ",timestamp,(unsigned)(r->utc_ms%1000));
    cJSON *root=cJSON_CreateObject(),*reading=real ? root : cJSON_CreateObject();
    if (!root || !reading) { cJSON_Delete(root); if (!real) cJSON_Delete(reading); return NULL; }
    if (!real && (!cJSON_AddStringToObject(root,"source","simulated") || !cJSON_AddItemToObject(root,"reading",reading))) {
        cJSON_Delete(reading); cJSON_Delete(root); return NULL;
    }
    bool ok=cJSON_AddStringToObject(reading,"node_id",profile)&&cJSON_AddStringToObject(reading,"message_id",id)
        &&cJSON_AddStringToObject(reading,"timestamp",exact);
    const char *names[]={"co2","temperature","humidity","ph","pm25","flow_rate","level","weight","no2","so2","pressure1","pressure2"};
    _Static_assert(sizeof(names)/sizeof(names[0])==ZC_FIELDS,"Measurement names must match adapter fields");
    for (unsigned i=0;i<ZC_FIELDS;i++) if (r->flags&(1u<<i))
        ok=ok&&isfinite(r->values[i])&&cJSON_AddNumberToObject(reading,names[i],rounded(r->values[i],i!=0));
    if (r->profile==3) {
        cJSON *valves=cJSON_AddObjectToObject(reading,"valves");
        cJSON *weights=cJSON_AddObjectToObject(reading,"weights");
        ok=ok&&valves&&weights&&(r->control_flags==7);
        for (unsigned i=0;ok&&i<4;i++) {
            char name[8]; snprintf(name,sizeof(name),"sv%u",i+1);
            ok=cJSON_AddBoolToObject(valves,name,(r->valve_bits&(1u<<i))!=0)!=NULL;
        }
        ok=ok&&isfinite(r->weight1_g)&&isfinite(r->weight2_g)
            &&cJSON_AddNumberToObject(weights,"weight1",rounded(r->weight1_g,1))
            &&cJSON_AddNumberToObject(weights,"weight2",rounded(r->weight2_g,1));
    }
    char *json=ok ? cJSON_PrintUnformatted(root) : NULL;
    cJSON_Delete(root); return json;
}
/* /api/ingest echoes the whole saved reading (~360 bytes in a local test); keep headroom. */
typedef struct { char body[1024]; size_t used; bool overflow; } reply_t;
static esp_err_t response_event(esp_http_client_event_t *event) {
    if (event->event_id==HTTP_EVENT_ON_DATA && event->data_len>0) {
        reply_t *r=event->user_data;
        if ((size_t)event->data_len>=sizeof(r->body)-r->used) r->overflow=true;
        else { memcpy(r->body+r->used,event->data,event->data_len); r->used+=event->data_len; r->body[r->used]=0; }
    }
    return ESP_OK;
}
/* The record may leave the queue only after the server committed exactly this reading:
 * real   -> 201/200 {"data":{..."message_id":id...},"created":bool} (CLOUD_SETUP.md)
 * simulated -> 201/200 {"accepted":true,"message_id":id,...} (device test endpoint) */
static bool acknowledged(bool real,int status,const char *body,const char *id) {
    if (status!=200 && status!=201) return false;
    cJSON *ack=cJSON_Parse(body), *message=NULL; bool accepted=false;
    if (real) {
        cJSON *data=ack ? cJSON_GetObjectItemCaseSensitive(ack,"data") : NULL;
        message=cJSON_IsObject(data) ? cJSON_GetObjectItemCaseSensitive(data,"message_id") : NULL;
        accepted=cJSON_IsBool(cJSON_GetObjectItemCaseSensitive(ack,"created"));
    } else {
        message=ack ? cJSON_GetObjectItemCaseSensitive(ack,"message_id") : NULL;
        accepted=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(ack,"accepted"));
    }
    accepted=accepted && cJSON_IsString(message) && !strcmp(message->valuestring,id);
    cJSON_Delete(ack);
    return accepted;
}
static bool deliver(const sample_t *r) {
    char id[96],url[320],auth[160]; reply_t response={0};
    const bool real=r->source==ZC_SOURCE_REAL;
    if (real && !zc_config.ingest_key[0]) {
        ESP_LOGE(TAG,"Real reading retained: no ingest key provisioned (see firmware/README.md, real-data mode)");
        return false;
    }
    char *body=payload(r,id); if (!body) return false;
    if (real) {
        snprintf(url,sizeof(url),"%s/api/ingest",zc_config.backend);
        snprintf(auth,sizeof(auth),"Bearer %s",zc_config.ingest_key);
    } else {
        snprintf(url,sizeof(url),"%s/api/devices/%s/telemetry",zc_config.backend,zc_config.device_id);
        snprintf(auth,sizeof(auth),"Bearer %s",zc_config.device_token);
    }
    esp_http_client_config_t config={.url=url,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=10000,
        .disable_auto_redirect=true,.event_handler=response_event,.user_data=&response};
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if (!client) { cJSON_free(body); return false; }
    esp_http_client_set_method(client,HTTP_METHOD_POST);
    esp_http_client_set_header(client,"Authorization",auth);
    esp_http_client_set_header(client,"Content-Type","application/json");
    esp_http_client_set_post_field(client,body,strlen(body));
    esp_err_t err=esp_http_client_perform(client);
    int status=esp_http_client_get_status_code(client);
    bool accepted=err==ESP_OK && !response.overflow && acknowledged(real,status,response.body,id);
    if (!accepted) ESP_LOGW(TAG,"%s upload unacknowledged (HTTP %d, %s)%s; record retained",real ? "Real" : "Simulated",
                            status,esp_err_to_name(err),real && status==403 ? ": ingest key rejected" : "");
    esp_http_client_cleanup(client); cJSON_free(body);
    return accepted;
}
static void sample_task(void *arg) {
    (void)arg; uint64_t sequence=0; zc_sensors_init();
    TickType_t next=xTaskGetTickCount();
    for (;;) {
        if (!zc_config.provisioned) { xTaskDelayUntil(&next,pdMS_TO_TICKS(PERIOD_MS)); continue; }
        sample_t r={.version=2,.profile=!strcmp(ZC_PROFILE,"inlet") ? 1 : !strcmp(ZC_PROFILE,"outlet") ? 2 : 3,.sequence=sequence++,
            .source=ZC_DATA_MODE==ZC_MODE_REAL ? ZC_SOURCE_REAL : ZC_SOURCE_SIMULATED};
        memcpy(r.device_id,zc_config.device_id,sizeof(zc_config.device_id));
        memcpy(r.boot,boot,sizeof(boot)); r.uptime_ms=esp_timer_get_time()/1000;
        zc_reading_t reading;
        if (zc_sensors_read_all(&reading)) {
            r.flags=reading.flags; memcpy(r.values,reading.values,sizeof(r.values));
            r.weight1_g=reading.weight1_g; r.weight2_g=reading.weight2_g;
            r.valve_bits=reading.valve_bits; r.control_flags=reading.control_flags;
            xSemaphoreTake(lock,portMAX_DELAY);
            int64_t now=utc_ms();
            if (!anchor && zc_clock_ready && now>(int64_t)CLOCK_VALID_AFTER*1000) anchor=now-esp_timer_get_time()/1000;
            if (anchor) r.utc_ms=anchor+r.uptime_ms;
            uint64_t order; int result=ZC_OUTBOX_FULL;
            /* Leave one sector for resolving pre-clock samples without dropping originals. */
            if (queue.pending<queue.slots-RESERVE_SLOTS) result=zc_outbox_put(&queue,&r,sizeof(r),0,&order);
            size_t pending=queue.pending;
            if (queue.fault) storage_ready=false;
            xSemaphoreGive(lock);
            if (result==ZC_OUTBOX_OK) ESP_LOGI(TAG,"%s sample persisted; queued=%u clock=%s",r.source ? "REAL" : "SIMULATED",(unsigned)pending,r.utc_ms?"UTC":"boot uptime only");
            else ESP_LOGE(TAG,"Sample NOT saved: %s; existing records retained",result==ZC_OUTBOX_FULL?"queue full":"storage fault");
        } else ESP_LOGW(TAG,"No valid sensor snapshot");
        sample_ticks++;
        xTaskDelayUntil(&next,pdMS_TO_TICKS(PERIOD_MS));
    }
}
static void upload_task(void *arg) {
    (void)arg; uint64_t cursor=0; unsigned failures=0; int64_t retry_at=0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        if (!storage_ready || !zc_config.provisioned || !zc_boot_ready || !zc_network_ready
                || !zc_clock_ready || time(NULL)<=CLOCK_VALID_AFTER || esp_timer_get_time()/1000<retry_at) continue;
        sample_t r; uint8_t raw[ZC_OUTBOX_PAYLOAD]; size_t size=sizeof(raw); uint64_t order=0;
        xSemaphoreTake(lock,portMAX_DELAY);
        int result=ZC_OUTBOX_FULL;
        for (unsigned skipped=0;skipped<64;skipped++) {
            size=sizeof(raw);
            result=zc_outbox_next(&queue,cursor,raw,&size,&order);
            if (result || !zc_sample_decode(raw,size,&r)) break;
            if (strcmp(r.device_id,zc_config.device_id) || (!r.utc_ms && memcmp(r.boot,boot,sizeof(boot)))) {
                cursor=order; result=ZC_OUTBOX_FULL; continue;
            }
            break;
        }
        if (result==ZC_OUTBOX_FULL) {
            /* Keep cursor while scanning retained untimed/other-device records. */
            size_t probe_size=sizeof(raw); uint64_t probe_order;
            if (zc_outbox_next(&queue,cursor,raw,&probe_size,&probe_order)==ZC_OUTBOX_FULL) cursor=0;
            xSemaphoreGive(lock); continue;
        }
        if (result || !zc_sample_decode(raw,size,&r)) {
            storage_ready=false; xSemaphoreGive(lock); ESP_LOGE(TAG,"Queue format/storage fault; no records erased"); continue;
        }
        if (!r.utc_ms) {
            if (memcmp(r.boot,boot,sizeof(boot)) || !anchor) {
                cursor=order; xSemaphoreGive(lock);
                ESP_LOGW(TAG,"Untimed sample retained for USB export; no UTC timestamp invented"); continue;
            }
            r.utc_ms=anchor+r.uptime_ms;
            result=zc_outbox_put(&queue,&r,sizeof(r),order,&order);
            if (result) { if (queue.fault) storage_ready=false; xSemaphoreGive(lock); continue; }
        }
        xSemaphoreGive(lock);
        /* TLS and server outages cannot block acquisition or Wi-Fi reconnection. */
        if (deliver(&r)) {
            xSemaphoreTake(lock,portMAX_DELAY);
            if (zc_outbox_ack(&queue,order)) storage_ready=false;
            xSemaphoreGive(lock); failures=0; cursor=0;
        } else {
            retry_at=esp_timer_get_time()/1000+zc_retry_ms(failures,esp_random());
            if (failures<5) failures++;
        }
    }
}
bool zc_telemetry_healthy(void) {
    return storage_ready && sample_ticks>0;
}
void zc_telemetry_start(void) {
    lock=xSemaphoreCreateMutex(); configASSERT(lock);
    esp_fill_random(boot,sizeof(boot));
    storage_ready=open_queue();
    if (!storage_ready) { ESP_LOGE(TAG,"Outbox unavailable; existing data not formatted or discarded"); return; }
    if (ZC_DATA_MODE==ZC_MODE_REAL)
        ESP_LOGI(TAG,"REAL sensors -> /api/ingest (%s), durable queue %u slots",zc_config.ingest_key[0] ? "ingest key present" : "NO ingest key: real readings stay queued",(unsigned)queue.slots);
    else ESP_LOGI(TAG,"SIMULATED sensors, durable queue %u slots; backend test acceptance is opt-in",(unsigned)queue.slots);
    configASSERT(xTaskCreate(sample_task,"acquisition",4096,NULL,2,NULL)==pdPASS);
    configASSERT(xTaskCreate(upload_task,"telemetry_upload",12288,NULL,1,NULL)==pdPASS);
}
