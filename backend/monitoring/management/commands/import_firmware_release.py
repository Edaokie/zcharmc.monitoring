import base64
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from monitoring.models import FirmwareRelease


class Command(BaseCommand):
    help = 'Verify and register a downloaded signed release package, disabled until reviewed.'

    def add_arguments(self, parser):
        parser.add_argument('directory', type=Path)
        parser.add_argument('--base-url', required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        for profile in ('inlet', 'outlet', 'control'):
            path = options['directory'] / f'{profile}.manifest.json'
            try:
                raw = path.read_text(encoding='ascii')
                data = json.loads(raw)
                release = FirmwareRelease(version=data['version'], profile=profile, hardware=data['hardware'],
                    manifest=raw, signature=base64.b64encode(path.with_suffix('.json.sig').read_bytes()).decode(),
                    base_url=options['base_url'])
                release.full_clean()
                release.save(force_insert=True)
            except Exception as error:
                raise CommandError('Release registration rejected; no releases were imported. Check signatures, metadata and existing versions.') from error
        self.stdout.write('Registered three verified releases, disabled. Review and enable them in Django admin, then approve each device separately.')
