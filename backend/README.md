# ZCharMC Django backend

Django 5.2 LTS, Django REST Framework, PostgreSQL, and Socket.IO. The existing
React frontend stays on Vercel; Railway runs this directory as a separate service.
Firmware is unchanged. This migration does **not** make the equipment cloud-connected
or suitable for unattended industrial operation by itself.

## Local development

Use Python 3.12. From `backend/`:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
docker compose up -d postgres
python manage.py migrate
python manage.py createsuperuser
python manage.py collectstatic --noinput
gunicorn config.wsgi:application --config gunicorn.conf.py
```

Replace both example secrets. The API listens on port 5001; `/admin/` is Django
administration. Use the Gunicorn entry point for Socket.IO. Django's `runserver`
only serves HTTP APIs and admin, not the Socket.IO wrapper.

To work without PostgreSQL locally, remove `DATABASE_URL` and explicitly set
`ALLOW_SQLITE=true`. SQLite is never an automatic production fallback.

```sh
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test tests
```

GitHub Actions runs these checks against PostgreSQL 16 and builds the Docker image.

## Railway setup (one-time account settings)

1. Connect `Edaokie/zcharmc.monitoring` through Railway's GitHub integration.
2. Set the application's **Root Directory** to `/backend` and **Config File Path**
   to `/backend/railway.json`. Leave Watch Paths empty to rebuild every pushed
   commit on the selected deployment branch. The current checkout uses `develop`;
   select the same branch in Railway and Vercel for production if that is your
   intended release branch. A local commit that has not been pushed does not deploy.
3. Add a PostgreSQL service named `Postgres` and attach its database reference to
   the application: `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Use private networking.
4. Set these application variables in Railway, not in Git:

   | Variable | Value |
   | --- | --- |
   | `DJANGO_SECRET_KEY` | Long randomly generated secret |
   | `DJANGO_DEBUG` | `false` |
   | `DJANGO_SECURE_SSL_REDIRECT` | `true` (Railway terminates HTTPS and forwards the protocol) |
   | `DJANGO_SECURE_HSTS_SECONDS` | `3600` after confirming HTTPS works |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `CORS_ALLOWED_ORIGINS` | `https://zcharmc-monitoring-u2m5-murex.vercel.app` |
   | `CSRF_TRUSTED_ORIGINS` | `https://zcharmc-monitoring-u2m5-murex.vercel.app` |
   | `INGEST_API_KEY` | Different randomly generated secret; never a Vercel `VITE_*` variable |
   | `ALLOW_PUBLIC_READ` | `true` only for the existing demo frontend; see authentication below |

   `RAILWAY_PUBLIC_DOMAIN` is automatically added to allowed hosts. Add a custom
   domain to `DJANGO_ALLOWED_HOSTS` if one is used. Do not use `*` for allowed origins.
5. Generate a public HTTPS domain. Set Vercel's `VITE_BACKEND_URL` to that origin
   without `/api` or a trailing slash, then redeploy the frontend.
6. Enable **Wait for CI** and GitHub autodeploys. Migrations execute in the pre-deploy
   step; failed migrations or a failed database readiness check block deployment.
7. Keep one application replica and one Gunicorn worker. Socket.IO broadcasts are
   process-local. Scaling requires a shared message manager and transport review.
8. Set budget alerts and confirm the plan can support the expected usage. Provision
   an admin account using `python manage.py createsuperuser` through a secure Railway
   service session. There are no seeded production credentials.

Do not set serverless sleeping as a substitute for continuous availability.
Configure database backups and test restoration before collecting valuable data.
Use additive migrations; rolling back application code does not undo schema changes.

## Vercel and automatic deployments

The frontend's `vercel.json` enables Git deployments, forces the build step, sets
the Nitro Vercel target, and disables cancellation of older builds on newer pushes.
In the existing Vercel project, verify:

- Git repository connected to `Edaokie/zcharmc.monitoring`.
- Root Directory `frontend`, matching production branch, and Git deployments enabled.
- Disable skipping unaffected projects if every repository push must rebuild.
- Set `VITE_BACKEND_URL` for each intended environment. Do not point untrusted previews
  at private production data. Add only specific trusted preview origins when needed.

Native hosting integrations deploy; GitHub Actions validates code. No hosting tokens
are stored in workflow files, and adding workflows alone does not connect accounts.
Vercel creates previews for non-production branches; Railway deploys its connected
branch. Both build every push to their configured production branch when skip/watch
filters are disabled. Hosting quotas can still prevent a deployment.

## Free plans and availability

As checked on 2026-10-07, Railway Free includes $1 of usage credit per month, with
0.5 GB RAM and 0.5 GB volume limits per service. This is a resource budget, not a
promise of an always-on free Django + PostgreSQL installation. Frequent telemetry
and database storage consume resources even with no dashboard users. Monitor usage
and plan retention before the volume fills. No automatic data deletion is enabled.

Vercel Hobby is restricted to personal/non-commercial use. An industrial commercial
deployment needs an eligible plan. This configuration targets development within
your requested free-plan constraint; it cannot guarantee industrial 24/7 cloud uptime.

- https://docs.railway.com/pricing/plans
- https://docs.railway.com/deployments/github-autodeploys
- https://vercel.com/legal/terms

## Authentication and current frontend compatibility

Reads are private by default. Django session authentication and DRF user tokens are
supported. `POST /api/auth/token` accepts real Django `username` and `password` and
returns a token; HTTP reads use `Authorization: Token <token>`, Socket.IO connections
use `auth: { token }`. Account creation is through Django admin. Token issuance is
not a replacement for login rate limiting and a production browser session design.

The existing frontend still uses simulated browser-side login and does not send
backend credentials. `ALLOW_PUBLIC_READ=true` permits REST and Socket.IO reads for
demo compatibility; it makes telemetry public regardless of the frontend login.
CORS is not authentication. Never enable this for confidential industrial data.
Frontend authentication integration is separate from this backend migration.

Telemetry writes always require `Authorization: Bearer <INGEST_API_KEY>` and JSON
at `POST /api/ingest`. This is a shared compatibility ingestion key; provision
per-device credentials before a fleet deployment. Neither the shared key nor user
tokens should be embedded in public frontend code.

```json
{
  "node_id": "inlet",
  "message_id": "boot-session-uuid:42",
  "timestamp": "2026-10-07T04:00:00Z",
  "co2": 1200,
  "temperature": 28.5,
  "humidity": 65,
  "pressure1": 120
}
```

Use unique message IDs per node across reboots. Repeated IDs return the existing
record and do not broadcast twice. Without an ID, each request creates a reading.
Acknowledgment occurs after database commit. Missing measurements stay null rather
than being fabricated as zero. Timestamps use UTC; absent timestamps use server
receipt time. Device uptime is not a valid absolute measurement time.

Valve telemetry accepts `node_id: solenoid_valves` and a `valves` array of
`{ id, label, open }`. Latest snapshots survive application restarts. The API keeps
the existing `/api/latest`, `/api/history`, `/api/history/<node>`, `/api/readings`,
`/api/stats`, `/api/alerts`, `/api/export/csv`, and Socket.IO event names. Pressure
fields are now stored and included in statistics. History uses timestamps, not
independent table IDs. `/api/history/solenoid_valves` returns an empty list, so the
existing dashboard's combined historical request does not fail.

Actuation is intentionally unavailable: the backend returns a Socket.IO error for
valve/vacuum commands. The existing frontend optimistically changes controls and
shows success without acknowledgments; those displays are not physical confirmation.
Its alert resolution labels and settings save behavior also remain frontend work.

## Existing MQTT firmware

Unchanged firmware publishes to a private LAN MQTT broker. Railway cannot reach
that address. The cloud API will run, but physical readings will not arrive simply
because this repository is deployed.

For temporary compatibility, run the optional bridge on an existing computer that
can reach the broker and the cloud API (no Raspberry Pi required):

```sh
python manage.py mqtt_bridge --broker <reachable-broker> --api-url https://<railway-domain>
```

Configure `INGEST_API_KEY` locally, plus `MQTT_USERNAME` and `MQTT_PASSWORD` if needed;
use `--tls --port 8883` for a TLS broker. The bridge forwards through the API so
committed readings are broadcast to dashboard clients in the same server process.
The bridge has no durable outage queue and is not deployed automatically. It strips
the existing firmware's numeric uptime timestamp and uses receipt time. The current
firmware still sends placeholder readings and has blocking reconnect behavior.

## Import existing SQLite data

The checked-in `instance/co2.db` is preserved as legacy data and is never used by
the production server. Back it up, then run against the destination PostgreSQL DB:

```sh
python manage.py import_legacy instance/co2.db --timezone Asia/Manila
```

The importer reads the source in read-only mode and supports current per-node tables
or the older combined table. Re-running it does not duplicate records. The timezone
must match the host that wrote the original naive timestamps. Use a secure local
connection to PostgreSQL or a temporary mounted source file for a Railway import;
the Docker image excludes `instance/` and does not ship the legacy database.
