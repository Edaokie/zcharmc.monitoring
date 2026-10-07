# Native ESP-IDF firmware and approved OTA releases

The active PlatformIO environments use **ESP-IDF 6.0.1 and FreeRTOS**, pinned through
Espressif32 7.0.1 / PlatformIO 6.1.19. There are three images: `inlet`, `outlet` and
`control`. CMake explicitly builds only `src/idf/`; the old Arduino source and its
configuration are reference-only and excluded, including legacy credentials.

**Current scope is a bench OTA foundation.** These new images provide USB
provisioning, Wi-Fi, authenticated HTTPS update polling/status, signed image
verification, two OTA slots and boot rollback. They do not yet read sensors,
buffer/upload telemetry, or run the real equipment cycle. Inlet/outlet are role
profiles ready for native sensor adapters. Control stays in maintenance mode and
drives the legacy output pins LOW; LOW is NOT established as safe for the actual
actuators. Flash/test only with equipment disconnected until relay polarity,
boot-time pin states, wiring and local interlocks have been validated. The web
mock login is unchanged and cannot approve OTA.

## Hardware assumptions and first installation

`esp32dev`, `wroom32-4mb-v1` and the partition table assume classic ESP32 WROOM32
with **4 MB flash**. Confirm flash capacity and exact board wiring on each board
before flashing. WROOM32 alone does not establish flash capacity or chip revision.
The two application slots are each 0x1A0000 bytes; there is no factory app slot.
Initial native installation needs USB because the current firmware cannot install
this OTA client or new partition layout itself. Future application-only updates
can use OTA; changing partitions/bootloader or recovering both bad slots needs USB.

Install the pinned PlatformIO CLI in a local Python environment, then from the
repository root:

```sh
pio run -d firmware -e inlet -e outlet -e control
python -m unittest discover -s firmware/tests_host -v
# Run the matching command once per disconnected bench board, after confirming hardware:
pio run -d firmware -e inlet -t upload --upload-port /dev/YOUR_SERIAL_PORT
```

Use `outlet` or `control` for the corresponding board. Development images identify
as `0.0.0-dev`; release builds get their version from the version tag. Never upload
a CI `firmware.bin` alone to a board with an incompatible partition/bootloader.
Do not use the legacy Arduino build environments.

## Signing trust and GitHub setup (repository owner)

The public trust anchor is `keys/release-public.pem`, compiled into every image.
An initial matching private key was generated locally at `.keys/release-private.pem`
(mode 600, ignored by Git). Back up this key securely before using the first OTA
image. Never commit it, publish it as an artifact, or place it in Vercel/browser
variables. The release workflow checks that its secret matches the tracked public
key and refuses to sign with another key. Do not regenerate the public key after
provisioning boards: this implementation requires USB to change their trust anchor.

1. In GitHub Settings → Environments, create `firmware-release`; configure required
   reviewers and restrict deployment tags to `firmware-v*`. Configure a repository
   tag ruleset restricting creation/update/deletion of release tags to maintainers.
   A YAML environment name alone does **not** enforce human approval.
2. Add environment secret `FIRMWARE_SIGNING_PRIVATE_KEY` containing the private PEM.
3. Enable GitHub Actions with permission to create Releases. Keep the release
   workflow and trust anchor under reviewed changes/branch protection.
4. Firmware pushes/PRs build all three profiles and run host security tests. They
   produce unsigned bench artifacts, and do not approve device installation.
5. After reviewing a tested commit, create/push `firmware-v1.2.3` (unique semantic
   version; at most 31 bytes). The protected release job rebuilds all roles from
   that tag, runs tests, signs and verifies the package, and publishes a GitHub
   Release. Do not replace assets or reuse a version; publish a new tag for changes.

Each role has `<role>.bin`, `<role>.bin.sig`, `<role>.manifest.json` and
`<role>.manifest.json.sig`. Manifests bind version, role, hardware ID, full source
commit, filename, byte size and SHA-256. Both binary and canonical manifest use
RSA-3072 PSS/SHA-256 signatures with a 32-byte salt. Image descriptor role/version
are checked before signing and again on the board before activation.

Only public GitHub HTTPS release assets are supported by this downloader. A private
repository needs a separate authenticated artifact delivery design; never copy a
GitHub personal access token into firmware. GitHub release publication alone does
not update any board. This does not enable hardware Secure Boot, flash encryption,
eFuse changes or hardware anti-rollback protection; signatures protect this OTA
path, not an attacker with physical flash access.

## Railway setup and one-time provisioning

Deploy the backend migration and set Railway `OTA_SIGNING_PUBLIC_KEY` to the exact
public PEM from `firmware/keys/release-public.pem` (multiline, or escaped `\n`).
`ALLOW_PUBLIC_READ` has no effect on OTA permissions. Leave `OTA_ASSET_HOSTS` at its
GitHub defaults unless implementing and reviewing another HTTPS asset origin.
Vercel needs no OTA secret or firmware installation control.

Use the backend's trusted administrative environment with production DB access to
create three distinct devices. Choose IDs such as `inlet-01`, `outlet-01`,
`control-01`. Example, from `backend/`:

```sh
python manage.py migrate
python manage.py provision_device inlet-01 --profile inlet \
  --hardware wroom32-4mb-v1 \
  --backend https://zcharmcmonitoring-production.up.railway.app \
  --output /PRIVATE_DIRECTORY/inlet-01.json
```

The command creates a random device token, stores only its SHA-256 in PostgreSQL,
and writes the provisioning JSON exclusively with mode 600; it never prints the
token. Repeating it with a new filename rotates the credential and immediately
revokes the old one. Transfer the file securely to the USB provisioning computer;
add `ssid` and `password` locally. Keep it outside Git (or in ignored
`firmware/provisioning/`). Then:

```sh
python -m pip install pyserial==3.5
python firmware/tools/provision.py --port /dev/YOUR_SERIAL_PORT \
  --file /PRIVATE_DIRECTORY/inlet-01.json
```

Repeat for outlet/control with their own role, ID and token. Credentials persist
in NVS across application updates. USB provisioning is accepted only while the
board is unprovisioned. Rotation or Wi-Fi changes currently require a deliberate
USB NVS erase/reprovision, which also clears attempt history; do not erase NVS
routinely during updates. NVS credentials are not encrypted in this bench setup.
OTA/status credentials currently authenticate only device management, not the
existing telemetry ingestion API. Native telemetry integration is separate work.

## Register, approve and observe a release

Download the signed manifest and its signature for each role from the GitHub
Release into a trusted directory. From `backend/`:

```sh
python manage.py import_firmware_release /PATH/TO/DOWNLOADED_RELEASE \
  --base-url https://github.com/OWNER/REPO/releases/download/firmware-v1.2.3
```

Registration verifies all three signed manifests using Railway's configured public
key; it imports atomically and leaves them disabled. In the real Django admin
`/admin/` (staff permissions required):

1. Review the version, role, hardware, source commit and GitHub release assets;
   enable the matching **Firmware releases**. Existing metadata is read-only.
2. In **Devices**, select the desired release for `inlet-01` and save. This records
   an approval generation and approving staff user. Observe the reported version,
   status, maintenance flag and last-seen time before proceeding with outlet.
3. Update control last, on the disconnected bench. The client requires maintenance
   mode and LOW output feedback both before transfer and activation. There is no
   dashboard button capable of approving or controlling these boards.
4. To withdraw a target, clear its desired release or disable the release/device.
   This affects future polls; it cannot cancel an update already downloaded.
5. After a failed boot, investigate the cause. To deliberately try the same target
   again, use **Approve another attempt for selected devices**. The new generation
   is audited. Never automate repeated retries of a crashing image.

Devices poll `/api/devices/<id>/ota` about once a minute, with their own bearer
token, after Wi-Fi and SNTP time are available. The backend returns no target
until approved. Downloads verify HTTPS certificates and follow only allowlisted
HTTPS GitHub redirects; backend credentials are never forwarded to asset hosts.
A signed matching manifest is checked before download. Binary bytes stream into
the inactive slot while their digest is calculated; hash, binary signature and
ESP image descriptor must all pass before the boot partition is changed.
Interrupted transfers leave the running app selected and may retry on later polls.
A verified attempt's generation persists before boot selection so a rolled-back
image is not automatically installed in a loop.

On first boot the app waits three seconds for FreeRTOS local-health task progress,
checks provisioning, free heap and (for control) LOW output readback/maintenance,
and confirms the pending image only if those checks pass. A reset before
confirmation causes ESP-IDF rollback; explicit failed local checks request
rollback. Cloud availability is not a local-health prerequisite. These are **bench
core checks**, not sensor correctness, plant safety or a sustained reliability
assessment. Add hardware-specific health checks before operational firmware.
Reports are authenticated device self-reports, not independent health attestation.

## Verification and remaining work

Host tests check signature tampering, trust mismatch, role/hardware mismatch,
image identity, metadata validation and immutable package output. Backend tests
check per-device authentication even with public reads, release revocation,
compatibility, credential rotation, report validation and staff approval auditing.
Native builds do not prove on-board behavior. Bench acceptance still requires
initial USB provisioning, good OTA, interrupted downloads, wrong-role rejection,
forced failed boot/rollback, explicit retry, power-cycle persistence and all three
physical boards. Never test failure injection on operating equipment.

Next implement native sensor/control adapters, local buffering and idempotent
HTTPS telemetry uploads, then validate equipment health/interlocks. No production
telemetry is generated by this release work. See the root verification guide for
the separately cancelled cloud simulation; it is not OTA evidence.

References: [ESP-IDF OTA/rollback](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html),
[PlatformIO ESP-IDF](https://docs.platformio.org/en/latest/frameworks/espidf.html),
[GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
