# Static bench test record: inlet-01 and outlet-01

Physical results for the [three-board static bench guide](FIRMWARE_STATIC_BENCH.md)
and the [Wi-Fi outage guide](FIRMWARE_WIFI_RECOVERY.md), run on real ESP32 boards
against the deployed Railway backend. Values are simulated fixtures
(`source: simulated`, stored as `DeviceTestReading`); this record says nothing about
sensor accuracy, wiring or control safety. OTA acceptance is recorded separately in
[OTA_TEST_RECORD.md](OTA_TEST_RECORD.md).

No credentials, provisioning JSON, Wi-Fi names/passwords or tokens are recorded here.

## Session and environment

| Field | Value |
| --- | --- |
| Tester / dates / timezone | Edrian Abilay / 2026-10-16 to 2026-10-20 / Asia/Manila (UTC+8); admin times are UTC |
| Firmware | `develop` at `709a7a6` ("prepared for static test"), USB `-t upload`, version `0.0.0-dev` |
| Toolchain | PlatformIO, native ESP-IDF 6.0.1; Firmware CI #23 on `709a7a6` passed |
| Boards | 2 × 30-pin ESP32 DevKit (ESP-WROOM-32, CP2102 USB bridge), 4 MB flash |
| Device IDs / roles | `inlet-01` / inlet, `outlet-01` / outlet. `control-01` **not tested** |
| Network | 2.4 GHz phone hotspot (main), second phone hotspot with the same SSID for the no-internet test |
| Backend | Railway production; devices enabled with **Allow test telemetry** |
| Equipment | No sensors, actuators or relays connected |

## Results

| # | Test (bench guide §5 / outage guide steps) | Result | Date | Evidence / observation |
| --- | --- | --- | --- | --- |
| 1 | Powered: fixture values, message IDs advance every 15 s | PASS | Oct 16 | Admin rows per device; inlet CO₂ 4000, outlet CO₂ 800 as fixtures |
| 2 | Cold boot without internet, internet restored in same boot | PASS (inlet) | Oct 16 | Log `boot uptime only` → `clock=UTC` after SNTP; samples uploaded with resolved UTC |
| 3 | Wi-Fi outage, queue growth, automatic recovery, original times | PASS (inlet) | Oct 16 | ~2 h hotspot outage, queue reached 446, no reboot, drained after reconnect with original measurement times |
| 4 | Power cycle after clock sync: committed samples survive | PASS (inlet) | Oct 16–19 | Many cycles incl. ~3 days unpowered: 200 queued before, present after |
| 5 | Untimed samples from an unsynchronized boot are kept, not given invented UTC | PASS (inlet) | Oct 19 | Read-only USB export found 49 records with `timestamp: null`; none uploaded |
| 6 | Wi-Fi on, internet off; recovery; no duplicates | PASS (both) | Oct 20 | Details below |
| 7 | `/bench` page shows the boards' cards | PASS | Oct 19 | Inlet and outlet cards shown (staff account with firmware permission) |
| 8 | Research charts and `Reading` rows unaffected | PASS | Oct 19 | Live dashboard showed no simulated values; simulated rows only in Device test readings |
| 9 | Three-board five-minute run | NOT RUN | — | Only two boards; control not tested |
| 10 | Lost acknowledgement, full storage, interrupted writes (outage guide step 9) | NOT RUN | — | Needs a dedicated test fixture; covered by host tests only |
| 11 | Signed OTA release, interrupted OTA, rollback (bench guide §5 step 5) | NOT RUN | — | Deferred 2026-10-20: no signed release published yet; see OTA_TEST_RECORD.md |

### Test 6 detail: Wi-Fi on, internet off (2026-10-20)

Boot IDs: inlet `b7a9e8c9…`, outlet `248eaa0b…`. The second hotspot shared the main
hotspot's SSID and password, so the boards moved between them without reprovisioning.

| Time (UTC) | Event | Observation |
| --- | --- | --- |
| ~06:41 | Main hotspot off | `Disconnected (reason=200)`; in-flight upload failed, record retained; joined the second hotspot in < 1 s |
| 06:41–06:49 | Wi-Fi up, internet off | DNS failures (`getaddrinfo() returns 202`, `ESP_ERR_HTTP_CONNECT`); every sample retained; retry backoff 5 → 9 → 19 → 24 → 60 s; queue inlet 1 → ~35, outlet 12 → 46; no reboot, no HTTP 4xx |
| ~06:49 | Internet restored | Hotspot changed channel twice (1 → 11 → 6); both boards followed without disconnecting; first upload accepted at the next retry (~40 s) |
| 06:49–06:59 | Queue drain | About one reading per 7 s per board; back to baseline (inlet `queued=1`, outlet `queued=12`) after ~11 min |
| 06:49–06:54 | Admin check | Sequence #147–#179 present once for each device: no gaps, no duplicates, oldest first |
| — | Original time check | `test-outlet-…-160`: payload timestamp **06:44:32.745Z** (during outage), **Received at 06:51Z**. Matches #224 at 07:00:32.745Z minus 64 × 15 s exactly |
| ~07:00 | Main hotspot back, second off | `Disconnected (reason=1)`, rejoined < 1 s; one upload cut mid-send (`-0x004E`), retained and sent on retry; SNTP re-synced |

## Incident: inlet-01 HTTP 403 (2026-10-16 to 2026-10-19)

- **Cause:** on Oct 16 (~16:33–16:47 Manila) the outlet build was uploaded to the inlet
  board by mistake; USB port names had swapped after replugging. 55 samples with
  `node_id: "outlet"` were stored in the inlet outbox.
- **Effect:** on Oct 19 the queue reached them. The backend correctly rejected them
  (node_id ≠ device profile, HTTP 403). The firmware retries 4xx indefinitely, so the
  whole queue stopped and grew to ~500.
- **Fix:** following "Read-only USB recovery export" in the outage guide: `read_flash`
  of the outbox partition (`0x350000`, size `0xB0000`) at 115200 baud, decoded with
  `dump_outbox.py` (506 records: 55 outlet-role, 49 untimed), backup kept privately,
  then `erase_region 0x350000 0xB0000` only. NVS and provisioning were untouched.
  Inlet returned to `queued=1` with uploads accepted.
- **Data cost:** 451 valid simulated readings were not uploaded; they remain in the
  private export.
- **Prevention used since:** read each board's MAC address before every upload,
  erase or dump (both CP2102 bridges report the same serial number, so port names
  change with plug order).

## Other observations

- **Bad USB cable:** repeated `Device not configured`, changing port names, reboots and
  serial noise at 460800 baud on the outlet. A swap test confirmed the cable; it is no
  longer used. The outlet's steady `queued=12` is probably untimed records from those
  reboots (kept for export by design; not yet confirmed by dump).
- **Task watchdog warnings (non-fatal):** `IDLE0` not reset during TLS handshakes in
  `telemetry_upload` and `cloud_ota` (software ECDSA P-384 verify and ECDHE). About 41/h
  on inlet and 53/h on outlet; none while offline. Config: CPU 160 MHz, task WDT 5 s,
  TLS session tickets off. No reboot was caused.
- **Backlog drain speed:** one full TLS handshake per reading (~7 s), so a 446-reading
  backlog takes about 2 h to drain.
- **Measurement-to-server latency:** about 6–7 s when online.
- **Do not type into the serial monitor:** pasted text produced ~300
  `ZC: unsupported command` lines (Oct 16).

## Decision

| Field | Value |
| --- | --- |
| Static bench (inlet, outlet) | Accepted for continued bench development, tests 1–8 |
| Not tested | Control board; test 10 on hardware; all OTA tests |
| Open findings for the firmware maintainer | 4xx retried forever (head-of-line blocking); health stays "healthy" while uploads fail; no guard against a build role that differs from the provisioned role; watchdog warnings and slow drain from one TLS handshake per reading |
| Next | Real sensor drivers (SCD41, AHT25, PMS7003) under `firmware/components/` |
