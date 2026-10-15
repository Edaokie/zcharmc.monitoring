# OTA release foundation: local verification

## Firmware dashboard verification: 2026-10-15

The working tree now adds real Django browser sessions, a staff Firmware page,
release enable/disable, selected-device targets, withdrawal and explicit retries.
The [dashboard guide](FIRMWARE_DASHBOARD.md) covers deployment and operator steps.
This addition has not been pushed or deployed, and no board was flashed.

- 47 backend tests passed against isolated SQLite, including browser CSRF/login,
  staff permissions, compatibility/signature checks, control maintenance gating,
  stale-generation rejection, audit history and socket ticket replay/logout.
- 13 frontend tests and 10 firmware host tests passed. TypeScript and the Vercel
  production build passed; lint has no errors and eight existing warnings.
- Django migration consistency passed. Migration `0004_devicereport` is required.
- A local browser connected through the Vite proxy to real Gunicorn/Django with
  disposable test accounts, devices, signed metadata and a separate SQLite file.
  Incorrect login was rejected. Staff enabled a release, approved a device,
  approved another attempt and withdrew its target. Three approval records and
  the withdrawn target persisted after reload. A synthetic device HTTP report
  appeared as a new version/state event. Logout and ordinary-user denial of the
  Firmware page were verified. The ordinary account also connected to authenticated
  Socket.IO monitoring. The narrow layout was inspected and its sidebar corrected.

These are web/control-plane checks, not an ESP32 download, reboot or rollback test.
Production Vercel proxy/cookie forwarding, Railway variables, PostgreSQL locking,
the release workflow and physical OTA acceptance still require deployed verification.
No firmware C source changed in this addition; the three earlier image builds were
not repeated.

## Current readiness: 2026-10-15

The CI/CD registration implementation is present in local commit `23b2c8e`.
This is a candidate for controlled, disconnected bench deployment, not a final
production or physically accepted OTA system. Current GitHub environment settings,
the deployed backend commit, a tagged cloud run and physical ESP32 behavior were
not verified in this documentation pass.

Checks rerun on 2026-10-15:

- All 39 backend tests passed using an isolated SQLite test database; Django
  system checks passed and no model migrations were pending. This pass did not
  repeat PostgreSQL testing.
- All 10 firmware host tests passed, including signed-package verification,
  registration retries, redirect refusal and credential handling. These tests
  do not execute the ESP32 C application on hardware.
- Firmware release and firmware CI workflows passed Actionlint 1.7.7 with its
  optional ShellCheck/Pyflakes integrations disabled.
- All three native profiles built earlier in this review on 2026-10-15; no C
  source changed in this documentation pass. Builds are not physical acceptance.

Open firmware findings from the source review remain: multi-key provisioning can
be interrupted into a partially provisioned state; device-side backend origin
validation is incomplete; and saving an attempt before boot selection can cause
an ambiguous rollback report after a power interruption. No fix for these findings
is claimed by the CI/CD or documentation work.

Start with [the beginner guide](OTA_BEGINNERS_GUIDE.md), complete owner settings in
[the CI/CD guide](FIRMWARE_CICD.md), and record physical results using
[the acceptance template](OTA_TEST_RECORD.md). Confirm the exact LilyGO board
variant against the current generic 4 MB build before any upload.

## Historical verification: 2026-10-07

Verified 2026-10-07 against the working-tree implementation. No GitHub release was
published, no hosting configuration was changed, and no physical board was flashed.
The frontend/mock login was unchanged. The cancelled telemetry soak remains a
separate record in TELEMETRY_VERIFICATION.md; it is not evidence of OTA behavior.

## Checks completed

- PlatformIO 6.1.19, Espressif32 7.0.1, native ESP-IDF 6.0.1: all three roles built.
- Inlet image: 974,880 bytes; outlet: 974,880 bytes; control: 981,472 bytes.
  Each fits its 1,703,936-byte inactive application slot.
- Generated configurations confirmed 4 MB flash and bootloader application rollback
  enabled for all three profiles. Image descriptors contain the correct role and
  `0.0.0-dev` development version.
- Six host release tests passed: all-role packages, immutable output, altered
  binary/manifest, wrong trust key, wrong role/hardware, malformed metadata/path
  escape, and swapped embedded role/version.
- The actual three compiled binaries were packaged, signed and independently
  verified locally with a disposable test key. That key/package was deleted. The
  production trust key was not used to publish an uncommitted development build.
- Django checks, migration consistency, migrations and static collection passed
  against isolated PostgreSQL. All 36 backend tests passed, including eight OTA
  cases covering device authentication despite public reads, compatibility,
  tampering, target revocation, credential rotation, private file permissions,
  atomic import, disabled-by-default releases, status reports and audited approvals.
- Live Gunicorn HTTP/WebSocket broadcast, polling reconnect, telemetry deduplication,
  admin login and rejection of unauthenticated ingestion/control passed in the
  isolated existing integration harness. No production data was written.
- Private signing key is ignored by Git. Public key is tracked as a trust anchor.

## What still needs verification

The repository owner must configure GitHub environment reviewers, tag protection
and the matching signing secret, deploy the backend migration/public key, register
and provision devices, and import/approve a release. Naming a GitHub environment
in a workflow does not configure those protections on the account.

Before USB installation, confirm each WROOM32 board's actual flash capacity,
wiring, relay polarity and boot-time pin states. New native images currently
provide OTA/status only: sensor adapters, measurement buffering/uploads and the
operating control cycle are not implemented. Control is a maintenance-only bench
image and must be tested with equipment disconnected.

Physical acceptance needs a good OTA on each role, wrong-role/tampered image
rejection, interrupted transfer without losing the running app, forced failed
pending boot and rollback, operator-approved retry, credential persistence, and
confirmation that real equipment health checks prevent unsafe activation. Current
local health checks cover task progress, provisioning, heap and maintenance output
readback; they do not validate sensors or plant safety. Industrial uptime and
actual firmware buffering have not been proven.

Follow [firmware/README.md](../firmware/README.md) for owner setup and test order.
