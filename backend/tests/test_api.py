import csv
import io
import sqlite3
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import OperationalError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from monitoring.models import Reading, ValveSnapshot
from monitoring.realtime import connect, unsupported_actuation


@override_settings(ALLOW_PUBLIC_READ=True, INGEST_API_KEY="test-ingestion-key")
class MonitoringTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def ingest(self, data, key="test-ingestion-key"):
        return self.client.post("/api/ingest", data, format="json", HTTP_AUTHORIZATION=f"Bearer {key}")

    def test_health_and_empty_endpoints(self):
        for url in ("/", "/api/health", "/api/nodes", "/api/latest", "/api/history",
                    "/api/history/inlet", "/api/history/solenoid_valves", "/api/readings", "/api/stats", "/api/alerts"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_ingest_requires_key_even_with_public_reads(self):
        self.assertEqual(self.ingest({"node_id": "inlet"}, "wrong").status_code, 403)
        self.assertEqual(Reading.objects.count(), 0)

    @override_settings(INGEST_API_KEY="")
    def test_ingestion_disabled_without_key(self):
        self.assertEqual(self.ingest({"node_id": "inlet"}, "").status_code, 403)

    def test_deduplication_and_broadcast_after_commit(self):
        payload = {"node_id": "inlet", "message_id": "boot-1:42", "co2": 4500, "pressure1": 120}
        with patch("monitoring.services.broadcast") as broadcast:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.ingest(payload)
                broadcast.assert_not_called()
            self.assertEqual(response.status_code, 201)
            broadcast.assert_called_once()
            self.assertEqual(broadcast.call_args.args[0], "co2_update")
            self.assertEqual(self.ingest(payload).status_code, 200)
        self.assertEqual(Reading.objects.count(), 1)
        self.assertEqual(self.client.get("/api/latest").json()[0]["pressure1"], 120)

    def test_invalid_payloads_do_not_write(self):
        for payload in ([1], {"node_id": "unknown"}, {"node_id": "inlet", "co2": "NaN"},
                        {"node_id": "inlet", "co2": "Infinity"}, {"node_id": "inlet", "co2": True},
                        {"node_id": "inlet", "timestamp": 12345}):
            with self.subTest(payload=payload):
                self.assertEqual(self.ingest(payload).status_code, 400)
        self.assertFalse(Reading.objects.exists())

    def test_missing_values_stay_null(self):
        self.assertEqual(self.ingest({"node_id": "inlet", "co2": 400}).status_code, 201)
        self.assertIsNone(Reading.objects.get().ph)
        self.assertEqual(self.client.get("/api/alerts").json(), [])

    def test_valve_state_persisted_and_broadcast(self):
        payload = {"node_id": "solenoid_valves", "valves": [{"id": "sv1", "label": "Inlet", "open": True}]}
        with patch("monitoring.services.broadcast") as broadcast:
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.ingest(payload).status_code, 201)
            self.assertEqual(broadcast.call_args.args[0], "valve_update")
        self.assertTrue(ValveSnapshot.objects.get().valves[0]["open"])
        self.assertFalse(Reading.objects.exists())
        payload["valves"] *= 2
        self.assertEqual(self.ingest(payload).status_code, 400)

    def test_history_uses_measurement_time(self):
        newest = Reading.objects.create(node_id="inlet", co2=1000, timestamp=timezone.now())
        Reading.objects.create(node_id="outlet", co2=500, timestamp=timezone.now() - timedelta(days=2))
        self.assertEqual(self.client.get("/api/history").json()[0]["id"], newest.id)
        self.assertEqual(len(self.client.get("/api/history/inlet").json()), 1)
        self.assertEqual(self.client.get("/api/history/missing").status_code, 404)

    def test_filters_pagination_stats_and_csv(self):
        Reading.objects.create(node_id="inlet", co2=1000, pressure1=120, ph=7)
        Reading.objects.create(node_id="outlet", co2=500, timestamp=timezone.now() - timedelta(days=2))
        response = self.client.get("/api/readings?per_page=1").json()
        self.assertEqual(response["pagination"], {"page": 1, "per_page": 1, "total": 2, "total_pages": 2})
        self.assertEqual(len(self.client.get("/api/readings?range=24h").json()["data"]), 1)
        stats = self.client.get("/api/stats?node_id=inlet").json()
        self.assertEqual(stats["avg_co2"], 1000)
        self.assertEqual(stats["avg_pressure1"], 120)
        response = self.client.get("/api/export/csv?node_id=inlet")
        rows = list(csv.DictReader(io.StringIO(b"".join(response.streaming_content).decode())))
        self.assertEqual(len(rows), 1)
        self.assertEqual(float(rows[0]["pressure1"]), 120)

    def test_custom_dates_and_invalid_queries(self):
        Reading.objects.create(node_id="inlet", timestamp="2026-01-01T12:00:00Z")
        response = self.client.get("/api/readings?start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z")
        self.assertEqual(response.json()["pagination"]["total"], 1)
        for query in ("page=no", "page=0", "per_page=501", "range=wrong", "start=bad",
                      "start=2026-01-02&end=2026-01-01", "co2_warn=NaN", "co2_warn=6000&co2_danger=5000"):
            path = "/api/alerts" if "co2_" in query else "/api/readings"
            with self.subTest(query=query):
                self.assertEqual(self.client.get(f"{path}?{query}").status_code, 400)

    def test_alerts_respect_node_and_zero_ph(self):
        Reading.objects.create(node_id="inlet", co2=6000)
        Reading.objects.create(node_id="outlet", co2=400, ph=0)
        alerts = self.client.get("/api/alerts?node_id=outlet").json()
        self.assertEqual(len(alerts), 1)
        self.assertIn("pH 0", alerts[0]["threshold"])
        self.assertEqual(self.client.get("/api/alerts?node_id=inlet").json()[0]["alert_type"], "danger")

    @override_settings(ALLOW_PUBLIC_READ=False)
    def test_private_reads_require_real_authentication(self):
        self.assertEqual(self.client.get("/api/latest").status_code, 401)
        user = get_user_model().objects.create_user(username="operator", password="a-real-test-password")
        response = self.client.post("/api/auth/token", {"username": user.username, "password": "a-real-test-password"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")
        self.assertEqual(self.client.get("/api/latest").status_code, 200)

    def test_cors_only_allows_explicit_origins(self):
        with override_settings(CORS_ALLOWED_ORIGINS=["https://dashboard.example"]):
            allowed = self.client.get("/api/latest", HTTP_ORIGIN="https://dashboard.example")
            denied = self.client.get("/api/latest", HTTP_ORIGIN="https://other.example")
        self.assertEqual(allowed["Access-Control-Allow-Origin"], "https://dashboard.example")
        self.assertNotIn("Access-Control-Allow-Origin", denied)

    def test_readiness_fails_when_database_unavailable(self):
        with patch("monitoring.views.connection.cursor", side_effect=OperationalError):
            self.assertEqual(self.client.get("/api/health").status_code, 503)

    @override_settings(SECURE_SSL_REDIRECT=True)
    def test_https_redirect_keeps_readiness_probe_available(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.get("/api/latest").status_code, 301)
        self.assertEqual(self.client.get("/api/latest", HTTP_X_FORWARDED_PROTO="https").status_code, 200)

    @override_settings(ALLOW_PUBLIC_READ=False)
    @patch("monitoring.realtime.close_old_connections")
    def test_socket_authentication(self, close_connections):
        # Direct calls run inside TestCase's transaction, unlike real socket threads.
        self.assertFalse(connect("test", {}, None))
        self.assertFalse(connect("test", {}, {"token": "bad"}))
        user = get_user_model().objects.create_user(username="socket-user")
        token = Token.objects.create(user=user)
        with patch("monitoring.realtime.sio.emit"):
            self.assertIsNone(connect("test", {}, {"token": token.key}))

    @patch("monitoring.realtime.close_old_connections")
    def test_socket_restores_state_and_rejects_actuation(self, close_connections):
        Reading.objects.create(node_id="inlet", co2=500)
        ValveSnapshot.objects.create(valves=[])
        with patch("monitoring.realtime.sio.emit") as emit:
            connect("test", {}, None)
            self.assertEqual(emit.call_count, 2)
            self.assertFalse(unsupported_actuation("test", {})["ok"])

    def test_legacy_import_is_repeatable_and_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            source = sqlite3.connect(path)
            source.execute("CREATE TABLE node_inlet (id INTEGER, node_id TEXT, co2 REAL, timestamp TEXT)")
            source.execute("INSERT INTO node_inlet VALUES (1, 'inlet', 1000, '2026-01-01T12:00:00')")
            source.commit()
            source.close()
            original = path.read_bytes()
            for _ in range(2):
                call_command("import_legacy", str(path), stdout=io.StringIO())
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(Reading.objects.count(), 1)
            self.assertEqual(Reading.objects.get().timestamp.hour, 4)
