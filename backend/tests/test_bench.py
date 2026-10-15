import hashlib
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from monitoring.models import Device, DeviceTestReading, Reading


class BenchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = get_user_model().objects.create_user('bench-staff', is_staff=True, is_superuser=True)
        self.device = Device.objects.create(device_id='bench-control', profile='control',
            hardware='wroom32-4mb-v1', allow_test_telemetry=True,
            credential_hash=hashlib.sha256(b'control-token').hexdigest())
        self.reading = dict(node_id='control', message_id='control-boot-1',
            timestamp=timezone.now().isoformat(),
            valves=dict.fromkeys(('sv1', 'sv2', 'sv3', 'sv4'), False),
            weights=dict(weight1=1000, weight2=2000))

    def ingest(self, **changes):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer control-token')
        return self.client.post('/api/devices/bench-control/telemetry',
            dict(source='simulated', reading=dict(self.reading, **changes)), format='json')

    def test_control_persists_idempotently_without_research_data(self):
        self.assertEqual(self.ingest().status_code, 201)
        self.assertEqual(self.ingest().status_code, 200)
        self.assertEqual(DeviceTestReading.objects.count(), 1)
        self.assertFalse(Reading.objects.exists())
        self.assertEqual(self.ingest(weights=dict(weight1=0, weight2=1)).status_code, 409)
        self.device.allow_test_telemetry = False
        self.device.save()
        self.assertEqual(self.ingest().status_code, 403)

    def test_control_requires_complete_finite_correct_role_snapshot(self):
        for changes in [dict(node_id='inlet'), dict(co2=4000), dict(valves={'sv1': False}),
                        dict(weights={'weight1': 'NaN', 'weight2': 0}),
                        dict(weights={'weight1': -1, 'weight2': 0}),
                        dict(timestamp=(timezone.now()+timedelta(days=1)).isoformat())]:
            with self.subTest(changes=changes):
                self.assertEqual(self.ingest(**changes).status_code, 400)
        self.assertFalse(DeviceTestReading.objects.exists())

    def test_bench_and_history_require_firmware_staff(self):
        urls = ['/api/firmware/bench', '/api/firmware/devices/bench-control/test-readings']
        for user in [None, get_user_model().objects.create_user('ordinary'),
                     get_user_model().objects.create_user('staff-without-permissions', is_staff=True)]:
            self.client.force_authenticate(user)
            for url in urls:
                self.assertIn(self.client.get(url).status_code, (401, 403))
        self.client.force_authenticate(self.staff)
        for url in urls:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_latest_received_history_pagination_and_no_credential_leak(self):
        self.assertEqual(self.ingest().status_code, 201)
        # An older measurement received later must be shown with both timestamps.
        older = dict(self.reading, message_id='older', timestamp='2026-01-01T00:00:00Z')
        DeviceTestReading.objects.create(device=self.device, message_id='older', payload=older)
        Device.objects.create(device_id='empty-outlet', profile='outlet', hardware='wroom32-4mb-v1', credential_hash='hidden')
        self.client.credentials()
        self.client.force_authenticate(self.staff)
        response = self.client.get('/api/firmware/bench')
        self.assertEqual(response.status_code, 200)
        rows = response.json()['results']
        self.assertEqual(rows[0]['latest']['payload']['message_id'], 'older')
        self.assertIsNone(rows[1]['latest'])
        self.assertNotIn('credential', str(rows))
        url = '/api/firmware/devices/bench-control/test-readings'
        self.assertEqual(self.client.get(url).json()['results'][0]['message_id'], 'older')
        self.assertEqual(self.client.get(url+'?page=2').json()['results'], [])
        self.assertEqual(self.client.get(url+'?page=0').status_code, 400)
        self.assertEqual(self.client.get('/api/firmware/devices/absent/test-readings').status_code, 404)
