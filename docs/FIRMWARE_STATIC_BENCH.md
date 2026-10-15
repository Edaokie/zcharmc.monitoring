# Test three ESP32 boards without sensors

Use one shared ESP-IDF project with three role builds: **inlet**, **outlet**, and
**control**. Each board gets its own identity and secret token. These builds produce
fixed dummy values every 15 seconds, buffer them in flash and send them over HTTPS.
Message IDs and measurement times change; the fixture values stay constant.

This tests acquisition scheduling, Wi-Fi recovery, storage, authenticated delivery
and the OTA path. It does not test sensor accuracy, real control, wiring or relay
safety. Keep pumps, valves and other equipment disconnected. The static control
image does not configure or write actuator GPIOs; electrical states during reset
still depend on the board. There is no automatic equipment cycle.

## 1. Prepare the backend and website

Deploy this backend and frontend together. From the backend environment connected
to the intended **PostgreSQL** database, run:

```sh
python manage.py migrate --noinput
```

This includes migration `0006_devicetestreading_device_test_latest`. The website
adds **Bench simulation** at `/bench`. Use an active Django staff account with the
firmware permissions described in the [OTA guide](OTA_BEGINNERS_GUIDE.md), or an
authorized superuser. Ordinary dashboard accounts cannot open these test records.

Static records go into `DeviceTestReading`, separately from research `Reading`.
They appear in **Bench simulation** and Django admin, not in live research charts,
efficiency calculations or production sensor exports. The page refreshes every
15 seconds while visible and shows both measurement and receipt times. Its latest
card means latest *received*, so a delayed backlog can contain older measurements.

## 2. Give each board an identity

Label the physical boards `inlet-01`, `outlet-01`, and `control-01`. Check the chip
and flash size before building: the current partition layout assumes a classic
ESP32 with **4 MB flash**, hardware ID `wroom32-4mb-v1`. A LilyGO product name alone
does not confirm compatibility. Cellular/SIM7000 communication is not implemented.

Run the following in a trusted backend environment, replacing the backend URL and
private output directory with your own:

```sh
python manage.py provision_device inlet-01 --profile inlet \
  --hardware wroom32-4mb-v1 --backend https://YOUR-BACKEND-HOST \
  --output /PRIVATE_DIRECTORY/inlet-01.json
python manage.py provision_device outlet-01 --profile outlet \
  --hardware wroom32-4mb-v1 --backend https://YOUR-BACKEND-HOST \
  --output /PRIVATE_DIRECTORY/outlet-01.json
python manage.py provision_device control-01 --profile control \
  --hardware wroom32-4mb-v1 --backend https://YOUR-BACKEND-HOST \
  --output /PRIVATE_DIRECTORY/control-01.json
```

Each file contains a distinct device token. Add `ssid` and `password` to each JSON
file locally, using your **2.4 GHz** network. An open network uses an empty password.
Keep these files private and outside Git. Re-running provisioning rotates that
device's token; the board must then be updated deliberately to use it.

In Django admin → **Devices**, open each of the three records, keep **Enabled**
checked, enable **Allow test telemetry**, and save. This is off by default. No
shared production ingestion key is needed. This checkbox does not approve OTA.

## 3. Build and install over USB

Install the pinned PlatformIO environment as described in the
[firmware README](../firmware/README.md). From the repository root:

```sh
pio run -d firmware -e inlet -e outlet -e control
python -m unittest discover -s firmware/tests_host -v
```

`firmware/platformio.ini` explicitly selects `ZC_DATA_MODE=1`, the static adapter.
Other data modes currently fail compilation so an unfinished hardware adapter
cannot silently generate dummy research values.

Connect **one board at a time** and replace `/dev/YOUR_SERIAL_PORT` below with its
actual port (for example a macOS `/dev/cu.usbserial-…` port or Windows `COM3`).
For the inlet board:

```sh
pio run -d firmware -e inlet -t upload --upload-port /dev/YOUR_SERIAL_PORT
python -m pip install pyserial==3.5
python firmware/tools/provision.py --port /dev/YOUR_SERIAL_PORT \
  --file /PRIVATE_DIRECTORY/inlet-01.json
pio device monitor --port /dev/YOUR_SERIAL_PORT --baud 115200
```

Repeat with `-e outlet` and its JSON, then `-e control` and its JSON. Close the
serial monitor before uploading or provisioning. First provisioning is accepted
only on an unprovisioned board. Do not routinely erase flash: it destroys buffered
readings and credentials. Existing correctly provisioned devices retain their
credentials across an application update.

Expect `STATIC BENCH (no actuator GPIO)`, a Wi-Fi IP log, SNTP synchronization,
and `SIMULATED sample persisted`. The queue may briefly grow before delivery starts.
A `403` upload usually means the device is disabled, its token is wrong, or test
telemetry is not enabled. HTTP failures retain queued records. The first upload
needs trusted UTC time from SNTP. See the [outage guide](FIRMWARE_WIFI_RECOVERY.md)
for cold offline boots and USB export of untimed records.

## 4. Check the fixed values

Open `/bench` on your deployed website after deploying these changes. Expect
three device cards with the following fixtures. These numbers are arbitrary
software test inputs, not equipment specifications, calibration or alarm settings.

| Field | Unit | Inlet | Outlet |
|---|---|---:|---:|
| CO₂ | ppm | 4000 | 800 |
| Temperature | °C | 29 | 29 |
| Humidity | %RH | 63 | 63 |
| pH | pH | 7 | 8 |
| PM2.5 | µg/m³ | 30 | 12 |
| Flow | L/min | 1 | 1 |
| Level | % | omitted | 50 |
| Weight | g | 1000 | 900 |
| NO₂ | ppm | 0.2 | 0.1 |
| SO₂ | ppm | 0.3 | 0.1 |
| Pressure 1 | psi gauge | 12 | 10 |
| Pressure 2 | psi gauge | 10 | 8 |

Control reports `sv1`–`sv4` as **Closed (simulated)** and `weight1=1000 g`,
`weight2=2000 g`. Four valves and two weights are a provisional software fixture;
confirm the final component count and wiring before implementing real drivers.
Missing fields stay absent, rather than becoming fake zero readings.

Select **View history** to check that IDs and measurement times advance every
15 seconds. Do not infer physical valve state from this screen. No control command
endpoint or actuator operation is added by this feature.

## 5. Run the three-board acceptance test

1. Leave all three boards powered for five minutes. Check each role's fixture,
   increasing history and stable free-running uploads. Development firmware reports
   `0.0.0-dev`; signed tagged builds report their release version.
2. Turn off the configured 2.4 GHz network for two minutes. Watch each queue grow
   by about eight samples. Restore the same network and check automatic recovery,
   original measurement times and no duplicate message IDs.
3. Separately leave Wi-Fi enabled but disconnect the internet. Samples must remain
   queued until HTTPS works again. Repeat an ordinary board power cycle after
   successful clock synchronization; committed samples must survive.
4. Test a cold boot without internet. Restore internet during the same boot to
   resolve its timestamps. If power is lost before synchronization, old untimed
   samples remain exportable, not uploaded with invented UTC times.
5. Publish a new signed version using the [CI/CD guide](FIRMWARE_CICD.md). Approve
   only inlet first, inspect its reported version and continuing bench data, then
   outlet and control. A GitHub Release alone does not install anything. Test
   interrupted OTA and rollback using the [OTA acceptance record](OTA_TEST_RECORD.md).
6. Confirm research charts and `Reading` counts are unaffected. Record the device
   IDs, versions, test times and results before treating a board as accepted.

The queue is finite: approximately 11 h 36 min when initially empty at this sample
rate, with recovery reserve and sector reclamation affecting usable space. A full
queue preserves existing records and rejects new snapshots. Firmware accepts both
old v1 four-field and new v2 expanded queue records. Older firmware cannot decode
new v2 records; avoid downgrading without exporting them first.

## 6. Add real components later

The active adapter is `firmware/src/idf/sensors.c`, with its interface in
`sensors.h`. The obsolete Arduino implementation and empty sensor headers have
been removed. Register native ESP-IDF drivers under `firmware/components/` through
CMake/component dependencies, then implement and test the adapter. Drivers must
use ESP-IDF APIs and FreeRTOS rather than depend on `Arduino.h`.

Preserve the stable field units above and the backend contract in
`backend/monitoring/contract.py`. Set validity flags only for successful, calibrated
measurements. Add a separate real-data mode and reviewed production ingestion path
before enabling it; the current path always says `source: simulated` and stores
test data. Do not relabel a static image as live data by changing only the UI.

Real control additionally needs a confirmed pin map, reset/relay polarity checks,
safe startup, feedback, local interlocks, timing/state machine, fault handling and
hardware health checks for OTA rollback. Those are not supplied by this bench image.
Wi-Fi credentials currently require deliberate USB NVS erase/reprovision if they
change; export the queue first and follow the existing OTA guide. There is no
Wi-Fi setup portal or safe in-place credential editor yet.

Known OTA limitation: a different saved attempt version can be reported as
`rolled_back` even if power failed between persisting the attempt and selecting
the new boot slot. Treat that report as requiring investigation, not proof of a
failed boot. Real-board OTA/power interruption acceptance is still required.
