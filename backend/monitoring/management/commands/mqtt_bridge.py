import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import paho.mqtt.client as mqtt
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Forward a reachable MQTT broker to the API. Optional compatibility bridge."

    def add_arguments(self, parser):
        parser.add_argument("--broker", default=os.getenv("MQTT_BROKER"))
        parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
        parser.add_argument("--api-url", default=os.getenv("INGEST_API_URL"))
        parser.add_argument("--topic", default=os.getenv("MQTT_TOPIC", "co2monitor/+/data"))
        parser.add_argument("--tls", action="store_true")

    def handle(self, *args, **options):
        if not options["broker"] or not options["api_url"] or not settings.INGEST_API_KEY:
            raise CommandError("Set broker, API URL, and INGEST_API_KEY before running the bridge.")
        url = options["api_url"].rstrip("/") + "/api/ingest"
        parsed = urlparse(url)
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
        ):
            raise CommandError("Use HTTPS, except for a local development API.")

        def on_connect(client, userdata, flags, reason_code, properties):
            if reason_code == 0:
                client.subscribe(options["topic"])
                logger.info("MQTT bridge connected")

        def on_message(client, userdata, message):
            try:
                payload = json.loads(message.payload)
                if not isinstance(payload, dict):
                    return
                # Existing firmware sends uptime rather than an absolute timestamp.
                if isinstance(payload.get("timestamp"), (int, float)):
                    payload.pop("timestamp")
                req = Request(url, data=json.dumps(payload).encode(), method="POST", headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.INGEST_API_KEY}",
                })
                with urlopen(req, timeout=10) as response:
                    response.read()
            except HTTPError as exc:
                logger.warning("MQTT forwarding rejected: HTTP %s", exc.code)
            except (ValueError, URLError):
                logger.warning("MQTT forwarding failed; this bridge has no durable queue")

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_connect, client.on_message = on_connect, on_message
        username = os.getenv("MQTT_USERNAME")
        if username:
            client.username_pw_set(username, os.getenv("MQTT_PASSWORD"))
        if options["tls"]:
            client.tls_set()
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        client.connect_async(options["broker"], options["port"], keepalive=60)
        try:
            client.loop_forever(retry_first_connection=True)
        except KeyboardInterrupt:
            client.disconnect()
