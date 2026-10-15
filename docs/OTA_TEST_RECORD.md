# OTA acceptance test record

Copy this template for each bench session. Fill in observations and links to
evidence; do not replace blanks with assumed values. Never include secrets,
provisioning JSON, Wi-Fi passwords or private signing keys.

**Initial status: physical acceptance is not recorded.** This template is not
evidence that any board has been flashed or updated. Follow
[the beginner guide](OTA_BEGINNERS_GUIDE.md) for the test order.

## Session and environment

| Field | Value |
| --- | --- |
| Tester / date / timezone | |
| Hardware maintainer confirming board compatibility | |
| Exact board model / revision / measured flash size | |
| Board ID / role / hardware ID | |
| Actuators disconnected | |
| Starting version / target version | |
| Release tag / full source commit | |
| GitHub Actions run URL / release URL | |
| Backend environment / deployed commit | |
| Public-key fingerprint (public information only) | |
| Known-good USB recovery procedure / maintainer | |

## Results

Use **PASS**, **FAIL** or **NOT RUN**. Include timestamp and evidence location
without copying credentials. Software-only tests and physical tests are separate.

| Test | Result | Evidence / observation |
| --- | --- | --- |
| Local host package/delivery tests | NOT RUN | |
| Backend tests; database engine recorded | NOT RUN | |
| Inlet, outlet and control compilation | NOT RUN | |
| CI for the exact release commit | NOT RUN | |
| Tagged release/signature/publication jobs | NOT RUN | |
| Published binary verification and Django registration | NOT RUN | |
| Three releases initially disabled; no assignment changes | NOT RUN | |
| Initial USB install on confirmed compatible board | NOT RUN | |
| USB provisioning and periodic cloud status | NOT RUN | |
| No-assignment test leaves version unchanged | NOT RUN | |
| Assigned correct-role OTA reaches target version | NOT RUN | |
| Confirmed startup; continued reports and no reboot loop | NOT RUN | |
| Power cycle after confirmation preserves identity/settings | NOT RUN | |
| Outlet role accepted on its own board | NOT RUN | |
| Control role accepted on disconnected bench | NOT RUN | |
| Registration retry preserves enablement and assignments | NOT RUN | |
| Wrong role/hardware rejection (state test layer) | NOT RUN | |
| Tampered image/manifest rejection (state test layer) | NOT RUN | |
| Interrupted transfer; previous app remains bootable | NOT RUN | |
| Controlled failed first boot; serial-confirmed rollback | NOT RUN | |
| Failed generation does not reinstall repeatedly | NOT RUN | |
| Explicit staff retry is recorded and scoped to one device | NOT RUN | |

## Decision

| Field | Value |
| --- | --- |
| Remaining failures / untested cases | |
| Related issue references, including provisioning/recovery limits | |
| Cleared for further disconnected bench testing by / date | |
| Operational readiness decision and supporting hardware evidence | |

OTA success does not validate sensor calibration, actuator polarity, interlocks,
the operating cycle, cellular connectivity, or industrial availability. These
functions need their own evidence when implemented.
