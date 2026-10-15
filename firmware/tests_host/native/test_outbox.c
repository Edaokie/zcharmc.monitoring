#include "outbox.h"
#include "retry.h"
#include "sample.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#define CAP (ZC_OUTBOX_SECTOR*2)
static unsigned char flash[CAP];
static long remaining=-1;
static int reads(void *ctx,size_t off,void *data,size_t n) {
    (void)ctx; assert(off+n<=CAP); memcpy(data,flash+off,n); return 0;
}
static int writes(void *ctx,size_t off,const void *data,size_t n) {
    (void)ctx; assert(off+n<=CAP); const unsigned char *p=data;
    for (size_t i=0;i<n;i++) {
        if (!remaining) return -1;
        assert((flash[off+i]&p[i])==p[i]);
        flash[off+i]&=p[i]; if (remaining>0) remaining--;
    }
    return 0;
}
static int erases(void *ctx,size_t off,size_t n) {
    (void)ctx; assert(off%4096==0 && n==4096);
    for (size_t i=0;i<n;i++) {
        if (!remaining) return -1;
        flash[off+i]=255; if (remaining>0) remaining--;
    }
    return 0;
}
static void openq(zc_outbox_t *q) {
    remaining=-1;
    assert(zc_outbox_open(q,(zc_flash_t){.size=CAP,.read=reads,.write=writes,.erase=erases})==0);
}
static void reset(void) { memset(flash,255,sizeof(flash)); remaining=-1; }
static uint64_t put(zc_outbox_t *q,const char *text,uint64_t parent) {
    uint64_t order; assert(zc_outbox_put(q,text,strlen(text)+1,parent,&order)==0); return order;
}
static uint64_t next(zc_outbox_t *q,const char *expected) {
    char text[224]; size_t size=sizeof(text); uint64_t order;
    assert(zc_outbox_next(q,0,text,&size,&order)==0);
    assert(size==strlen(expected)+1 && !strcmp(text,expected)); return order;
}
static void persistence(void) {
    reset(); zc_outbox_t q; openq(&q); uint64_t a=put(&q,"original timestamp + stable id",0);
    zc_outbox_close(&q); openq(&q); assert(q.pending==1);
    assert(next(&q,"original timestamp + stable id")==a);
    /* A lost HTTP acknowledgement must leave the identical reading available. */
    assert(next(&q,"original timestamp + stable id")==a);
    assert(zc_outbox_ack(&q,a)==0); zc_outbox_close(&q); openq(&q); assert(q.pending==0); zc_outbox_close(&q);
}
static void full_and_reclaim(void) {
    reset(); zc_outbox_t q; openq(&q); uint64_t ids[32],order;
    for (unsigned i=0;i<32;i++) ids[i]=put(&q,"retained",0);
    assert(zc_outbox_put(&q,"new",4,0,&order)==ZC_OUTBOX_FULL);
    assert(q.pending==32); assert(next(&q,"retained")==ids[0]);
    /* An acknowledged hole must not erase a sector containing live neighbours. */
    assert(zc_outbox_ack(&q,ids[0])==0);
    assert(zc_outbox_put(&q,"new",4,0,&order)==ZC_OUTBOX_FULL);
    for (unsigned i=1;i<16;i++) assert(zc_outbox_ack(&q,ids[i])==0);
    assert(put(&q,"after wrap",0)>ids[31]);
    zc_outbox_close(&q); openq(&q); assert(q.pending==17);
    assert(next(&q,"retained")==ids[16]); zc_outbox_close(&q);
}
static void torn_append(void) {
    for (long cut=0;cut<=256;cut++) {
        reset(); zc_outbox_t q; openq(&q); put(&q,"first committed",0);
        uint64_t order; remaining=cut;
        zc_outbox_put(&q,"second complete",16,0,&order);
        zc_outbox_close(&q); openq(&q);
        assert(q.pending==1 || q.pending==2);
        uint64_t first=next(&q,"first committed"); zc_outbox_ack(&q,first);
        if (q.pending) next(&q,"second complete");
        zc_outbox_close(&q);
    }
}
static void torn_resolution(void) {
    for (long cut=0;cut<=260;cut++) {
        reset(); zc_outbox_t q; openq(&q); uint64_t original=put(&q,"boot uptime only",0),order;
        remaining=cut; zc_outbox_put(&q,"resolved original UTC",22,original,&order);
        zc_outbox_close(&q); openq(&q);
        assert(q.pending==1);
        char text[224]; size_t n=sizeof(text);
        assert(zc_outbox_next(&q,0,text,&n,&order)==0);
        assert(!strcmp(text,"boot uptime only") || !strcmp(text,"resolved original UTC"));
        zc_outbox_close(&q);
    }
}
static void torn_ack(void) {
    for (long cut=0;cut<=4;cut++) {
        reset(); zc_outbox_t q; openq(&q); uint64_t id=put(&q,"accepted upstream",0);
        remaining=cut; zc_outbox_ack(&q,id);
        zc_outbox_close(&q); openq(&q); assert(q.pending<=1);
        if (q.pending) next(&q,"accepted upstream");
        zc_outbox_close(&q);
    }
}
static void torn_reclaim(void) {
    for (long cut=0;cut<=4096;cut+=16) {
        reset(); zc_outbox_t q; openq(&q); uint64_t ids[32],order;
        for (unsigned i=0;i<32;i++) ids[i]=put(&q,"record",0);
        for (unsigned i=0;i<16;i++) zc_outbox_ack(&q,ids[i]);
        remaining=cut; zc_outbox_put(&q,"later",6,0,&order);
        zc_outbox_close(&q); openq(&q);
        assert(q.pending==16); assert(next(&q,"record")==ids[16]);
        zc_outbox_close(&q);
    }
}
static void corruption(void) {
    reset(); zc_outbox_t q; openq(&q); put(&q,"never silently erase",0); zc_outbox_close(&q);
    flash[40]^=1;
    assert(zc_outbox_open(&q,(zc_flash_t){.size=CAP,.read=reads,.write=writes,.erase=erases})==ZC_OUTBOX_ERROR);
    assert(q.fault); zc_outbox_close(&q);
}
static void retry(void) {
    uint32_t previous=0;
    for (unsigned i=0;i<100;i++) {
        uint32_t delay=zc_retry_ms(i,123456789);
        assert(delay>=2000 && delay<=60000 && delay>=previous); previous=delay;
    }
}
static void fixture(const char *path) {
    reset(); zc_outbox_t q; openq(&q);
    zc_sample_t sample={.version=1,.flags=3,.sequence=7,.uptime_ms=15000,.utc_ms=1760000000123LL,.co2=4000,.temperature=29.25f,.profile=1};
    strcpy(sample.device_id,"bench-inlet");
    uint64_t order;
    assert(zc_outbox_put(&q,&sample,sizeof(sample),0,&order)==0);
    unsigned char header[4096]; memset(header,255,sizeof(header));
    memcpy(header,"ZCHARMC-OUTBOX1",16);
    FILE *file=fopen(path,"wb"); assert(file);
    assert(fwrite(header,1,sizeof(header),file)==sizeof(header));
    assert(fwrite(flash,1,sizeof(flash),file)==sizeof(flash)); fclose(file);
    zc_outbox_close(&q);
}
int main(int argc,char **argv) {
    persistence(); full_and_reclaim(); torn_append(); torn_resolution(); torn_ack(); torn_reclaim(); corruption(); retry();
    if (argc>1) fixture(argv[1]);
    puts("Native outbox: persistence, replay, capacity, reclaim, corruption, backoff and 780 power-cut boundaries passed");
}
