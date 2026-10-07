# ZCharMC dashboard

The React/TypeScript dashboard uses TanStack Start and runs on Vercel in the cloud.
It reads measurements and reports from Django on Railway, with live updates over
Socket.IO. It does not connect directly to PostgreSQL or receive device uploads.

## Local development

Use Node.js 24 and Bun 1.3.14, matching frontend CI. Start the
[local Django backend](../backend/README.md#local-development) first. From the
repository root:

```sh
cd frontend
bun install --frozen-lockfile
cp .env.example .env
bun run dev --port 3000
```

Open `http://localhost:3000/dashboard`. The example environment uses
`VITE_BACKEND_URL=http://localhost:5001`. Use the backend origin without `/api` or a
trailing slash. The backend's CORS configuration must include `http://localhost:3000`;
the backend example already includes it. If a different port or hostname is used,
add that exact origin to the local backend configuration.

The current dashboard uses mock login and sends no Django authentication token.
Enable `ALLOW_PUBLIC_READ=true` only on a backend whose data may be publicly read;
for development, use an isolated local test database. Restart the backend after
changing its local settings. Django admin uses a real Django account separately.

An empty database shows no telemetry. See the [synthetic test guide](../backend/tools/README.md)
for controlled test readings. Firmware does not need to be changed for these tests.

## Checks

From `frontend/`:

```sh
bun run lint
bun run tsc --noEmit --project tsconfig.json
bun run test
NITRO_PRESET=vercel bun run build
```

Tests cover reading ordering, retry/reconnect deduplication, missing measurements,
freshness, adsorption efficiency and alert filtering/export. These checks complement
browser verification; they do not prove a deployed backend or physical device works.

## Vercel deployment

Use `frontend` as the project root. The checked-in [vercel.json](vercel.json) defines
the build and the intended production backend URL. Follow the
[cloud setup guide](../docs/CLOUD_SETUP.md) for account settings and Git deployments.
A changed `VITE_BACKEND_URL` requires rebuilding the frontend. Never put ingestion
keys, database passwords or Django tokens in `VITE_*` variables or browser code.

## Dashboard behavior

Summary cards use the latest measurement for each node. Delayed uploads can appear
in history without replacing newer measurements. Missing values stay unknown;
zero remains a real measurement. Freshness uses measurement timestamps and expires
after 60 seconds, independently of whether the backend connection is open.

Historical dashboard charts use full-window averages and show gaps for missing
measurements. CSV exports contain raw readings. Alerts describe recorded threshold
breaches and do not claim that a problem was resolved. Valve and vacuum cards show
reported state only; remote controls are unavailable.

Mock login is retained for the current demonstration. It is not production
access control. See the [project limitations](../README.md#current-limitations)
and [maintenance guide](../docs/MAINTENANCE.md).
