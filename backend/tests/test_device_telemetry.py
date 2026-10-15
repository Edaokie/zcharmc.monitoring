import hashlib
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from monitoring.models import Device, DeviceTestReading, Reading


@override_settings(ALLOW_PUBLIC_READ=True, INGEST_API_KEY='different-ingest-key')
class DeviceTelemetryTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(device_id='bench-inlet', profile='inlet', hardware='wroom32-4mb-v1',
            credential_hash=hashlib.sha256(b'device-token').hexdigest())
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer device-token')
        self.url = '/api/devices/bench-inlet/telemetry'
        self.reading = {'node_id': 'inlet', 'message_id': 'test-inlet-boot:1',
                        'timestamp': timezone.now().isoformat(), 'co2': 0, 'temperature': 29.5}

    def post(self, **changes):
        return self.client.post(self.url, {'source': 'simulated', 'reading': dict(self.reading, **changes)}, format='json')

    def enable(self):
        self.device.allow_test_telemetry = True
        self.device.save()

    def test_disabled_by_default_and_requires_specific_device_token(self):
        self.assertEqual(self.post().status_code, 403)
        self.enable()
        for credential in ['', 'Bearer different-ingest-key', 'Bearer other-device-token']:
            self.client.credentials(HTTP_AUTHORIZATION=credential)
            self.assertEqual(self.post().status_code, 403)
        self.assertFalse(DeviceTestReading.objects.exists())

    def test_persist_then_acknowledge_retry_without_production_pollution(self):
        self.enable()
        response = self.post()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['message_id'], self.reading['message_id'])
        self.assertTrue(response.json()['accepted'])
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(DeviceTestReading.objects.count(), 1)
        self.assertEqual(DeviceTestReading.objects.get().payload['co2'], 0)
        self.assertEqual(Reading.objects.count(), 0)
        self.assertEqual(self.post(co2=500).status_code, 409)
        self.assertEqual(self.post(timestamp='2026-01-01T00:00:00Z').status_code, 409)

    def test_role_timestamp_identity_source_and_unknown_fields(self):
        self.enable()
        self.assertEqual(self.post(node_id='outlet').status_code, 403)
        for field in ['timestamp', 'message_id']:
            reading = dict(self.reading)
            del reading[field]
            self.assertEqual(self.client.post(self.url, {'source': 'simulated', 'reading': reading}, format='json').status_code, 400)
        self.assertEqual(self.post(co2='NaN').status_code, 400)
        self.assertEqual(self.post(unexpected=1).status_code, 400)
        self.assertEqual(self.client.post(self.url, {'source': 'real', 'reading': self.reading}, format='json').status_code, 400)
        self.device.enabled = False
        self.device.save()
        self.assertEqual(self.post().status_code, 403)
