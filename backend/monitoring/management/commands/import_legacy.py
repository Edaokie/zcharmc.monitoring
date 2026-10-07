import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from monitoring.models import MEASUREMENT_FIELDS, NODE_IDS, Reading


class Command(BaseCommand):
    help = "Copy legacy SQLite readings without modifying the source database."

    def add_arguments(self, parser):
        parser.add_argument("source")
        parser.add_argument("--timezone", default="Asia/Manila")

    def handle(self, *args, **options):
        path = Path(options["source"]).resolve()
        if not path.is_file():
            raise CommandError("Source database does not exist.")
        try:
            source_timezone = ZoneInfo(options["timezone"])
        except ZoneInfoNotFoundError as exc:
            raise CommandError("Unknown source timezone.") from exc
        imported = 0
        source = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
        source.row_factory = sqlite3.Row
        try:
            tables = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            selected = [t for t in ("node_inlet", "node_outlet") if t in tables]
            if not selected and "readings" in tables:
                selected = ["readings"]
            if not selected:
                raise CommandError("No supported legacy tables found.")
            with transaction.atomic():
                for table in selected:
                    for row in source.execute(f'SELECT * FROM "{table}" ORDER BY id'):
                        data = dict(row)
                        if data.get("node_id") not in NODE_IDS:
                            continue
                        stamp = parse_datetime(data["timestamp"])
                        if stamp is None:
                            raise CommandError(f"Invalid timestamp in {table}, row {data['id']}.")
                        if timezone.is_naive(stamp):
                            stamp = timezone.make_aware(stamp, source_timezone)
                        defaults = {key: data[key] for key in MEASUREMENT_FIELDS if key in data}
                        defaults["timestamp"] = stamp
                        _, created = Reading.objects.get_or_create(
                            node_id=data["node_id"], message_id=f"legacy:{table}:{data['id']}", defaults=defaults,
                        )
                        imported += int(created)
        finally:
            source.close()
        self.stdout.write(self.style.SUCCESS(f"Imported {imported} readings; source unchanged."))
