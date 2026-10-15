# Firmware CI/CD

Firmware pushes and pull requests run host tests and build `inlet`, `outlet` and
`control`. Their unsigned bench artifacts are retained for 14 days.

A unique `firmware-vX.Y.Z` tag runs the signed release workflow:

1. Check delivery configuration, validate the version and run host tests.
2. Build all three profiles from the tagged commit using that version.
3. Sign and verify each binary and canonical manifest with the provisioned trust key.
4. Publish versioned assets in a GitHub Release.
5. Download published assets and verify signatures, hashes, role identities,
   version, hardware consistency and the commit resolved from the tag.
6. Register the signed manifests in Django. New records are disabled.

Device installation requires staff review, release enablement and a desired
release assignment in Django admin. Registration never modifies device approvals,
approval generations, or an existing release's enabled state. Follow the hardware
acceptance and maintenance procedures in [the firmware guide](../firmware/README.md).

## One-time owner configuration

Deploy the backend changes before attempting a tagged release. This change adds
an endpoint and settings; it requires no database migration beyond the existing
OTA schema migrations.

Set these variables on the Django service:

| Variable | Value |
| --- | --- |
| `OTA_SIGNING_PUBLIC_KEY` | Exact public PEM in `firmware/keys/release-public.pem` |
| `OTA_RELEASE_REPOSITORY` | `Edaokie/zcharmc.monitoring` |
| `OTA_RELEASE_REGISTRATION_KEY` | New, long random secret dedicated to registration |

Generate the registration secret locally with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`.
Copy it securely into the two service settings; do not commit it or put it in a
browser variable. Do not reuse ingestion keys, device credentials or staff tokens.
An empty registration key disables the endpoint.

In GitHub Settings → Environments, configure `firmware-release`:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `FIRMWARE_SIGNING_PRIVATE_KEY` | Existing private PEM matching the tracked public key |
| Secret | `OTA_RELEASE_REGISTRATION_KEY` | Same registration secret configured on Django |
| Variable | `OTA_BACKEND_URL` | Public HTTPS backend origin, without `/api` or a query string |

Keep the existing signing key; generating another breaks trust with provisioned
boards. Configure environment reviewers where supported by the repository plan
and restrict deployment tags to `firmware-v*`. The registration job uses the same
environment and may require approval too. Protect release tags and review workflow
and trust-anchor changes. Enable Actions; only the release job requests
`contents: write` for publishing assets.

The ESP32 downloader requires public GitHub release assets. The workflow refuses
private repositories; it does not change repository visibility. Private delivery
needs a separate design.

## Publish a version

Commit and push reviewed changes first. After CI passes, tag the tested commit:

```sh
git tag firmware-v1.2.3
git push origin firmware-v1.2.3
```

Use a new version for every release; never move a published tag or replace assets.
All three roles are currently released together, but each device is assigned and
updated separately. Bench builds still target `wroom32-4mb-v1`; confirm the actual
LilyGO board variant and pin/flash configuration before flashing those boards.

After Actions succeeds, inspect all three records in Django admin. Confirm version,
hardware, role and source commit, enable the reviewed releases, and assign the first
selected device. Observe its report before expanding installation.

## Recover a failed registration

Published assets remain available if the backend is unreachable or rejects a
package. The client retries connection failures and HTTP 429/5xx responses up to
three times. It does not retry authentication errors, conflicting metadata or
HTTP redirects, and never forwards its credential to a redirect target.

Fix the backend URL, credentials, configured repository/public key, or availability.
Then rerun the failed registration job. Alternatively, open GitHub Actions →
**Signed Firmware Release** → **Run workflow** on the reviewed default branch and
enter the existing `release_tag`. This mode verifies and registers existing assets;
it does not rebuild or republish.

Identical registration returns success without changing existing records. A
conflicting manifest or asset URL returns HTTP 409 and rolls back the package;
publish a new version to resolve it. Valid RSA-PSS signatures may differ for the
same immutable manifest; retries preserve the original stored signature.

## Registration API

`POST /api/firmware/releases/register` requires
`Authorization: Bearer <OTA_RELEASE_REGISTRATION_KEY>`. Public-read mode, device
tokens and staff sessions do not grant registration access. JSON contains `base_url`
and exactly three `releases`, each with only `manifest` (exact signed JSON string)
and `signature` (base64).

Django checks all manifest signatures against its configured trust anchor, accepts
only the configured repository's version-tag asset URL, and requires one inlet,
outlet and control manifest sharing version, hardware and commit. The CI client
verifies binary assets before registration; Django does not download binaries.
Registration acknowledges stored metadata, not installation or hardware health.

## Local validation

```sh
python -m unittest discover -s firmware/tests_host -v
cd backend
python manage.py test tests --verbosity 1
```

Tests cover signed-package verification, tampering, wrong tag/commit, lost
acknowledgements, retries, redirect refusal, independent authentication, atomic
rejection, immutable conflicts, idempotency and preservation of staff decisions.
Local checks do not establish a successful GitHub/Railway run or physical OTA.
