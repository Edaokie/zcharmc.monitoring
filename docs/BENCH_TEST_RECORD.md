# Static bench test record: inlet-01 and outlet-01

Physical results for the [three-board static bench guide](FIRMWARE_STATIC_BENCH.md)
and the [Wi-Fi outage guide](FIRMWARE_WIFI_RECOVERY.md), run on real ESP32 boards
against the deployed Railway backend. Values are simulated fixtures
(`source: simulated`, stored as `DeviceTestReading`); this record says nothing about
sensor accuracy, wiring or control safety. The separate section
[Sensor bench: raw readings](#sensor-bench-raw-readings-2026-10-26-to-27) records the first
real-sensor checks; those values are logged on the serial console only and are not uploaded.
The section [Real-data mode](#real-data-mode-2026-10-27-to-30) records the first real sensor
readings uploaded to `POST /api/ingest` (stored as `Reading`) from the `feature/real-data-mode`
branch build. OTA acceptance is recorded separately in
[OTA_TEST_RECORD.md](OTA_TEST_RECORD.md).

No credentials, provisioning JSON, Wi-Fi names/passwords or tokens are recorded here.

## Session and environment

| Field | Value |
| --- | --- |
| Tester / dates / timezone | Edrian Abilay / 2026-10-16 to 2026-10-30 / Asia/Manila (UTC+8); admin times are UTC |
| Firmware | `develop` at `709a7a6` ("prepared for static test"), USB `-t upload`, version `0.0.0-dev`. From Oct 26: branch builds of PR #4 and #5, merged on Oct 27 as `develop` `b670045` (same code as on the boards). From Oct 27: branch `feature/real-data-mode` at `555419c` (not yet merged), environments `inlet`/`outlet` (static) and `inlet_real`/`outlet_real` |
| Toolchain | PlatformIO, native ESP-IDF 6.0.1; Firmware CI #23 on `709a7a6` passed |
| Boards | 2 × 30-pin ESP32 DevKit (ESP-WROOM-32, CP2102 USB bridge), 4 MB flash |
| Device IDs / roles | `inlet-01` / inlet, `outlet-01` / outlet. `control-01` **not tested** |
| Network | 2.4 GHz phone hotspot (main), second phone hotspot with the same SSID for the no-internet test |
| Backend | Railway production; devices enabled with **Allow test telemetry**. Real-data stages: `POST /api/ingest` with the shared ingest key (new value set on Railway on 2026-10-29, before stage B) |
| Equipment | Oct 16–20: no sensors, actuators or relays. From Oct 26: per node one SCD41 (CO₂), one AHT25 (temperature/RH) and one PMS7003 (PM); no actuators or relays |

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
| 12 | Long period without any network at boot, then reconnect | PASS (both) | Oct 27 | Hotspot off for ~50 min after boot: `Disconnected (reason=201)` (network not found) once a minute, driver recovery every few attempts, no reboot, sampling continued. Hotspot on: joined within 1 min, SNTP `clock=UTC`, same-boot untimed samples given UTC and uploaded; queue fell steadily |
| 13 | Backend credentials rotated (database password, Django secret key) while boards deployed | PASS (both) | Oct 27 | No reprovisioning needed (device tokens are separate); `/api/health` reported database ok; both boards' uploads accepted afterwards |

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

## Sensor bench: raw readings (2026-10-26 to 27)

Wiring follows pin map v1.1: SCD41 and AHT25 share the I²C bus on GPIO 21 (SDA) / 22 (SCL)
with 4.7 kΩ pull-ups to 3.3 V; PMS7003 on UART2 (GPIO 16/17, 9600 8N1) powered from 5 V.
Both nodes sat side by side in the same air-conditioned room. Values are raw (no calibration)
and printed on the serial console only; telemetry still uploads the simulated fixtures.

| Check | inlet-01 | outlet-01 |
| --- | --- | --- |
| I²C scan | 0x38 (AHT25) and 0x62 (SCD41) found | same |
| PMS7003 frames (header, length, checksum) | valid every sample; PM2.5 26–28 µg/m³ (Oct 26) | valid; PM2.5 25–30 µg/m³ (Oct 26) |
| SCD41 start | serial read, automatic self-calibration OFF (not persisted) | same |
| SCD41 room / breath test | ~1,390 → 2,688 ppm | ~1,358 → 2,449 ppm |
| AHT25 status / room | 0x18 (calibrated); 24.4–24.6 °C, 45.2 %RH | 0x18; 24.7–24.8 °C, 44.9 %RH |
| First sample before the 3 s boot health check | 2.40 s | 2.72 s |
| Oct 27, ~1.5 h side by side | PM2.5 9–20 µg/m³; CO₂ ~1,300–1,410 ppm; 24.3–24.8 °C, 41.7–46.2 %RH | PM2.5 11–22 µg/m³; CO₂ mostly ~1,150–1,390 ppm (dips excluded); 24.2–24.9 °C, 40.3–46.1 %RH |

Sensor observations:

- **PMS7003 adapter labels:** the adapter board labels its `tx`/`rx` pins from the ESP32's
  side, so the wires go same-to-same (TX2 → `tx`, RX2 → `rx`). Crossed wiring gave
  0 frames.
- **PMS7003 power polarity:** VCC and GND swapped by mistake on one unit shorted the 5 V
  rail; the computer cut the USB port and the board disappeared until rewired. Check
  polarity with a multimeter before powering.
- **SCD41 internal temperature:** about 2–3 °C above the AHT25 for ~90 s after start,
  then converges; its RH reads ~2–5 %RH above the AHT25. Only the AHT25 is used for
  official temperature/RH.
- **Outlet SCD41 short dips (open):** on Oct 27 the outlet CO₂ dropped briefly several
  times (to 641–1,122 ppm) and recovered within ~1 min; the inlet never did. Temperature,
  RH and PM stayed steady during the dips. A position-swap test will show whether it
  follows the position (airflow, door) or the sensor.
- **A sensor must never block sampling:** an early PMS7003 version waited up to 3 s for
  a frame inside sampling, missed the 3 s boot health check and silently disabled
  uploads. Slow sensors now run in their own tasks and sampling copies the newest value.

## Real-data mode (2026-10-27 to 30)

Branch build of `feature/real-data-mode` (`555419c`, `ZC_DATA_MODE=2`). Real readings follow
the "Sensor upload contract" in [CLOUD_SETUP.md](CLOUD_SETUP.md): flat JSON to
`POST /api/ingest` with `Authorization: Bearer <INGEST_API_KEY>`, message ID
`real-<role>-<boot>-<sequence>`, stored as `Reading` (research data, live dashboard). Fields:
`co2` (SCD41), `temperature` and `humidity` (AHT25, status 0x18 required), `pm25` (PMS7003,
from 30 s after boot); pH is not sent. Before the board tests: 17/17 host tests, and a local
Django + Postgres check of 201 → retry 200 → wrong key 403 → changed values 409 → simulated
envelope 400 → future timestamp 400. Sensors were not calibrated against references and both
nodes sat side by side in the same air-conditioned room, so these values show that the path
works, not sensor accuracy and not adsorption.

| Stage | Test | Result | Date | Evidence / observation |
| --- | --- | --- | --- | --- |
| A | New static build reads existing v2 queue records (old `reserved` word is now `source`) | PASS (both) | Oct 27 | No storage fault; simulated uploads accepted after the recovery below |
| B | `inlet_real`: NVS erase (`0x9000 0x5000`), reprovision with `ingest_key`, real readings accepted | PASS (inlet) | Oct 29 | Status before `provisioned=0 ingest_key=0` → `provisioning saved`; log `REAL sensors -> /api/ingest (ingest key present)`; `REAL sample persisted; queued=1 clock=UTC` every 15 s; no HTTP 403 |
| C | Admin `Reading` rows and live dashboard | PASS (both) | Oct 29–30 | About 4 rows per minute per node; on Oct 30 inlet and outlet rows interleaved (e.g. outlet IDs 1292–1321, 03:12–03:15 UTC, CO₂ values equal to the serial log). Dashboard: inlet and outlet "Fresh", CO₂ and PM2.5 for both nodes |
| D | Wi-Fi outage with real readings | PARTIAL | Oct 29 | Unplanned outage only: inlet rows for ~07:18–07:24 UTC were received late with their original measurement times. The planned two-minute outage test is still to run |
| E | `outlet_real`: export and erase outbox, NVS erase, reprovision, real readings accepted | PASS (outlet) | Oct 30 | 481 simulated records exported, then `erase_region 0x350000 0xB0000`; status before `provisioned=0 ingest_key=0` → `provisioning saved`; AHT25 `0x18`; `REAL sample persisted` every 15 s; no HTTP 403 |

### Incident: wrong builds flashed (2026-10-27)

- **Cause:** while flashing stage A, the outlet build went onto the inlet board (~3 min) and
  the inlet build onto the outlet board (< 1 min). Both were re-flashed with the right builds
  within minutes.
- **Effect:** the wrong-role samples (inlet queue: 7 with `node_id: "outlet"`; outlet queue:
  2 with `node_id: "inlet"`) reached the head of each queue; every upload got HTTP 403 and
  the queues grew (inlet ~440, outlet ~510) over a lunch-time hotspot outage.
- **Fix:** the Oct 19 procedure: `read_flash 0x350000 0xB0000`, decode with `dump_outbox.py`
  (inlet 461 records, outlet 542, all simulated), backups kept privately, then
  `erase_region 0x350000 0xB0000` on each board. Both returned to `queued=1` with uploads
  accepted. Only simulated readings were lost from upload.
- **Prevention:** the PlatformIO environment (`-e`) must match the role printed by the MAC
  check for that port, every time.

### Real-data observations

- **Provisioning line lost on the board:** `provision.py` sent the whole line at once. The
  board reads the console UART with no driver buffer, so only the 128-byte hardware FIFO
  holds input while the serial task sleeps; the longer real-data line (~320 bytes) arrived
  corrupted and was refused. Sending 16-byte chunks 60 ms apart worked on both boards
  (`provision.py` updated in the `feature/real-data-mode` PR).
- **Outlet `queued=2`, inlet `queued=1`:** the outlet most likely keeps one untimed record
  from an earlier boot (kept for export by design); not yet confirmed by a dump. It does
  not block new readings.
- **Inlet and outlet CO₂ differ in the same air:** e.g. ~1,090 vs ~1,010 ppm on Oct 30.
  The dashboard's adsorption efficiency is therefore not meaningful until the offset is
  measured and the gas actually passes through a column.
- **Both CO₂ values rose together** (~1,100 → 2,058 and ~1,010 → 1,946 ppm within ~25 s,
  Oct 30 03:25 UTC) with people next to the bench; both sensors respond within seconds.
- **Watchdog warnings** (`telemetry_upload`, `cloud_ota`, `wifi` on CPU 0 during TLS)
  continue as before; no reboot.
- **Dashboard (frontend, not firmware):** in Realtime mode the temperature/humidity chart
  plots the inlet only, and the time labels of some charts are wrong (e.g. dates up to
  the next day, or a 3-second span for 1.5 minutes of points) while the values are correct.

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
- **Drain speed depends on retained untimed records (Oct 27):** outlet ~8.2 s per upload
  versus inlet ~7.2 s. After every accepted upload the queue is rescanned from the start,
  at most 64 records per pass; the outlet keeps ~78 untimed records from earlier boots,
  so it needs a second pass after a 1 s wait. The inlet keeps ~2.
- **Wi-Fi reason codes seen:** `201` network not found (hotspot off), `200` beacon
  timeout, `36` the board ending its own attempt, `1` unspecified (access point left).
- **Do not type into the serial monitor:** pasted text produced ~300
  `ZC: unsupported command` lines (Oct 16), and 26 lines on the provisioned outlet
  (Oct 30). The board ignored them; provisioning is not accepted twice.

## Decision

| Field | Value |
| --- | --- |
| Static bench (inlet, outlet) | Accepted for continued bench development, tests 1–8 |
| Not tested | Control board; test 10 on hardware; all OTA tests |
| Sensor raw reading (inlet, outlet) | Accepted for bench development: SCD41, AHT25 and PMS7003 read on both nodes; merged as PR #4 and #5 |
| Real-data mode (inlet, outlet) | Stages A, B, C, E passed on the branch build; stage D partial. Pending review of the `feature/real-data-mode` PR |
| Open findings for the firmware maintainer | 4xx retried forever (head-of-line blocking); health stays "healthy" while uploads fail; no guard against a build role that differs from the provisioned role; watchdog warnings and slow drain from one TLS handshake per reading; full rescan of retained untimed records after every upload |
| Next | Review and merge of the real-data PR; planned outage test with real readings (stage D); inlet/outlet side-by-side offset and the outlet CO₂ dip position-swap test; TLS connection reuse for the watchdog and drain findings; calibration against references |
