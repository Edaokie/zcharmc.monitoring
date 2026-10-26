#include "i2c_bus.h"
#include <stdbool.h>
#include "esp_log.h"

static const char *TAG="I2C";
static i2c_master_bus_handle_t bus;

esp_err_t zc_i2c_init(void) {
    if (bus) return ESP_OK;
    i2c_master_bus_config_t cfg={
        .i2c_port=-1, /* Let the driver pick a free controller. */
        .sda_io_num=ZC_I2C_SDA, .scl_io_num=ZC_I2C_SCL,
        .clk_source=I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt=7,
        /* External 4.7 kOhm pull-ups do the real work; internal ones only help if a wire is loose. */
        .flags.enable_internal_pullup=true,
    };
    esp_err_t err=i2c_new_master_bus(&cfg,&bus);
    if (err!=ESP_OK) { bus=NULL; ESP_LOGE(TAG,"Bus init failed on SDA=%d SCL=%d: %s",ZC_I2C_SDA,ZC_I2C_SCL,esp_err_to_name(err)); }
    else ESP_LOGI(TAG,"Bus ready on SDA=GPIO%d SCL=GPIO%d",ZC_I2C_SDA,ZC_I2C_SCL);
    return err;
}

i2c_master_bus_handle_t zc_i2c_bus(void) { return bus; }

static const char *known(unsigned addr) {
    switch (addr) {
        case 0x38: return " (AHT25 temp/RH)";
        case 0x62: return " (SCD41 CO2)";
        default: return "";
    }
}

int zc_i2c_scan(void) {
    if (!bus) { ESP_LOGW(TAG,"Scan skipped: bus not initialised"); return 0; }
    int found=0;
    for (unsigned addr=0x08; addr<0x78; addr++) {
        esp_err_t err=i2c_master_probe(bus,addr,50);
        if (err==ESP_OK) { ESP_LOGI(TAG,"Device found at 0x%02X%s",addr,known(addr)); found++; }
        else if (err==ESP_ERR_TIMEOUT) { /* No ACK/NACK at all: lines are not being pulled high. */
            ESP_LOGE(TAG,"Bus timeout at 0x%02X: check pull-ups, 3V3 and that SDA/SCL are not shorted to GND",addr);
            return found;
        }
    }
    if (found) ESP_LOGI(TAG,"Scan done: %d device(s)",found);
    else ESP_LOGW(TAG,"Scan done: no devices. Check 3V3/GND, SDA=GPIO%d, SCL=GPIO%d and pull-ups",ZC_I2C_SDA,ZC_I2C_SCL);
    return found;
}
