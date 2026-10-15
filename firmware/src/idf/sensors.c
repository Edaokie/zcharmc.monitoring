#include "sensors.h"
#include <string.h>
#ifndef ZC_PROFILE
#error "Select inlet, outlet or control"
#endif
/* Deliberate test fixtures, not sensor specifications, calibration or setpoints.
 * Replace this adapter with actual drivers later; retain the acquisition interface. */
void zc_sensors_init(void) {}
bool zc_sensors_read_all(zc_reading_t *out) {
    memset(out,0,sizeof(*out));
    if (!strcmp(ZC_PROFILE,"control")) {
        out->control_flags=7; /* valve states and both weights known. */
        out->valve_bits=0; /* sv1..sv4 logically closed; outputs remain unconfigured. */
        out->weight1_g=1000; out->weight2_g=2000;
        return true;
    }
    const bool inlet=!strcmp(ZC_PROFILE,"inlet");
    bool outlet = strcmp(ZC_PROFILE,"outlet") == 0;
    if (!inlet && !outlet) return false;
    const float incoming[ZC_FIELDS]={4000,29,63,7,30,1,0,1000,0.2f,0.3f,12,10};
    const float outgoing[ZC_FIELDS]={800,29,63,8,12,1,50,900,0.1f,0.1f,10,8};
    memcpy(out->values,inlet?incoming:outgoing,sizeof(out->values));
    out->flags=(1u<<ZC_FIELDS)-1;
    if (inlet) out->flags &= ~(1u<<ZC_LEVEL); /* No inlet level fixture. */
    return true;
}
