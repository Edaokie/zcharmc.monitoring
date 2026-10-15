# Wi-Fi outages and buffered firmware readings

This implementation is for disconnected bench evaluation. The ESP32-WROOM32 still
requires **2.4 GHz Wi-Fi**; software cannot add a 5 GHz radio. All three roles
currently generate deterministic **simulated** values. Control remains maintenance-only
and does not configure actuator GPIOs. See the [three-board guide](FIRMWARE_STATIC_BENCH.md).

## What happens during an outage

Wi-Fi recovery, acquisition, telemetry delivery and OTA run in separate FreeRTOS
tasks. Acquisition takes a snapshot every 15 seconds even without Wi-Fi or internet.
Each sample is committed to a flash outbox before it can be uploaded. Network errors,
HTTP errors, malformed acknowledgements and redirects leave it queued.

The Wi-Fi task reacts to disconnect/lost-IP events and retries with increasing
2–60 second delays and bounded jitter. An in-progress association/DHCP attempt has
a 30-second deadline. Every five unsuccessful connection attempts it restarts the
Wi-Fi driver, without rebooting the application or erasing credentials. Return
codes and disconnect reasons are logged without passwords or tokens. Reconnecting
requires the configured SSID/password to remain correct. IP acquisition is separate
from internet reachability: a router with no upstream internet can still report
Wi-Fi connected while HTTPS delivery fails and readings remain queued.

The uploader retries with bounded backoff. Only a successful HTTP 200/201 containing
`accepted: true` and the exact original `message_id` acknowledges a queued sample.
Django commits before acknowledging. If the response is lost after commit, the same
message ID, original measurement timestamp and values are retried; Django returns
the existing record instead of inserting another. A conflicting payload returns
409 and remains queued for investigation. Authentication failures also retain data.
Such a permanently rejected head record can delay later uploads; inspect serial
logs and export the queue rather than deleting records automatically.

## Capacity and power-loss behavior

The existing 704 KiB partition named `spiffs` is now used as a raw outbox, **not a
mounted SPIFFS filesystem**. Partition addresses and application slots are unchanged.
The first 4 KiB identifies the format; the remainder contains 2,800 slots of 256
bytes. One sector (16 slots) is reserved for resolving timestamps. Normal sampling
can retain up to **2,784 pending readings**, approximately **11 hours 36 minutes**
at a 15-second interval when initially empty. Existing retained records reduce this
capacity. Sector reclamation can also temporarily reduce usable space.

A full queue preserves old unacknowledged readings and logs `Sample NOT saved:
queue full` for new snapshots. It cannot preserve an unlimited outage. This is an
explicit capacity limit, not a guarantee that all measurements will always survive.

Each record has a checksum and final commit marker. Acknowledgement changes a
separate flash marker; only sectors without pending records can be erased. Torn
uncommitted writes are ignored. Committed corruption or storage I/O failures stop
queue use instead of silently formatting or discarding pending data. Power loss
while saving a snapshot can lose that in-flight snapshot; previously committed
records are the recovery target. An unknown/nonempty partition format is rejected.

The queue survives application OTA and ordinary reboot, provided its partition is
not erased or repurposed. Downgrading to older firmware does not drain this queue.
Version 2 firmware reads both original four-field (v1) and expanded (v2) records;
the USB decoder supports both. Older firmware cannot drain new v2 records.
An erase-flash operation destroys the queue and provisioning. Back up first.

## Clock behavior: never fabricate measurement time

Clock validity requires an actual SNTP synchronization in the current boot.
After synchronization, acquisition continues timestamping readings during an outage.

If a device boots without internet, readings are saved with a random 128-bit boot
ID and monotonic uptime. If SNTP succeeds later **during that same boot**, the device
resolves their UTC timestamps using a fixed boot-to-UTC mapping, commits a replacement
record, and only then acknowledges the original local record. Retries use the saved
resolved timestamp even after a subsequent restart.

If power is lost **before that boot ever synchronized**, the UTC time of those
samples cannot be reconstructed reliably without a battery-backed clock or another
trusted time reference. They remain in flash for USB export with `timestamp: null`
and their original boot ID/uptime. They are not uploaded with invented timestamps.
Readings from a previous device identity are also retained for export rather than
silently attributed to a newly provisioned device. These retained records occupy
queue capacity until an operator plans recovery.

## Enable a supervised simulated upload test

1. Deploy the backend changes and run `python manage.py migrate --noinput`.
   Apply all migrations through `0006_devicetestreading_device_test_latest`.
2. In Django admin, open the intended **Device** and enable **Allow test telemetry**.
   It defaults to false for all devices. Keep the device enabled and use its existing
   provisioning credential; no shared ingestion key is added to firmware.
3. Install the matching inlet/outlet/control build on a disconnected bench board using the
   existing provisioning/OTA instructions. Ensure the reserved partition is empty
   or already contains the supported outbox format. Do not erase an unknown partition
   merely to bypass an error.
4. Inspect serial output for `sample persisted`, queue count, SNTP synchronization,
   and any upload failures. Keep a serial log to establish before/after evidence.
5. Open **Bench simulation** (`/bench`) with an authorized firmware staff account,
   or **Device test readings** in Django admin. These explicitly simulated records
   are stored separately from research `Reading` rows and do **not** appear in the
   Vercel live measurement charts. This avoids presenting fake sensors as real data.
6. Disable the router's 2.4 GHz network for two minutes. Expect acquisition to
   continue, the queue to grow by approximately eight readings, and retries to log.
7. Restore the same network. Expect automatic reconnection, then queue drainage and
   persisted rows with original measurement times, not reconnection time.
8. Repeat with Wi-Fi still available but upstream internet disconnected. Separately
   test a board power cycle after UTC synchronization and after unsynchronized boot.
   Previously committed data must remain; untimed records from an unsynchronized
   earlier boot must be exportable rather than fabricated or discarded.
9. Test lost acknowledgement, full storage, and interrupted writes on a dedicated
   bench/test fixture. Verify existing rows are not duplicated or silently lost.

The endpoint is `POST /api/devices/<device_id>/telemetry` with that device's bearer
token and an envelope `{ "source": "simulated", "reading": { ... } }`. The reading
requires its original timestamp and stable message ID and must match the device's
inlet/outlet/control role. Control snapshots require four simulated valve states
and two finite weights; no hardware commands are issued. This endpoint is for the current simulated sensor stage; it is
not a completed real-sensor acquisition/control system.

## Read-only USB recovery export

Stop serial monitors and use the pinned tool environment. Read only the queue
partition; these offsets apply to the checked-in 4 MiB partition layout:

```sh
python -m esptool --chip esp32 --port /dev/YOUR_SERIAL_PORT \
  read_flash 0x350000 0xB0000 /PRIVATE_DIRECTORY/queue.bin
python firmware/tools/dump_outbox.py /PRIVATE_DIRECTORY/queue.bin \
  --output /PRIVATE_DIRECTORY/recovered-readings.jsonl
```

Use a new output filename; the decoder refuses to overwrite a recovery file and
creates it with private permissions. It exports pending simulated readings with
device identity, original boot ID, uptime, message ID and timestamp when known.
It never reads the NVS credentials partition. Opening the serial adapter or running
esptool may reset the board; do this on the disconnected bench and allow it to resume
afterward. Preserve the original dump. There is no automatic queue-clear command.

## Automated checks and limits

```sh
python -m unittest discover -s firmware/tests_host -v
pio run -d firmware -e inlet -e outlet -e control
# From backend/ with its Python environment and test database configured:
python manage.py test tests
python manage.py makemigrations --check --dry-run
```

Host tests compile and execute the actual portable C outbox with address/undefined
behavior sanitizers and a NOR-flash model. They inject 780 write/acknowledgement/
replacement/reclaim interruption boundaries, check restart recovery, capacity,
checksum handling, retry limits and decoding a C-produced dump. Backend tests check
opt-in, per-device authentication, role binding, duplicate/conflicting retries and
separation from production readings. These checks do not reproduce real flash wear,
radio behavior, power hardware, TLS memory pressure or every real power-failure mode.
Record physical results before fleet rollout. No automatic deployment or flashing
is performed by these source changes.
