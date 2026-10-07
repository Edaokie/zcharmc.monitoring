#include "zc.h"
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <limits.h>
#include <time.h>
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "mbedtls/pk.h"
#include "psa/crypto.h"

#include "release_key.h"
static const char *TAG="OTA";

static bool asset_url(const char *url) {
    if (strncmp(url,"https://",8)) return false;
    const char *start=url+8,*end=strchr(start,'/');
    if (!end) return false;
    size_t len=(size_t)(end-start);
    const char *hosts[]={"github.com","objects.githubusercontent.com","release-assets.githubusercontent.com"};
    for (unsigned i=0;i<sizeof(hosts)/sizeof(hosts[0]);++i)
        if (strlen(hosts[i])==len && !strncmp(start,hosts[i],len)) return true;
    return false;
}

static bool verify_hash(const unsigned char hash[32], const unsigned char *signature, size_t size) {
    if (size!=384) return false;
    mbedtls_pk_context key; mbedtls_pk_init(&key);
    int result=mbedtls_pk_parse_public_key(&key,release_key,sizeof(release_key));
    psa_key_attributes_t attributes=PSA_KEY_ATTRIBUTES_INIT;
    mbedtls_svc_key_id_t id=MBEDTLS_SVC_KEY_ID_INIT;
    if (!result && mbedtls_pk_get_bitlen(&key)==3072) {
        result=mbedtls_pk_get_psa_attributes(&key,PSA_KEY_USAGE_VERIFY_HASH,&attributes);
        psa_set_key_algorithm(&attributes,PSA_ALG_RSA_PSS(PSA_ALG_SHA_256));
        if (!result) result=mbedtls_pk_import_into_psa(&key,&attributes,&id);
        if (!result) result=psa_verify_hash(id,PSA_ALG_RSA_PSS(PSA_ALG_SHA_256),hash,32,signature,size);
    } else result=-1;
    psa_destroy_key(id);
    psa_reset_key_attributes(&attributes);
    mbedtls_pk_free(&key);
    return result==0;
}

static esp_err_t capture_redirect(esp_http_client_event_t *event) {
    if (event->event_id==HTTP_EVENT_ON_HEADER && event->user_data && !strcasecmp(event->header_key,"Location")) {
        char *location=event->user_data;
        if (strlen(event->header_value)<2048) strcpy(location,event->header_value);
    }
    return ESP_OK;
}

static esp_http_client_handle_t open_url(const char *url, bool authenticated) {
    char location[2048]={0};
    esp_http_client_config_t config={.event_handler=capture_redirect,.user_data=location,.url=url,.crt_bundle_attach=esp_crt_bundle_attach,
        .timeout_ms=15000,.disable_auto_redirect=true,.buffer_size=4096};
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if (!client) return NULL;
    if (authenticated) {
        char auth[160]; snprintf(auth,sizeof(auth),"Bearer %s",zc_config.device_token);
        esp_http_client_set_header(client,"Authorization",auth);
    }
    for (int redirects=0;redirects<5;++redirects) {
        location[0]=0;
        if (esp_http_client_open(client,0)!=ESP_OK || esp_http_client_fetch_headers(client)<0) break;
        int status=esp_http_client_get_status_code(client);
        if (status==200 || (authenticated && status==204)) { esp_http_client_set_user_data(client,NULL); return client; }
        if (authenticated || !(status==301||status==302||status==303||status==307||status==308)) break;
        if (!asset_url(location)) break;
        // Follow only HTTPS allowlisted redirects; credentials are never attached to assets.
        esp_http_client_close(client);
        if (esp_http_client_set_url(client,location)!=ESP_OK) break;
    }
    esp_http_client_cleanup(client);
    return NULL;
}

static int get_small(const char *url, bool authenticated, unsigned char *buffer, size_t capacity) {
    esp_http_client_handle_t client=open_url(url,authenticated);
    if (!client) return -1;
    if (esp_http_client_get_status_code(client)==204) { esp_http_client_cleanup(client); return 0; }
    size_t total=0; int count;
    while (total<capacity && (count=esp_http_client_read(client,(char *)buffer+total,capacity-total))>0) total+=count;
    bool complete=esp_http_client_is_complete_data_received(client);
    esp_http_client_cleanup(client);
    return complete && total<capacity ? (int)total : -1;
}

void zc_report(void) {
    char url[320],auth[160],body[256];
    snprintf(url,sizeof(url),"%s/api/devices/%s/report",zc_config.backend,zc_config.device_id);
    snprintf(auth,sizeof(auth),"Bearer %s",zc_config.device_token);
    snprintf(body,sizeof(body),"{\"version\":\"%s\",\"status\":\"%s\",\"maintenance\":%s}",
        esp_app_get_description()->version,zc_status,zc_maintenance?"true":"false");
    esp_http_client_config_t config={.url=url,.crt_bundle_attach=esp_crt_bundle_attach,.timeout_ms=10000,.disable_auto_redirect=true};
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if (!client) return;
    esp_http_client_set_method(client,HTTP_METHOD_POST);
    esp_http_client_set_header(client,"Authorization",auth);
    esp_http_client_set_header(client,"Content-Type","application/json");
    esp_http_client_set_post_field(client,body,strlen(body));
    esp_http_client_perform(client);
    esp_http_client_cleanup(client);
}

static const char *string_field(cJSON *root,const char *name) {
    cJSON *value=cJSON_GetObjectItemCaseSensitive(root,name);
    return cJSON_IsString(value) ? value->valuestring : NULL;
}

static bool install(cJSON *root) {
    const char *raw=string_field(root,"manifest"),*encoded=string_field(root,"signature"),*base=string_field(root,"base_url");
    cJSON *generation=cJSON_GetObjectItemCaseSensitive(root,"generation");
    if (!raw||!encoded||!base||!asset_url(base)||strlen(raw)>4096||!cJSON_IsNumber(generation)
        ||generation->valuedouble<1||generation->valuedouble>UINT32_MAX
        ||generation->valuedouble!=(uint32_t)generation->valuedouble) return false;
    uint32_t approved=(uint32_t)generation->valuedouble,last=0;
    nvs_get_u32(zc_nvs,"attempt_gen",&last);
    if (approved<=last) return true;
    unsigned char digest[32],signature[385]; size_t written=0;
    if (psa_hash_compute(PSA_ALG_SHA_256,(const uint8_t *)raw,strlen(raw),digest,sizeof(digest),&written)!=PSA_SUCCESS) return false;
    // Base64 decode through mbedTLS; manifest signature is checked before using metadata.
    extern int mbedtls_base64_decode(unsigned char *,size_t,size_t *,const unsigned char *,size_t);
    if (mbedtls_base64_decode(signature,sizeof(signature),&written,(const unsigned char *)encoded,strlen(encoded))
        ||!verify_hash(digest,signature,written)) return false;
    cJSON *manifest=cJSON_Parse(raw);
    if (!manifest) return false;
    const char *profile=string_field(manifest,"profile"),*hardware=string_field(manifest,"hardware"),
        *version=string_field(manifest,"version"),*image=string_field(manifest,"image"),*sha=string_field(manifest,"sha256");
    cJSON *schema=cJSON_GetObjectItemCaseSensitive(manifest,"schema"),*size=cJSON_GetObjectItemCaseSensitive(manifest,"size");
    char expected_image[32]; snprintf(expected_image,sizeof(expected_image),"%s.bin",ZC_PROFILE);
    const esp_partition_t *partition=esp_ota_get_next_update_partition(NULL);
    bool compatible=profile&&hardware&&version&&image&&sha&&schema&&cJSON_IsNumber(schema)&&schema->valuedouble==1
        &&!strcmp(profile,ZC_PROFILE)&&!strcmp(hardware,ZC_HARDWARE)&&!strcmp(image,expected_image)
        &&strlen(version)>0&&strlen(version)<=31&&strlen(sha)==64&&partition&&cJSON_IsNumber(size)
        &&size->valuedouble>0&&size->valuedouble<=partition->size&&size->valuedouble==(uint32_t)size->valuedouble;
    if (!compatible) { cJSON_Delete(manifest); return false; }
    if (!strcmp(version,esp_app_get_description()->version)) { cJSON_Delete(manifest); return true; }
    if (!strcmp(ZC_PROFILE,"control") && (!zc_maintenance||!zc_control_health())) { cJSON_Delete(manifest); return true; }
    char url[512];
    snprintf(url,sizeof(url),"%s/%s.sig",base,image);
    int signature_size=get_small(url,false,signature,sizeof(signature));
    if (signature_size!=384) { cJSON_Delete(manifest); return false; }
    snprintf(url,sizeof(url),"%s/%s",base,image);
    esp_http_client_handle_t client=open_url(url,false);
    if (!client) { cJSON_Delete(manifest); return false; }
    esp_ota_handle_t handle=0; bool begun=false,ended=false,ok=false;
    psa_hash_operation_t hash=PSA_HASH_OPERATION_INIT;
    unsigned char buffer[4096]; size_t total=0;
    zc_updating=true; zc_status="updating";
    if (esp_ota_begin(partition,(size_t)size->valuedouble,&handle)!=ESP_OK) goto cleanup;
    begun=true;
    if (psa_hash_setup(&hash,PSA_ALG_SHA_256)!=PSA_SUCCESS) goto cleanup;
    for (;;) {
        int count=esp_http_client_read(client,(char *)buffer,sizeof(buffer));
        if (count<0) goto cleanup;
        if (!count) break;
        if (total+(size_t)count>(size_t)size->valuedouble) goto cleanup;
        if (esp_ota_write(handle,buffer,count)!=ESP_OK||psa_hash_update(&hash,buffer,count)!=PSA_SUCCESS) goto cleanup;
        total+=count;
    }
    if (!esp_http_client_is_complete_data_received(client)||total!=(size_t)size->valuedouble) goto cleanup;
    if (psa_hash_finish(&hash,digest,sizeof(digest),&written)!=PSA_SUCCESS) goto cleanup;
    char actual[65]; for (int i=0;i<32;++i) snprintf(actual+2*i,3,"%02x",digest[i]);
    if (strcmp(actual,sha)||!verify_hash(digest,signature,signature_size)) goto cleanup;
    // esp_ota_end validates the ESP application image before it can be selected.
    esp_err_t finish=esp_ota_end(handle); ended=true;
    if (finish!=ESP_OK) goto cleanup;
    esp_app_desc_t description;
    if (esp_ota_get_partition_description(partition,&description)!=ESP_OK||strcmp(description.version,version)||strcmp(description.project_name,"zcharmc-" ZC_PROFILE)) goto cleanup;
    if (!strcmp(ZC_PROFILE,"control")&&(!zc_maintenance||!zc_control_health())) goto cleanup;
    if (nvs_set_u32(zc_nvs,"attempt_gen",approved)!=ESP_OK||nvs_set_str(zc_nvs,"attempt_ver",version)!=ESP_OK||nvs_commit(zc_nvs)!=ESP_OK) goto cleanup;
    if (esp_ota_set_boot_partition(partition)!=ESP_OK) goto cleanup;
    ok=true;
cleanup:
    if (begun&&!ended) esp_ota_abort(handle);
    psa_hash_abort(&hash);
    esp_http_client_cleanup(client);
    cJSON_Delete(manifest);
    zc_updating=false;
    if (ok) { ESP_LOGI(TAG,"Verified approved image; rebooting into pending verification"); esp_restart(); }
    zc_status="failed";
    return false;
}

void zc_ota_poll(void) {
    char url[320];
    snprintf(url,sizeof(url),"%s/api/devices/%s/ota",zc_config.backend,zc_config.device_id);
    unsigned char *body=calloc(1,8193);
    if (!body) return;
    int size=get_small(url,true,body,8192);
    if (size>0) {
        cJSON *root=cJSON_Parse((char *)body);
        if (!root||!install(root)) ESP_LOGW(TAG,"Update rejected or download interrupted; current app retained");
        cJSON_Delete(root);
    }
    free(body);
}
