# Verify the deployed cloud data flow

This is an explicit, one-time synthetic test, not an automatic seed on deployment.
The script leaves six readings stored for browser inspection. Each row has a
`message_id` beginning with `SYNTHETIC-CLOUD-TEST-`. Charts and CSV do not display
that label, so treat the test period as synthetic when interpreting results.
No firmware, login, valves, or vacuum actuators are changed.

## Deploy the checked-in settings

Push these changes to the GitHub branch connected to both production services.
`frontend/vercel.json` sets the production build's `VITE_BACKEND_URL`.
`backend/Dockerfile` supplies `ALLOW_PUBLIC_READ=true` and the production
`CORS_ALLOWED_ORIGINS` as non-secret image defaults. Railway's explicitly set
service variables override Docker defaults: an existing `ALLOW_PUBLIC_READ=false`
must be corrected by the hosting owner. While public reads are enabled, Django
always includes `https://zcharmc-monitoring.vercel.app` in both REST and Socket.IO
allowed origins, retaining any additional origins from service variables.
The Django settings used outside the container still default to private reads.

After both deployments finish, `/api/latest` should return HTTP 200, and the
dashboard should connect. These settings do not create synthetic data by themselves.

## Owner settings if existing variables override the files

In the Railway **backend service**, set:

- `ALLOW_PUBLIC_READ=true` (approved for this test; makes readings and exports public).
- `CORS_ALLOWED_ORIGINS=https://zcharmc-monitoring.vercel.app`.
- `INGEST_API_KEY` to an existing private ingestion secret. Do not share it in chat.

If additional dashboard origins are needed, add them as comma-separated exact
origins. Redeploy Railway after applying changes.

In the Vercel project serving **https://zcharmc-monitoring.vercel.app**, set the Production variable:

```text
VITE_BACKEND_URL=https://zcharmcmonitoring-production.up.railway.app
```

Redeploy Vercel: Vite embeds this value at build time. The production API bundle
at `zcharmc-monitoring.vercel.app` inspected on 2026-10-07 still contained
`http://localhost:5001`.

## Run the test

Deploy the script with the backend, then use the backend's Railway SSH session:

```sh
cd /app
python tools/verify_cloud_flow.py
```

Keep the Vercel dashboard open on Realtime before running. The script reads its
secret from Django settings, posts through the actual public ingestion endpoint,
and checks public read permissions and CORS before writing. It checks database
rows in the container's configured PostgreSQL database against API acknowledgments,
polling events, retry deduplication, history, CSV, and reconnect recovery. A failure
prints any inserted IDs so partially completed runs can be identified. Do not run
with a backend URL pointing to a different environment from this container.

The latest values should be **inlet CO2 1234** and **outlet CO2 566**. Then:

1. Confirm both values appear without refreshing (live browser updates).
2. Select a historical range and confirm the three points per node.
3. Open Reports, choose the test period, and export CSV. Match reading IDs to the
   script output (CSV omits `message_id`).
4. Refresh the dashboard and confirm the latest values return.
5. Close and reopen the dashboard to confirm reconnect recovery.

The script's PASS verifies the backend path, not browser rendering or the ESP32.
Do not mark the complete deployed flow passed until the browser checks also pass.
Test data remains stored; any removal must target only the recorded test IDs.

## Isolated fault simulation and three-hour soak

This runner **never connects to production**. It creates disposable PostgreSQL,
starts Gunicorn on loopback, and writes only `SYNTHETIC-SOAK-*` inlet/outlet records.
Use Python 3.12 and Node 24. From `backend/`, install the ordinary requirements plus
`pip install -r tools/requirements-simulation.txt`, then run:

```sh
python tools/simulate_telemetry.py --output /tmp/zcharmc-soak
```

Default: three hours, one inlet/outlet pair every 15 seconds. For a quick check:

```sh
python tools/simulate_telemetry.py --duration-seconds 30 --interval-seconds 1 --output /tmp/zcharmc-smoke
```

Pass `--node /absolute/path/to/node` if Node 24 is outside PATH. Optional `--port`
sets a known **local** backend port for browser inspection. Do not point the
production dashboard at it. Start a local frontend with `VITE_BACKEND_URL` set to
the reported loopback URL and use port 5094, whose origin is allowed by the runner.
The existing mock login is unchanged. Keep the computer awake during the run.

Faults cover lost acknowledgements (identical committed retries), conflicting
retries, actual backend connection refusal, a simulated sender queue, out-of-order
backlog, omitted/null measurements, backend process restarts and viewer reconnects.
Empty readings, future clocks and out-of-range values are also submitted and
must be rejected. Both current telemetry and the backend use real elapsed time;
the simulator does not pretend a 30-second run is a three-hour test.

Periodic comparisons check every accepted measurement against PostgreSQL, latest,
latest-100 history, full CSV, full-window chart bucket counts and means, persisted
operational counters, and actual frontend ordering/null/efficiency helpers using
real Socket.IO events. A final comparison must pass before `status: passed`.

`report.json` is atomically updated with elapsed time, fault counts and results;
`operations.json` is a diagnostic snapshot; `dashboard-fixture.json` contains
synthetic socket events and expected latest state; `backend.log` holds server logs.
The runner deletes its temporary database and stops its backend on exit. Output
artifacts remain. Ctrl-C or SIGTERM marks an interrupted run and cleans up.

Automated helper verification is distinct from browser rendering: `browser_verified`
remains false. Inspect the local dashboard live, reload it, choose historical views,
and download its CSV separately; record that evidence alongside the report. The
sender queue is simulated Python code, so this does not validate ESP32 firmware,
flash buffering, sensor calibration, actual WAN outages, or cloud hosting uptime.
The production Vercel/Railway integration needs its own deployment verification.
