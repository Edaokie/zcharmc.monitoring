#include "outbox.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#define MAGIC 0x5a435131u
#define PENDING 0xfffffffeu
#define ACKED 0xfffffffcu
#define EMPTY 0u
#define LIVE 1u
#define USED 2u
#define PER_SECTOR (ZC_OUTBOX_SECTOR / ZC_OUTBOX_SLOT)
typedef struct {
    uint32_t magic, length;
    uint64_t order, supersedes;
    uint8_t payload[ZC_OUTBOX_PAYLOAD];
    uint32_t crc, state;
} record_t;
_Static_assert(sizeof(record_t) == ZC_OUTBOX_SLOT, "Outbox format changed");
static uint32_t crc32(const void *data, size_t size) {
    uint32_t crc=UINT32_MAX;
    const uint8_t *p=data;
    while (size--) {
        crc ^= *p++;
        for (unsigned b=0;b<8;b++) crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);
    }
    return ~crc;
}
static int fail(zc_outbox_t *q) { q->fault=true; return ZC_OUTBOX_ERROR; }
static bool valid(const record_t *r) {
    return r->magic==MAGIC && r->length>0 && r->length<=ZC_OUTBOX_PAYLOAD && r->order>0
        && r->supersedes<r->order && (r->state==PENDING || r->state==ACKED)
        && r->crc==crc32(r,offsetof(record_t,crc));
}
static int read_record(zc_outbox_t *q,size_t i,record_t *r) {
    return q->flash.read(q->flash.context,i*ZC_OUTBOX_SLOT,r,sizeof(*r)) ? fail(q) : ZC_OUTBOX_OK;
}
void zc_outbox_close(zc_outbox_t *q) {
    free(q->states); free(q->orders); memset(q,0,sizeof(*q));
}
int zc_outbox_open(zc_outbox_t *q, zc_flash_t flash) {
    memset(q,0,sizeof(*q)); q->flash=flash;
    if (!flash.size || flash.size%ZC_OUTBOX_SECTOR || !flash.read || !flash.write || !flash.erase) return fail(q);
    q->slots=flash.size/ZC_OUTBOX_SLOT;
    q->states=calloc(q->slots,1); q->orders=calloc(q->slots,sizeof(uint64_t));
    if (!q->states || !q->orders) return fail(q);
    q->next_order=1;
    record_t r;
    for (size_t i=0;i<q->slots;i++) {
        if (read_record(q,i,&r)) return ZC_OUTBOX_ERROR;
        bool erased=true;
        for (size_t j=0;j<sizeof(r);j++) if (((uint8_t *)&r)[j]!=0xff) { erased=false; break; }
        if (erased) continue;
        q->states[i]=USED;
        if (r.state!=PENDING && r.state!=ACKED) continue; /* Uncommitted torn write. */
        if (r.state==ACKED && !valid(&r)) continue; /* Interrupted reclaim of acknowledged data. */
        if (!valid(&r) || r.order==UINT64_MAX) return fail(q); /* Never silently erase committed corruption. */
        q->orders[i]=r.order;
        if (r.state==PENDING) { q->states[i]=LIVE; q->pending++; }
        if (r.order>=q->next_order) { q->next_order=r.order+1; q->next_slot=(i+1)%q->slots; }
    }
    /* A timestamp-resolution copy is committed before its source is acknowledged.
     * Recover that ordering if power stopped between the two writes. */
    for (size_t i=0;i<q->slots;i++) if (q->orders[i]) {
        if (read_record(q,i,&r)) return ZC_OUTBOX_ERROR;
        if (r.supersedes && zc_outbox_ack(q,r.supersedes)) return ZC_OUTBOX_ERROR;
    }
    return ZC_OUTBOX_OK;
}
int zc_outbox_ack(zc_outbox_t *q,uint64_t order) {
    if (q->fault) return ZC_OUTBOX_ERROR;
    for (size_t i=0;i<q->slots;i++) if (q->states[i]==LIVE && q->orders[i]==order) {
        uint32_t state=ACKED,check=0;
        size_t offset=i*ZC_OUTBOX_SLOT+offsetof(record_t,state);
        if (q->flash.write(q->flash.context,offset,&state,sizeof(state))
            || q->flash.read(q->flash.context,offset,&check,sizeof(check)) || check!=ACKED) return fail(q);
        q->states[i]=USED; q->pending--; return ZC_OUTBOX_OK;
    }
    return ZC_OUTBOX_OK; /* Already acknowledged or reclaimed. */
}
int zc_outbox_put(zc_outbox_t *q,const void *payload,size_t length,uint64_t supersedes,uint64_t *order) {
    if (q->fault || !length || length>ZC_OUTBOX_PAYLOAD || q->next_order==UINT64_MAX) return ZC_OUTBOX_ERROR;
    if (supersedes) {
        bool found=false;
        for (size_t i=0;i<q->slots;i++) if (q->states[i]==LIVE && q->orders[i]==supersedes) found=true;
        if (!found) return ZC_OUTBOX_ERROR;
    }
    for (size_t n=0;n<q->slots;n++) {
        size_t i=(q->next_slot+n)%q->slots;
        if (q->states[i]==LIVE) continue;
        if (q->states[i]==USED) {
            size_t first=(i/PER_SECTOR)*PER_SECTOR;
            bool live=false;
            for (size_t j=first;j<first+PER_SECTOR;j++) if (q->states[j]==LIVE) live=true;
            if (live) continue;
            if (q->flash.erase(q->flash.context,first*ZC_OUTBOX_SLOT,ZC_OUTBOX_SECTOR)) return fail(q);
            memset(q->states+first,EMPTY,PER_SECTOR);
            memset(q->orders+first,0,PER_SECTOR*sizeof(uint64_t));
        }
        record_t r; memset(&r,0,sizeof(r));
        r.magic=MAGIC; r.length=(uint32_t)length; r.order=q->next_order;
        r.supersedes=supersedes; memcpy(r.payload,payload,length);
        r.crc=crc32(&r,offsetof(record_t,crc)); r.state=UINT32_MAX;
        size_t offset=i*ZC_OUTBOX_SLOT;
        if (q->flash.write(q->flash.context,offset,&r,offsetof(record_t,state))) return fail(q);
        record_t check;
        if (read_record(q,i,&check) || memcmp(&r,&check,offsetof(record_t,state))) return fail(q);
        r.state=PENDING;
        if (q->flash.write(q->flash.context,offset+offsetof(record_t,state),&r.state,sizeof(r.state))) return fail(q);
        if (read_record(q,i,&check) || !valid(&check) || check.state!=PENDING) return fail(q);
        q->states[i]=LIVE; q->orders[i]=r.order; q->pending++;
        q->next_order++; q->next_slot=(i+1)%q->slots; *order=r.order;
        if (supersedes && zc_outbox_ack(q,supersedes)) return ZC_OUTBOX_ERROR;
        return ZC_OUTBOX_OK;
    }
    return ZC_OUTBOX_FULL;
}
int zc_outbox_next(zc_outbox_t *q,uint64_t after,void *payload,size_t *length,uint64_t *order) {
    if (q->fault) return ZC_OUTBOX_ERROR;
    size_t selected=q->slots; uint64_t oldest=UINT64_MAX;
    for (size_t i=0;i<q->slots;i++) if (q->states[i]==LIVE && q->orders[i]>after && q->orders[i]<oldest) {
        oldest=q->orders[i]; selected=i;
    }
    if (selected==q->slots) return ZC_OUTBOX_FULL;
    record_t r;
    if (read_record(q,selected,&r) || !valid(&r) || r.state!=PENDING || r.length>*length) return fail(q);
    memcpy(payload,r.payload,r.length); *length=r.length; *order=r.order;
    return ZC_OUTBOX_OK;
}
