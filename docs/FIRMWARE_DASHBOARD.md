# Firmware dashboard: setup and operation

This feature adds a **Firmware** page to the monitoring dashboard. Authorized Django
staff can review signed releases, approve a target for one ESP32, withdraw that
target, and approve another attempt. CI/CD still builds, signs, publishes and
registers releases. Registration leaves releases disabled and assigns no devices.

These repository changes require deployment. A successful web test is not proof
that an ESP32 installed firmware. First follow the [OTA beginner guide](OTA_BEGINNERS_GUIDE.md)
for signing keys, the first USB flash, device credentials and a disconnected bench test.

## 1. Prepare Django

Back up the production database using your normal Railway backup process. Deploy
the backend first and run:

```sh
python manage.py migrate --noinput
python manage.py createsuperuser
```

The migration `0004_devicereport` stores new device state transitions. Existing
reported versions remain visible, but old transitions cannot be reconstructed.
Use an existing superuser instead of creating another if one already exists.

Set these Railway service variables (service variables override Docker defaults):

| Variable | Production value |
| --- | --- |
| `ALLOW_PUBLIC_READ` | `false` |
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECURE_SSL_REDIRECT` | `true` |
| `CSRF_TRUSTED_ORIGINS` | `https://zcharmc-monitoring.vercel.app` |
| `CORS_ALLOWED_ORIGINS` | `https://zcharmc-monitoring.vercel.app` |
| `OTA_SIGNING_PUBLIC_KEY` | Existing trusted public PEM, matching the flashed boards |

Keep the existing private `DJANGO_SECRET_KEY`, PostgreSQL `DATABASE_URL`, ingestion
key and CI registration credential. Never enter the private signing key into
Railway, Vercel, dashboard inputs or a device. The [CI/CD guide](FIRMWARE_CICD.md)
explains the signing secret used only by the release workflow.

The initial account is a superuser. For routine operations, create a Django group
in Django admin with these five permissions under **Monitoring**:

- Device: view and change
- Firmware release: view and change
- Firmware approval: view

Assign the group to an active staff user. Both staff status and all five permissions
are required. Ordinary active users can sign in to read monitoring data but cannot
manage firmware. A staff flag alone does not grant firmware operations.
Passwords are Django passwords; the old demo email/password login has been removed.
There is no public signup or password reset screen. Administrators manage accounts
and password changes in Django admin.

## 2. Deploy the frontend

Deploy `frontend/` to Vercel after the backend is ready. Its checked-in `vercel.json`
proxies `/backend/*` to the current Railway origin and prevents caching that prefix.
Browser API requests use that same-origin path. HttpOnly session cookies stay on
the dashboard origin; session IDs are not stored in localStorage. Browser writes
also require a CSRF token. Sessions expire after eight hours.

Socket.IO connects directly to Railway using a short-lived, single-use ticket
obtained through the authenticated proxy. A ticket is checked against the current
Django session when connecting. Logout invalidates future connections; an existing
socket can remain connected until it disconnects. Never include credentials in
`VITE_*` variables. Keep `VITE_BACKEND_URL` set to the Railway origin for sockets.

If the Railway hostname changes, update both the rewrite destination in
`frontend/vercel.json` and `VITE_BACKEND_URL`. For another dashboard domain, add
that exact HTTPS origin to both Django origin lists, then redeploy. Do not use a
wildcard CSRF origin just to make a login error disappear.

Keep Railway on one replica and one Gunicorn worker with the current in-memory
Socket.IO server/ticket cache. Horizontal scaling requires a shared cache and
Socket.IO message broker first. Many concurrent sockets also require revisiting
the current thread capacity; this feature does not resolve that infrastructure limit.

## 3. Use the page

1. Sign in at `/auth` with your Django username and password. Open **Firmware** in
   the sidebar. If it is missing, ask the administrator to check your permissions.
2. Open **Releases**. Find the version, role and hardware from the CI release.
   Check **Signature verified** and the source commit. Enable the release and
   confirm. Enabling alone does not assign or update any board.
3. Open **Devices** and search for a provisioned device ID. Click its ID. Compare
   its reported version, role, hardware, status and last contact.
4. Choose a compatible enabled release, select **Review update**, then confirm the
   exact device and version. The backend records the approver and increments the
   approval generation. Start with one disconnected bench board.
5. Click **Refresh** after the board's next report. Verify the reported version and
   status, inspect serial output and complete the physical checks in the beginner
   guide before approving other boards one at a time.

A control device additionally needs a maintenance report less than three minutes
old and your explicit maintenance confirmation. The page cannot place hardware
into maintenance mode or operate valves. Firmware must enforce its own safe state.
A server-side maintenance report is evidence supplied by the device, not independent
proof that connected equipment is safe.

**Withdraw target** prevents future offers to that device. **Disable** in Releases
prevents future offers of that release across assigned devices. Neither action can
cancel a download already underway or uninstall running firmware. Withdrawal does
not roll a device back. A replacement must be separately published and approved.

**Review another attempt** increments the approval generation for the assigned
release. Use it after diagnosing a failed attempt; repeated automatic retries are
not performed by this page. A device already reporting that version needs a new
release version for another installation. If an operation says the device changed,
close the dialog, refresh and review its latest state before trying again.

## 4. Understand the evidence

- Running version and status come from device reports; approval is not installation.
- Last contact means a report reached Django, not verified sensor operation.
  `recent` means less than three minutes at the last refresh; `stale` means older.
- History shows the latest 50 approvals and state transitions combined. Heartbeats
  refresh last contact without creating duplicate state events.
- Download percentage and detailed failure causes are not reported by the current
  firmware. Inspect the device serial console when investigating a failure.
- History is not a tamper-proof compliance log. Release availability changes are
  also recorded in the Django administration log.

## 5. Test locally before publishing

Use an isolated database. Follow the backend and frontend READMEs. Set
`ALLOW_PUBLIC_READ=false`, `DJANGO_DEBUG=true`, and include `http://localhost:3000`
in `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS`. Create a local Django user,
start Django on port 5001 and the frontend on port 3000. Vite proxies `/backend`
to port 5001 by default. To target another backend, set `VITE_BACKEND_URL` in the
shell starting Vite. Use labelled test devices and your own test signing key.

From `backend/`, with the local Python environment activated:

```sh
python manage.py test tests
python manage.py makemigrations --check --dry-run
```

From `frontend/`:

```sh
bun run lint
bun run tsc --noEmit --project tsconfig.json
bun run test
NITRO_PRESET=vercel bun run build
```

In a browser, verify real login, incorrect password rejection, staff device
assignment, withdrawal, another attempt, release enable/disable, history after a
test device report, refresh persistence and logout. Sign in as an ordinary user
and verify `/firmware` is denied. Repeat these checks through the deployed Vercel
proxy: local Vite success does not verify hosted cookie forwarding or CSRF origin
configuration. For login failures, inspect `/backend/api/auth/session` and login
responses; a CSRF 403 usually means cookies, the exact trusted origin or HTTPS
settings need correction. A missing API response may mean the proxy destination
or backend deployment is incorrect.

Finish with the supervised physical OTA test in the beginner guide, including
recovery and rollback. Do not treat a browser simulation as that test.
