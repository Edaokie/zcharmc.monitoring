# OTA release foundation: local verification

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
