# Explicit sources: legacy Arduino files remain reference-only and are not built.
idf_component_register(
    SRCS "idf/main.c" "idf/config.c" "idf/ota.c"
    INCLUDE_DIRS "idf" "${CMAKE_CURRENT_BINARY_DIR}"
    REQUIRES esp_wifi esp_netif esp_event nvs_flash esp_http_client app_update
             esp_timer esp_driver_gpio mbedtls espressif__cjson esp_system
)

if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    file(READ "${CMAKE_CURRENT_LIST_DIR}/../keys/release-public.pem" RELEASE_KEY)
    string(REPLACE "\n" "\\n" RELEASE_KEY "${RELEASE_KEY}")
    configure_file("${CMAKE_CURRENT_LIST_DIR}/idf/release_key.h.in" "${CMAKE_CURRENT_BINARY_DIR}/release_key.h" @ONLY)
endif()
