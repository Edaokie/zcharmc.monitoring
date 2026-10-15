# ESP32 OTA: a beginner's guide

## 1. Is this finished and ready to deploy?

The repository contains a working local implementation of signed firmware builds,
release publication, Django registration and an ESP32 OTA client. It is ready to
configure and evaluate on a disconnected bench. It is **not yet a proven production
deployment**. A successful cloud run and physical ESP32 acceptance must still be
recorded. Do not use this guide to connect unvalidated firmware to operating equipment.

| Part | What exists | What still needs proof |
| --- | --- | --- |
| CI | Tests and builds three role images on firmware pushes/PRs | Successful run for the exact commit you will release |
| Delivery | Tag-triggered signing, GitHub publication, verified Django registration | Owner settings, deployed backend and a successful tagged run |
| Device OTA | Authenticated polling, signed-image checks, inactive-slot install and boot rollback | Real-board update, rejection, interrupted-download and rollback tests |
| Equipment functions | Static fixtures for all three roles; buffered simulated telemetry; no actuator GPIO configuration | Real sensor drivers, physical buffering/upload tests, operating cycle and hardware interlocks |

The current build assumes a generic classic ESP32 with 4 MB flash and hardware ID
`wroom32-4mb-v1`. The LilyGO T-SIM7000G board in the system diagram has not been
validated against that configuration. Confirm the exact board variant, pin map,
flash size, relay polarity and boot-time pin behavior with the hardware maintainer
**before the first upload**. Static images do not configure actuator GPIOs; reset
electrical states have not been validated for your pumps or valves. Keep equipment
disconnected. The implemented network connection is Wi-Fi;
the SIM7000 cellular connection is not implemented.

Current software results are recorded in [OTA_VERIFICATION.md](OTA_VERIFICATION.md).
Use [OTA_TEST_RECORD.md](OTA_TEST_RECORD.md) to record actual acceptance results.
For inlet, outlet and control without sensor components, follow the
[three-board static bench guide](FIRMWARE_STATIC_BENCH.md).

## 2. What OTA and CI/CD mean

- **Firmware:** the program running inside an ESP32.
- **Build:** turn source code into a binary file, such as `inlet.bin`.
- **CI:** GitHub automatically checks code and builds firmware after a push.
- **Continuous delivery:** GitHub prepares a versioned, signed release for installation.
- **OTA (over the air):** an already-provisioned ESP32 downloads an approved update
  through the network instead of being reflashed through USB.
- **Manifest:** a small signed description of the binary: version, role, hardware,
  source commit, size and SHA-256 digest. A digest detects changed binary bytes.
- **Signature:** proof that the release was signed with your trusted private key.
- **Rollback:** returning to the previous bootable application if the new one fails
  its first-boot verification. It does not undo database or NVS changes automatically.
- **Provisioning:** saving a particular board's identity, credential and Wi-Fi settings.

The process is:

```text
Push code → CI tests/builds
Push version tag → build/sign → publish GitHub Release → register in Django
Staff enables release and assigns one device → ESP32 downloads/checks/reboots
ESP32 verifies startup locally → reports its running version to Django
```

An ordinary code push does not approve installation. A published release alone
does not approve installation either. Authorized staff can approve through the
[Firmware dashboard](FIRMWARE_DASHBOARD.md) or Django administration website.

## 3. Who needs to do what?

| Person | One-time responsibilities |
| --- | --- |
| GitHub repository owner/admin | Configure Actions, the release environment, secrets and tag protections |
| Backend administrator | Deploy Django changes, configure variables, create a staff account and device records |
| Person at the bench | Confirm hardware, connect USB, provision and observe each board |
| Release reviewer | Review release metadata, enable it and assign selected devices |

One person can perform several roles if they have the necessary access. A GitHub
account that can push code may still be unable to configure environment secrets.

## 4. Prepare your computer

The terminal examples below use macOS/Linux shell syntax. Replace paths, USB ports,
backend domains and version examples with your actual values; do not paste the
placeholder values unchanged. On Windows the serial port is usually `COM3` or similar
and virtual-environment activation differs.

Install Git, Python 3.12 and OpenSSL, and have a USB **data** cable. Open a terminal
in the repository root: the directory containing `README.md`, `backend/` and
`firmware/`. These commands create a Python environment outside the repository:

```sh
python3.12 -m venv "$HOME/.venvs/zcharmc-firmware"
source "$HOME/.venvs/zcharmc-firmware/bin/activate"
python -m pip install platformio==6.1.19 pyserial==3.5
pio --version
```

Expected: PlatformIO reports version 6.1.19. Activate this environment again when
opening a new terminal for firmware work. Backend commands use a separate backend
environment; follow [backend setup](../backend/README.md#local-development).

## 5. Test software without connecting an ESP32

From the repository root, in the firmware environment:

```sh
python -m unittest discover -s firmware/tests_host -v
pio run -d firmware -e inlet -e outlet -e control
```

Expected: tests end with `OK`; all three build environments show `SUCCESS`.
The initial build downloads tools and can take several minutes. These commands
do not flash a board, create a GitHub Release, or write to the backend.

In your separately configured backend environment, from `backend/`, run:

```sh
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test tests --verbosity 1
```

Use a local development/test database and the settings in the backend guide, not
production credentials. Expected: no system errors, no pending model migrations,
and all tests pass. Tests do not prove physical OTA behavior. Check GitHub Actions
after the reviewed code is pushed too; local success does not establish remote success.

## 6. Configure Django and GitHub once

Have the backend administrator deploy the current backend code and existing OTA
database migrations first. Confirm `https://YOUR_BACKEND_DOMAIN/api/health`
returns `status: ok` and `database: ok`, and that a staff account can sign in at
`https://YOUR_BACKEND_DOMAIN/admin/`. The domain must be publicly reachable over
HTTPS from both GitHub and the ESP32.

Three different credentials are involved. They are not interchangeable:

| Item | Where it belongs | Purpose |
| --- | --- | --- |
| Signing private key | Private backup and GitHub environment secret | Signs firmware releases |
| Registration secret | Django service variable and matching GitHub environment secret | Registers signed metadata; cannot approve devices |
| Per-device token | Private provisioning JSON, then the device's NVS | Authenticates that board's OTA polling/status |

The public key in `firmware/keys/release-public.pem` is safe to track in Git and
must match the private signing key. The existing private key is expected at
`firmware/.keys/release-private.pem`; never upload it as a Release asset. If it is
missing, ask the owner to restore its private backup. Do not casually generate a
replacement: already-provisioned boards trust the old public key.

Follow the exact variable/secret table in
[FIRMWARE_CICD.md](FIRMWARE_CICD.md#one-time-owner-configuration). In particular:

1. Generate a new registration secret privately; do not post it in chat or Git.
2. Set Django `OTA_RELEASE_REGISTRATION_KEY` to that secret.
3. Set Django `OTA_RELEASE_REPOSITORY` to `Edaokie/zcharmc.monitoring`.
4. Set Django `OTA_SIGNING_PUBLIC_KEY` to the complete tracked public PEM.
5. Open GitHub repository **Settings → Environments → firmware-release**.
6. Add environment secrets `FIRMWARE_SIGNING_PRIVATE_KEY` and
   `OTA_RELEASE_REGISTRATION_KEY`. Use the existing private PEM and matching secret.
7. Add environment variable `OTA_BACKEND_URL`, for example
   `https://YOUR_BACKEND_DOMAIN`, with no `/api`, query, or credentials.
8. Configure release-tag protections and environment approvals where supported.
   Naming an environment in the workflow does not configure approval rules.

Redeploy/restart Django after its service variables change. Secrets must not be
`VITE_*` variables or committed files. GitHub release assets must be publicly
downloadable for the current device client.

To test cloud delivery before connecting any hardware, continue directly to
step 9 and leave every release disabled and unassigned. Return to steps 7–8
when the hardware maintainer has confirmed board compatibility.

## 7. Install the initial firmware through USB

This is the hardware gate: proceed only after the board configuration has been
confirmed. Keep all actuators disconnected. Start with one inlet bench board.

Connect the board and list available serial ports:

```sh
pio device list
```

Record the correct port, such as `/dev/cu.usbserial-XXXX`. Close other serial
monitors before uploading. From the repository root:

```sh
pio run -d firmware -e inlet -t upload --upload-port /dev/YOUR_SERIAL_PORT
```

Expected: the upload completes and the board restarts. This command installs the
initial build using its configured bootloader and partition layout. Do not try to
initialize a blank board by writing a downloaded application `.bin` at a guessed
address. OTA updates later replace the application only.

The development version is `0.0.0-dev`. It is normal for the board to be
unprovisioned at this point. Do not select `control` just to test an inlet board;
that image configures actuator output pins.

## 8. Register and provision that board

The following management command must run in an authorized backend environment
connected to the **same database used by the deployed backend**. A device created
only in a local development PostgreSQL database will not be recognized by the cloud backend.

Ask the backend administrator to create a private directory and run, from `backend/`:

```sh
python manage.py provision_device inlet-01 --profile inlet \
  --hardware wroom32-4mb-v1 \
  --backend https://YOUR_BACKEND_DOMAIN \
  --output /PRIVATE_DIRECTORY/inlet-01.json
```

Use a new device ID for each board. The output directory must exist and the file
must not already exist. Expected: a message that the credential was saved; the
token is not printed. The generated file is private (mode 600). Transfer it to the
bench computer through an approved private channel, not public logs or Git.

Open the JSON file in a local text editor. Keep the generated fields unchanged and
add `ssid` and `password` for the bench Wi-Fi. Its structure will resemble:

```json
{
  "device_id": "inlet-01",
  "profile": "inlet",
  "hardware": "wroom32-4mb-v1",
  "device_token": "KEEP_THE_GENERATED_PRIVATE_TOKEN",
  "backend": "https://YOUR_BACKEND_DOMAIN",
  "ssid": "YOUR_WIFI_NAME",
  "password": "YOUR_WIFI_PASSWORD"
}
```

Store this file outside the repository, or in ignored `firmware/provisioning/`.
Avoid smart quotes, trailing commas, and a backend path or trailing slash. Check
every value before sending it: changing Wi-Fi or the token after provisioning
currently requires deliberate USB recovery.

Close the serial monitor. From the repository root, run:

```sh
python firmware/tools/provision.py --port /dev/YOUR_SERIAL_PORT \
  --file /PRIVATE_DIRECTORY/inlet-01.json
```

Expected: `Provisioning saved; board is rebooting.` Allow several minutes for
Wi-Fi, network time synchronization and the next status report. In Django admin
**Monitoring → Devices → inlet-01**, check that the reported version is
`0.0.0-dev`, status is `healthy`, and `last_seen` advances on later reports.
Do not edit read-only fields to manufacture a successful result.

If it does not report, stop and use the troubleshooting table below. Do not
rerun `provision_device` as a connection test: generating another file for the
same ID immediately revokes its previous token in Django.

## 9. Publish your first bench OTA release

The reviewed code must already be committed and pushed, with a successful CI run.
If working on `develop`, confirm that is the intended release branch. Check the
current commit with `git log -1 --oneline` and ensure `git status --short` has no
uncommitted release changes. Tags build committed source only.

Choose a version not already used in GitHub Releases or Git tags. For example:

```sh
git tag firmware-v0.1.0
git push origin firmware-v0.1.0
```

These commands publish a tag and trigger a real release. Substitute a new version
if `0.1.0` is already used. The firmware embeds `0.1.0`, without the `firmware-v`
prefix. You do not need a functional code change to test updating from `0.0.0-dev`
to a new version.

Open GitHub **Actions → Signed Firmware Release**. Approve environment jobs if
requested. Wait for both `release` and `register` jobs to pass. The jobs may each
require approval. Verify:

- GitHub Releases contains that tag and all three role binaries, signatures and
  manifests. A downloadable CI artifact alone is not an OTA release.
- The registration job summary says three role releases were registered.
- Django **Monitoring → Firmware releases** contains three matching records.
- New records have **Enabled** unchecked; the device still has no desired release.

If registration failed after assets were published, repair its configuration and
retry registration; do not delete the release or move the tag. See step 12.

## 10. Approve one device and observe the OTA

In Django admin:

1. Open the new **inlet** firmware release. Confirm version, hardware ID and source
   commit. Check **Enabled**, then save.
2. Open **Devices → inlet-01**. Confirm its profile/hardware and that it is enabled.
3. Set **Desired release** to that matching inlet release and save.
4. Keep stable board power and Wi-Fi. Observe the serial log if available and
   refresh the device record over the next few minutes.

The board polls about once a minute after Wi-Fi and network time are available.
It verifies metadata and downloads the binary into the inactive application slot.
After verification it restarts, runs local startup checks and reports its version.
Successful acceptance means **all** of the following:

- The reported version becomes the expected new version, such as `0.1.0`.
- Reported status becomes `healthy`, and `last_seen` continues advancing.
- The board does not repeatedly reboot, and its provisioning survives a normal
  power cycle **after** the update is confirmed.
- No other board was assigned or updated by this test.

You may see `Verified approved image; rebooting into pending verification` on the
serial log. You may not see `updating` in Django: reports are periodic, so short
transitions can be missed. A configured desired release is not proof of installation.
An HTTP 200 registration response is not proof of installation either.

Record the result in [OTA_TEST_RECORD.md](OTA_TEST_RECORD.md). Repeat with a
separate outlet board, then control last with all equipment disconnected. Each
board needs its own ID/token and the correct USB image. A healthy report currently
means the bench startup checks passed; it does not verify sensors or plant safety.

## 11. Additional tests before operational use

Run these on spare, disconnected boards. Keep a known-good USB recovery procedure.

| Test | How to exercise it | Expected evidence |
| --- | --- | --- |
| No assignment | Publish/register a release without assigning the device | It stays on its existing version |
| Retry registration | Manually register the same published tag again | Success; no duplicate releases, enablement or assignment changes |
| Credential persistence | Power-cycle after a successful confirmed update | Same identity; version and periodic reports return |
| Interrupted transfer | With a bench observer, interrupt Wi-Fi while logs show an actual download; restore it | Current app remains bootable; a later poll can retry. Record whether the interruption really occurred during transfer |
| Wrong role/hardware | Automated host/backend tests first; staff should find mismatched targets rejected in admin | Rejection; no device target changed |
| Tampered assets | Host tests use disposable signed fixtures and altered binaries/manifests | Tests pass because altered data is rejected; never overwrite a published release |
| Failed first boot and rollback | Firmware maintainer supplies a controlled test image that fails startup verification, with a known-good fallback installed | Board returns to the fallback; serial boot evidence confirms it; failed generation does not reinstall automatically |
| Approved retry | After diagnosing a failed boot, staff deliberately approves another attempt | Approval generation/audit advances; only the intended device retries |

The final two tests require an experienced firmware maintainer. Randomly resetting
a running board is not a reliable rollback test: once an image is confirmed,
ordinary resets do not trigger first-boot rollback. ESP-IDF's first-boot mechanism
is described in the [version-matched OTA documentation](https://docs.espressif.com/projects/esp-idf/en/v6.0.1/esp32/api-reference/system/ota.html).

Also test operating interlocks, network-loss behavior and sensor health when those
functions are implemented. Passing the current OTA tests cannot establish them.

## 12. Troubleshooting and recovery

| Symptom | Check / next action |
| --- | --- |
| `pio` not found | Activate the firmware virtual environment and confirm installation |
| Serial port absent/busy | Use a data cable; run `pio device list`; close other monitors; check the board's USB driver |
| Missing signing key or trust mismatch | Owner must restore the matching private key/secret; do not replace the public key on deployed boards casually |
| Release waiting in Actions | A configured environment reviewer must approve the job |
| No workflow after tagging | Confirm code/workflow and tag were pushed, Actions is enabled, and the tag starts with `firmware-v` |
| Registration HTTP 404 | Backend code is not deployed, or the configured origin/path is wrong |
| Registration HTTP 403 | Match the dedicated registration secret in GitHub and Django; the endpoint is disabled when the Django key is empty |
| Registration HTTP 400 | Check backend public PEM, configured repository, manifest signatures and version-tag URL |
| Registration HTTP 409 | Existing version has conflicting immutable metadata; investigate and publish a new version |
| Registration timeout/5xx | Check backend/database availability and logs; retry only the registration job after repair |
| Provisioning rejected/already provisioned | Confirm role/hardware; an already-provisioned board deliberately rejects replacement settings |
| Device never reports | Check power, Wi-Fi, network time access, HTTPS reachability, backend logs, matching device ID/token and that the device is enabled |
| Device reports but does not update | Check enabled release/device, desired role/hardware, a different version, public asset access and serial rejection logs |
| Same version does not reinstall | Firmware skips an image whose version equals the running version; publish a new version to test another update |
| Rolled-back target will not retry | Diagnose first, then use **Approve another attempt for selected devices** in the Devices list |

To retry registration without rebuilding: GitHub **Actions → Signed Firmware
Release → Run workflow**, choose the reviewed default branch, and enter the existing
tag in `release_tag`. The button appears after this workflow exists on the default
branch. Manual runs verify/download existing assets and register them; they do not
create a new release. Staff approvals/assignments remain unchanged.

To withdraw an update before the next poll, clear the device's **Desired release**
or disable the release/device. This cannot cancel a transfer already underway,
uninstall running firmware, or shut down equipment.

Known recovery limitations: interrupted multi-key provisioning can leave partial
credentials that look provisioned, and malformed backend origins are not fully
validated on the device. USB reprovisioning currently requires deliberately erasing
NVS, losing credentials and OTA attempt history. Have the maintainer plan recovery;
do not erase NVS as routine troubleshooting. Also, power loss between saving an
OTA attempt and selecting its boot partition can produce a `rolled_back` report
without an actual trial boot. Confirm rollback using serial evidence, not that
status alone. These are open firmware issues, not completed fixes.

Do not connect the system to operating equipment until these limits and the
physical acceptance record have been reviewed by its responsible maintainer.

## Approving through the web dashboard

The [firmware dashboard guide](FIRMWARE_DASHBOARD.md) explains real Django login,
staff permissions, release enablement, selected device approval, withdrawal and
explicit retries. Complete the signing, initial USB installation and bench checks
in this guide first. The web page does not replace physical acceptance tests.

For Wi-Fi recovery, the bounded flash queue, simulated upload opt-in and read-only
USB data recovery, follow the [outage recovery guide](FIRMWARE_WIFI_RECOVERY.md).
