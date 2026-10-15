"""Verify a downloaded release and register it with Django, without assigning devices."""
import argparse
import base64
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from release_package import PROFILES, VERSION, verify_package


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def payload_for(directory, trusted_key, repository, tag, commit=None):
    if not tag.startswith("firmware-v") or not VERSION.fullmatch(tag.removeprefix("firmware-v")):
        raise ValueError("Expected a firmware-v semantic version tag")
    version = tag.removeprefix("firmware-v")
    entries = []
    identities = set()
    for profile in PROFILES:
        path = directory / f"{profile}.manifest.json"
        # Hardware comes from signed metadata; verify_package checks role and signature.
        metadata = json.loads(path.read_bytes())
        verified = verify_package(path, trusted_key, profile, metadata["hardware"])
        if verified["version"] != version or (commit and verified["commit"] != commit):
            raise ValueError("Release version/source commit does not match the requested tag")
        identities.add((verified["hardware"], verified["commit"]))
        entries.append({"manifest": path.read_text(encoding="ascii"),
                        "signature": base64.b64encode(path.with_suffix(".json.sig").read_bytes()).decode()})
    if len(identities) != 1:
        raise ValueError("Role images must share hardware and source commit")
    return {"base_url": f"https://github.com/{repository}/releases/download/{tag}", "releases": entries}


def register(backend, key, payload):
    parsed = urlparse(backend)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise ValueError("OTA_BACKEND_URL must be an HTTPS origin")
    if not key or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ValueError("Set OTA_RELEASE_REGISTRATION_KEY to a nonempty printable ASCII token without whitespace")
    opener = build_opener(NoRedirect())
    for attempt in range(3):
        request = Request(backend.rstrip("/") + "/api/firmware/releases/register",
                          data=json.dumps(payload).encode(), method="POST",
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with opener.open(request, timeout=30) as response:
                result = json.load(response)
            if (not isinstance(result, dict) or result.get("registered") != 3
                    or result.get("device_assignments_changed") is not False):
                raise ValueError("Unexpected registration acknowledgement")
            return result
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise ValueError(f"Registration failed: HTTP {error.code}. Published assets are retained; retry registration after correcting the backend.") from None
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise ValueError("Registration connection failed. Published assets are retained; retry registration.") from None
        time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--trusted-key", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", help="Full commit resolved from the release tag")
    args = parser.parse_args()
    try:
        payload = payload_for(args.directory, args.trusted_key, args.repository, args.tag, args.commit)
        result = register(os.getenv("OTA_BACKEND_URL", ""), os.getenv("OTA_RELEASE_REGISTRATION_KEY", ""), payload)
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Registration rejected: {error}\n")
    print(f"Registered three verified role releases ({result['created']} new). Device assignments unchanged.")


if __name__ == "__main__":
    main()
