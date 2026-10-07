from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import OperationalError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from monitoring.contract import SENSOR_CONTRACT
from monitoring.models import IngestionStatus, Reading


@override_settings(ALLOW_PUBLIC_READ=True, INGEST_API_KEY="test-key")
class OperationsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def upload(self, payload, key="test-key"):
        return self.client.post("/api/ingest", payload, format="json", HTTP_AUTHORIZATION=f"Bearer {key}")

    def test_empty_null_unknown_and_future_readings_are_rejected(self):
        now = timezone.now()
        for data in ({"node_id": "inlet"}, {"node_id": "inlet", "co2": None},
                     {"node_id": "inlet", "co2": 1, "typo": 4},
                     {"node_id": "inlet", "co2": 1, "timestamp": (now + timedelta(seconds=61)).isoformat()}):
            with self.subTest(data=data), patch("monitoring.serializers.timezone.now", return_value=now):
                self.assertEqual(self.upload(data).status_code, 400)
        self.assertEqual(Reading.objects.count(), 0)
        self.assertEqual(IngestionStatus.objects.get(node_id="inlet").invalid, 4)

    def test_bounds_zero_missing_and_old_backlog(self):
        for field, limits in SENSOR_CONTRACT.items():
            for value in (limits["min"], limits["max"]):
                self.assertEqual(self.upload({"node_id": "inlet", field: value}).status_code, 201)
            for value in (limits["min"] - 1, limits["max"] + 1):
                self.assertEqual(self.upload({"node_id": "inlet", field: value}).status_code, 400)
        data = {"node_id": "outlet", "co2": None, "pressure1": 0,
                "timestamp": (timezone.now() - timedelta(days=30)).isoformat()}
        self.assertEqual(self.upload(data).status_code, 201)
        self.assertIsNone(Reading.objects.filter(node_id="outlet").get().co2)

    def test_counters_retry_conflict_and_staff_only_diagnostics(self):
        data = {"node_id": "inlet", "message_id": "test:1", "co2": 450}
        self.assertEqual(self.upload(data).status_code, 201)
        accepted_at = IngestionStatus.objects.get(node_id="inlet").last_accepted_at
        self.assertEqual(self.upload(data).status_code, 200)
        self.assertEqual(self.upload({**data, "co2": 900}).status_code, 409)
        self.assertEqual(self.upload(data, key="wrong").status_code, 403)
        row = IngestionStatus.objects.get(node_id="inlet")
        self.assertEqual((row.accepted, row.duplicates, row.conflicts), (1, 1, 1))
        self.assertEqual(row.last_accepted_at, accepted_at)
        self.assertEqual(IngestionStatus.objects.get(node_id="unknown").unauthorized, 1)
        self.assertIn(self.client.get("/api/operations").status_code, (401, 403))
        ordinary = get_user_model().objects.create_user(username="ordinary")
        self.client.force_authenticate(ordinary)
        self.assertEqual(self.client.get("/api/operations").status_code, 403)
        staff = get_user_model().objects.create_user(username="operator", is_staff=True)
        self.client.force_authenticate(staff)
        body = self.client.get("/api/operations").json()
        self.assertEqual(body["database"], "ok")
        self.assertEqual(next(n for n in body["nodes"] if n["node_id"] == "inlet")["upload_status"], "recent")
        with patch("monitoring.views.connection.cursor", side_effect=OperationalError):
            self.assertEqual(self.client.get("/api/operations").status_code, 503)

    def test_parse_failures_and_database_outage_are_logged_without_secrets(self):
        with self.assertLogs("monitoring.operations", level="WARNING") as logs:
            self.assertEqual(self.client.post("/api/ingest", "{bad", content_type="application/json",
                                             HTTP_AUTHORIZATION="Bearer test-key").status_code, 400)
        self.assertNotIn("test-key", "".join(logs.output))
        self.assertEqual(IngestionStatus.objects.get(node_id="unknown").invalid, 1)
        with patch("monitoring.operations.record_outcome", side_effect=OperationalError), self.assertLogs("monitoring.operations"):
            self.assertEqual(self.upload({"node_id": "inlet"}).status_code, 400)


    def test_future_skew_boundary_and_database_failure_rolls_back_reading(self):
        now = timezone.now()
        with patch("monitoring.serializers.timezone.now", return_value=now):
            for seconds, status in ((59, 201), (60, 201), (61, 400)):
                self.assertEqual(self.upload({"node_id": "inlet", "co2": 0,
                    "timestamp": (now + timedelta(seconds=seconds)).isoformat()}).status_code, status)
        count = Reading.objects.count()
        self.client.raise_request_exception = False
        with patch("monitoring.services.record_outcome", side_effect=OperationalError("simulated database write failure")), self.assertLogs():
            self.assertEqual(self.upload({"node_id": "outlet", "co2": 450}).status_code, 500)
        self.assertEqual(Reading.objects.count(), count)
        self.assertEqual(IngestionStatus.objects.get(node_id="outlet").server_errors, 1)
        self.assertEqual(IngestionStatus.objects.get(node_id="outlet").accepted, 0)
