# Maintaining ZCharMC Monitoring

This guide is for maintainers of the frontend and backend. Firmware integration
and replacement of mock login are separate work. Start with the
[project overview](../README.md) and [cloud setup](CLOUD_SETUP.md).

## Before releasing changes

1. Review changes and run the relevant checks in the
   [frontend guide](../frontend/README.md#checks) and
   [backend guide](../backend/README.md#local-development). GitHub Actions repeats
   checks on pushes and pull requests, including a short isolated fault simulation.
2. Check whether database migrations or new API endpoints are required. Apply
   migrations before updated backend traffic. When the dashboard needs a new
   endpoint, deploy the backend before the frontend. The current diagnostics
   require migration `0002_ingestionstatus`.
3. Push to the intended deployment branch. Confirm both hosting projects are
   connected to that branch and inspect their actual build/deployment results.
   A green GitHub check is not proof that either hosting deployment succeeded.
4. Confirm the deployed commit and configuration, then check backend health,
   dashboard connection, historical reports and CSV export. Refresh and reconnect
   the dashboard to verify persisted state.
5. Record the environment, commit, time and observed results. Distinguish automated
   tests, browser observations and physical-device verification.

Use the [test tools](../backend/tools/README.md) for repeatable verification. The
isolated simulator never writes production data. The deployed verification script
explicitly creates six synthetic records and leaves them stored. Run it only in
the intended environment with authorized access, and record the returned IDs.
Charts and CSV do not show the synthetic message label, so identify the test period
when interpreting data. Do not automatically seed production on every deployment.

## Diagnose missing or stale readings

| Observation | Check next |
| --- | --- |
| Backend health fails | Railway application logs, database availability and service configuration |
| Backend is connected but measurements are stale | Last received upload per node, last measurement time and sender connectivity |
| Uploads arrive but measurement time is old | Delayed backlog or an incorrect device clock; receipt and measurement time are different |
| Upload is rejected | HTTP status, validation response and ingestion failure counters |
| Duplicate count increases | Lost acknowledgements or retries; identical retries should not create extra readings |
| Conflict count increases | The sender reused a message ID with different data; preserve the original payload and investigate |
| API reads work but the dashboard fails | Frontend backend URL, exact allowed browser origin and browser errors |
| Historical request fails during an outage | Restore the backend, then use Retry or Apply filters; reports do not retry automatically |

`GET /api/health` checks current database connectivity. Django admin's **Ingestion
statuses** page and staff-authenticated `GET /api/operations` show persistent
per-node counters and upload times. Mock frontend admin roles do not grant access
to these diagnostics. The ingestion key authorizes uploads, not staff access.

Counters survive backend restarts. Requests that never reach the backend cannot
be counted there. Database failures cannot be written into an unavailable database;
check application logs alongside health and upload age. These diagnostics do not
send notifications or replace an independent uptime monitor.

## Protect and recover stored data

- Confirm a database backup policy with the hosting owner, including frequency,
  retention, access permissions and the acceptable amount of data loss.
- Test restoration into a separate database. Check record counts, latest readings,
  historical reports and exports before considering recovery verified.
- Keep the existing PostgreSQL service and volume when redeploying application code.
  Do not recreate the database to resolve an application deployment failure.
- Monitor storage and upload volume. Define retention and archival requirements
  before adding automatic deletion; none is currently enabled.
- Prefer additive database migrations. Rolling application code back does not undo
  a database migration; assess schema compatibility before a rollback.

## Configuration and access

Store credentials in the hosting services or ignored local environment files.
Document variable names and purposes rather than real values. Never copy secrets
into issue descriptions, screenshots, test reports, frontend bundles or Git commits.

`ALLOW_PUBLIC_READ=true` makes telemetry and exports public regardless of the
mock login. CORS controls browser origins, not access authorization. Confidential
industrial data requires real frontend/backend authentication before rollout.
The current shared ingestion key also needs a per-device credential and rotation
strategy before a fleet deployment.

## Keep documentation accurate

Update the relevant guide when behavior or configuration changes:

| Change | Document |
| --- | --- |
| Purpose, architecture or major limitation | [Main README](../README.md) |
| Frontend setup or dashboard behavior | [Frontend README](../frontend/README.md) |
| Backend setup, validation, units or API diagnostics | [Backend README](../backend/README.md) |
| Hosting settings or future device upload contract | [Cloud setup](CLOUD_SETUP.md) |
| Test commands or simulation behavior | [Test tools](../backend/tools/README.md) |
| Completed checks and outstanding verification | [Verification record](TELEMETRY_VERIFICATION.md) |

Mark work as planned, implemented, tested or deployed according to the available
evidence. Keep dated verification results separate from reusable setup instructions.
