# Telemetry reliability verification — 2026-10-07

## Scope

Isolated PostgreSQL, Gunicorn, real HTTP ingestion, Socket.IO and a local instance
of the existing dashboard. No production telemetry writes, firmware edits or mock
login changes. This proves application behavior under simulated faults, not actual
ESP32 buffering or industrial/cloud availability.

## Completed checks

- 28 backend tests passed against PostgreSQL, including inclusive sensor bounds,
  finite values, zero/null handling, empty/unknown fields, the 60-second future
  clock boundary, write rollback, retry/conflict counters, staff-only diagnostics,
  database health, and prior API regressions.
- Gunicorn HTTP, live WebSocket broadcast, polling reconnect, persistence,
  deduplication, Django admin and rejection of unsupported commands passed.
- A 30-second smoke simulation passed with 80 records, 29 duplicate retries,
  eight conflicts, four rejected invalid payloads, four actual backend restarts,
  14 delayed uploads, 20 missing-measurement samples and four full comparisons.
- Comparisons cover all persisted measurements and timestamps, latest ordering,
  latest-100 history, full CSV, full-window chart means/counts, durable operational
  counters, and actual frontend data helpers fed with real socket events.
- Local browser confirmed missing CO2/efficiency stay unknown, zero pressure remains
  0.0, historical charts render, and persisted readings appear in reports with
  missing fields shown as dashes. Reload and reconnect restored persisted state.
- During an intentional backend outage, history/reports showed an error and loaded
  successfully after Retry/Apply filters. Reports do not retry automatically.
- The browser CSV action uses a new window; this in-app browser did not expose a
  completed download event. CSV contents are verified through the real HTTP export
  endpoint, but a normal-browser download remains a separate manual check.
- The existing development-only Lovable hydration attribute warning remains.

## Three-hour soak — pending

Active run: `SYNTHETIC-SOAK-2f63ef16f72b`, started at 2026-10-07 15:17:55 Asia/Manila.
Requested duration: 10,800 active seconds, with inlet/outlet pairs every 15 seconds.
The final result must not be reported as passed until the runner's final comparison
and requested elapsed duration are complete. A follow-up is configured to collect
that result. Keep the computer and Codex app awake for the local run and follow-up.

Local evidence directory: `/private/tmp/zcharmc-soak-20261007-v2/`:
`report.json`, `operations.json`, `dashboard-fixture.json`, `backend.log` and
`dashboard.png`. The JSON report's `browser_verified: false` distinguishes the
runner's automated helper checks from the separate browser observations above.

An earlier long-run attempt stopped because the runner waited too briefly for
Gunicorn to close an open browser socket. The runner now uses a short graceful
shutdown and forced process-group cleanup. The active run has already passed a
restart with the browser connected; the interrupted attempt is not counted.

## Deployment

Repository changes require deployment; this verification does not claim they are
live on Railway or Vercel. Run migration `0002_ingestionstatus` before updated
backend traffic (the existing Railway pre-deploy migration command does this).
Diagnostics are available through Django admin's Ingestion statuses page and
staff-authenticated `/api/operations`. No frontend configuration change is needed.
