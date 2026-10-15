#pragma once
/* Portable flash outbox. All offsets are relative to an existing data partition.
 * Caller serializes access. Never erase a sector containing an unacknowledged record. */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define ZC_OUTBOX_SLOT 256u
#define ZC_OUTBOX_SECTOR 4096u
#define ZC_OUTBOX_PAYLOAD 224u
#define ZC_OUTBOX_OK 0
#define ZC_OUTBOX_FULL 1
#define ZC_OUTBOX_ERROR -1

typedef struct {
    void *context;
    size_t size;
    int (*read)(void *, size_t, void *, size_t);
    int (*write)(void *, size_t, const void *, size_t);
    int (*erase)(void *, size_t, size_t);
} zc_flash_t;
typedef struct {
    zc_flash_t flash;
    uint8_t *states;
    uint64_t *orders;
    size_t slots, next_slot, pending;
    uint64_t next_order;
    bool fault;
} zc_outbox_t;
int zc_outbox_open(zc_outbox_t *, zc_flash_t);
void zc_outbox_close(zc_outbox_t *);
int zc_outbox_put(zc_outbox_t *, const void *, size_t, uint64_t supersedes, uint64_t *order);
/* Returns FULL when no pending record follows after. */
int zc_outbox_next(zc_outbox_t *, uint64_t after, void *, size_t *, uint64_t *order);
int zc_outbox_ack(zc_outbox_t *, uint64_t order);
