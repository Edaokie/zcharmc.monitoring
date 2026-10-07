"""Run inside the deployed backend: python tools/verify_cloud_flow.py.

Writes six synthetic readings through the live ingestion API, leaves them in
PostgreSQL for dashboard inspection, and never prints the ingestion secret.
No firmware, login, valve, or vacuum state is changed.
"""
import argparse
import csv
import io
import json
import os
import sys
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings
from django.db import connection
from django.utils import timezone
from monitoring.models import Reading


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", default="https://zcharmcmonitoring-production.up.railway.app")
    parser.add_argument("--frontend", default="https://zcharmc-monitoring.vercel.app")
    args = parser.parse_args()
    base = args.backend.rstrip("/")
    origin = args.frontend.rstrip("/")
    run_id = "SYNTHETIC-CLOUD-TEST-" + uuid.uuid4().hex[:12]
    inserted = []

    def request(path, data=None, secret=False, raw=False, text=False):
        headers = {"Origin": origin}
        if data is not None:
            headers["Content-Type"] = "text/plain" if text else "application/json"
        if secret:
            headers["Authorization"] = "Bearer " + settings.INGEST_API_KEY
        body = data.encode() if text else json.dumps(data).encode() if data is not None else None
        try:
            with urlopen(Request(base + path, data=body, headers=headers), timeout=15) as response:
                value = response.read().decode()
                return response.status, response.headers, value if raw else json.loads(value)
        except HTTPError as error:
            raise RuntimeError(f"{path.split('?')[0]} returned HTTP {error.code}") from None

    def socket_open():
        path = "/socket.io/?EIO=4&transport=polling"
        _, headers, body = request(path, raw=True)
        require(headers.get("Access-Control-Allow-Origin") == origin, "Socket.IO CORS origin mismatch")
        require(body.startswith("0"), "Engine.IO handshake missing")
        path += "&sid=" + json.loads(body[1:])["sid"]
        request(path, "40", raw=True, text=True)
        _, _, packets = request(path, raw=True)
        require(any(p.startswith("40") for p in packets.split("\x1e")), "Socket.IO connection rejected")
        return path, packets

    def updates(packets):
        return [json.loads(p[2:])[1] for p in packets.split("\x1e")
                if p.startswith("42") and json.loads(p[2:])[0] == "co2_update"]

    def socket_close(path):
        request(path, "41\x1e1", raw=True, text=True)

    try:
        require(connection.vendor == "postgresql", "The configured database must be PostgreSQL")
        require(bool(settings.INGEST_API_KEY), "Set INGEST_API_KEY in the backend service first")
        require(settings.ALLOW_PUBLIC_READ, "Enable the approved ALLOW_PUBLIC_READ=true setting first")
        _, _, health = request("/api/health")
        require(health.get("database") == "ok", "Database health check failed")
        _, headers, _ = request("/api/latest")
        require(headers.get("Access-Control-Allow-Origin") == origin, "REST CORS origin mismatch")
        path, _ = socket_open()
        now = timezone.now()
        payloads = []
        for step in range(3):
            for node, co2 in (("inlet", 1200 + step * 17), ("outlet", 540 + step * 13)):
                payload = {
                    "node_id": node, "message_id": f"{run_id}:{node}:{step}",
                    "timestamp": (now - timedelta(seconds=(2 - step) * 5)).isoformat(),
                    "co2": co2, "temperature": 26.5, "humidity": 55.5,
                    "ph": 7.1, "pm25": 8.5, "flow_rate": 2.5, "level": 42,
                    "weight": 100, "no2": 0.02, "so2": 0.01,
                    "pressure1": 12.3, "pressure2": 11.7,
                }
                status, _, result = request("/api/ingest", payload, secret=True)
                require(status == 201 and result.get("created"), "Ingestion did not create a reading")
                inserted.append(result["data"]["id"])
                payloads.append(payload)
        _, _, packets = request(path, raw=True)
        require(set(inserted) <= {r["id"] for r in updates(packets)}, "Live broadcast did not deliver every test reading")
        socket_close(path)
        status, _, duplicate = request("/api/ingest", payloads[-1], secret=True)
        require(status == 200 and duplicate.get("created") is False, "Retry was not deduplicated")
        stored = list(Reading.objects.filter(message_id__startswith=run_id).values("id", "message_id", "co2"))
        require({r["id"] for r in stored} == set(inserted), "PostgreSQL rows do not match ingestion acknowledgements")
        for node in ("inlet", "outlet"):
            _, _, history = request("/api/history/" + node)
            wanted = {r["id"] for r in stored if f":{node}:" in r["message_id"]}
            require(wanted <= {r["id"] for r in history}, f"History missing test rows for {node}")
        query = urlencode({"start": (now - timedelta(seconds=15)).isoformat(), "end": (now + timedelta(seconds=1)).isoformat()})
        _, _, csv_text = request("/api/export/csv?" + query, raw=True)
        csv_rows = list(csv.DictReader(io.StringIO(csv_text)))
        require(set(inserted) <= {int(r["id"]) for r in csv_rows}, "CSV missing test rows")
        path, packets = socket_open()
        restored = updates(packets)
        for _ in range(3):
            if len(restored) >= 2:
                break
            _, _, packets = request(path, raw=True)
            restored.extend(updates(packets))
        latest_ids = {inserted[-2], inserted[-1]}
        require(latest_ids <= {r["id"] for r in restored}, "Reconnect did not restore both latest test readings")
        socket_close(path)
        _, _, latest = request("/api/latest")
        require(latest_ids <= {r["id"] for r in latest}, "Latest API missing test readings")
        print(json.dumps({
            "status": "PASS", "run_id": run_id, "reading_ids": inserted,
            "checks": ["public REST and Socket.IO CORS", "HTTP ingestion", "live polling events",
                       "retry deduplication", "PostgreSQL rows", "history", "CSV", "reconnect latest state"],
            "expected_dashboard": {"inlet_co2": 1234, "outlet_co2": 566},
            "browser_checks_still_required": ["live dashboard", "history view", "CSV download", "page refresh"],
            "note": "Six SYNTHETIC readings remain stored. They are not sensor measurements.",
        }, indent=2))
    except Exception as error:
        print(json.dumps({"status": "FAIL", "run_id": run_id, "inserted_ids": inserted, "error": str(error)}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
