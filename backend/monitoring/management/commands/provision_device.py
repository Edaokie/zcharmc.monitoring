"""Create/rotate a device credential into a private provisioning file."""
import hashlib
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from monitoring.models import Device


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("device_id")
        parser.add_argument("--profile", choices=["inlet", "outlet", "control"], required=True)
        parser.add_argument("--hardware", required=True)
        parser.add_argument("--backend", required=True)
        parser.add_argument("--output", type=Path, required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        token = secrets.token_urlsafe(32)
        origin = urlparse(options["backend"])
        if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
                or origin.query or origin.fragment or origin.path not in ("", "/")
                or len(options["backend"].rstrip("/")) > 191):
            raise CommandError("Use an HTTPS backend origin")
        obj, _ = Device.objects.get_or_create(device_id=options["device_id"], defaults={
            "profile": options["profile"], "hardware": options["hardware"]})
        if (obj.profile, obj.hardware) != (options["profile"], options["hardware"]):
            raise CommandError("Existing device role/hardware cannot be changed by credential rotation")
        obj.credential_hash = hashlib.sha256(token.encode()).hexdigest()
        obj.full_clean()
        data = {"device_id": obj.device_id, "profile": obj.profile, "hardware": obj.hardware,
                "device_token": token, "backend": options["backend"].rstrip("/")}
        # Never overwrite an existing provisioning file or print the token.
        fd = os.open(options["output"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(data, output)
            obj.save()
        except Exception:
            options["output"].unlink(missing_ok=True)
            raise
        self.stdout.write("Device credential saved to private provisioning file. Add Wi-Fi settings locally; do not commit it.")
