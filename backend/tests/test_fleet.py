"""Browser authentication and OTA authorization regression tests."""
import hashlib
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from monitoring.models import Device, DeviceReport, FirmwareApproval
from monitoring.realtime import connect
from . import test_ota


@override_settings(ALLOW_PUBLIC_READ=False, SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False)
class FleetTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.public = cls.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    release = test_ota.OtaTests.release

    def setUp(self):
        cache.clear()
        setting = override_settings(OTA_SIGNING_PUBLIC_KEY=self.public)
        setting.enable()
        self.addCleanup(setting.disable)
        self.admin = get_user_model().objects.create_superuser('operator', password='test-only-password')
        self.client = APIClient(enforce_csrf_checks=True)
        self.device = Device.objects.create(device_id='inlet-01', profile='inlet', hardware='wroom32-4mb-v1',
            credential_hash=hashlib.sha256(b'test-device-token').hexdigest())
        self.url = '/api/firmware/devices/inlet-01/target'

    def sign_in(self, username='operator'):
        csrf = self.client.get('/api/auth/session').json()['csrf_token']
        response = self.client.post('/api/auth/login', {'username': username, 'password': 'test-only-password'},
                                    format='json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)
        self.csrf = response.json()['csrf_token']
        return response

    def post(self, url, data):
        return self.client.post(url, data, format='json', HTTP_X_CSRFTOKEN=self.csrf)

    def test_login_requires_csrf_and_real_credentials(self):
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])
        response = self.client.post('/api/auth/login', {'username': 'operator', 'password': 'test-only-password'}, format='json')
        self.assertEqual(response.status_code, 403)
        csrf = self.client.get('/api/auth/session').json()['csrf_token']
        self.assertEqual(self.client.post('/api/auth/login', {'username': 'operator', 'password': 'wrong'}, format='json', HTTP_X_CSRFTOKEN=csrf).status_code, 400)
        self.assertEqual(self.client.post('/api/auth/login', {'username': 'operator', 'password': 'test-only-password'}, format='json', HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN='https://untrusted.example').status_code, 403)
        response = self.sign_in()
        self.assertTrue(response.json()['user']['can_manage_firmware'])
        self.assertTrue(response.cookies['sessionid']['httponly'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(self.client.session.get_expiry_age(), 28800)

    def test_public_device_and_ordinary_staff_cannot_manage(self):
        with override_settings(ALLOW_PUBLIC_READ=True):
            self.assertEqual(self.client.get('/api/firmware/devices').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer test-device-token')
        self.assertEqual(self.client.get('/api/firmware/devices').status_code, 401)
        self.client.credentials()
        for username, staff in [('viewer', False), ('unprivileged-staff', True)]:
            get_user_model().objects.create_user(username, password='test-only-password', is_staff=staff)
            self.sign_in(username)
            self.assertEqual(self.client.get('/api/firmware/devices').status_code, 403)
            self.assertEqual(self.post(self.url, {'expected_generation': 0, 'release_id': None}).status_code, 403)

        from django.contrib.auth.models import Permission
        from monitoring.browser_auth import FIRMWARE_PERMISSIONS
        operator = get_user_model().objects.get(username='unprivileged-staff')
        for name in FIRMWARE_PERMISSIONS:
            app, codename = name.split('.')
            operator.user_permissions.add(Permission.objects.get(content_type__app_label=app, codename=codename))
        self.assertEqual(self.client.get('/api/firmware/devices').status_code, 200)
        operator.is_active = False
        operator.save()
        self.assertEqual(self.client.get('/api/firmware/devices').status_code, 401)

    @patch('monitoring.realtime.close_old_connections')
    def test_csrf_mutations_logout_and_ticket_replay(self, close_connections):
        # Direct calls share TestCase's transaction, unlike real socket workers.
        # Production cleanup would close that PostgreSQL connection because its
        # autocommit state differs inside atomic().
        self.sign_in()
        self.assertEqual(self.client.post(self.url, {'expected_generation': 0, 'release_id': None}, format='json').status_code, 403)
        ticket = self.post('/api/auth/socket-ticket', {}).json()['ticket']
        with patch('monitoring.realtime.sio.emit'):
            self.assertIsNone(connect('test', {}, {'ticket': ticket}))
            self.assertFalse(connect('test', {}, {'ticket': ticket}))
        ticket = self.post('/api/auth/socket-ticket', {}).json()['ticket']
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 403)
        self.assertEqual(self.post('/api/auth/logout', {}).status_code, 200)
        with patch('monitoring.realtime.sio.emit'):
            self.assertFalse(connect('test', {}, {'ticket': ticket}))
        self.assertEqual(close_connections.call_count, 6)
        self.assertEqual(self.client.get('/api/firmware/devices').status_code, 401)

    def test_approval_retry_withdraw_audit_and_stale_generation(self):
        self.sign_in()
        release = self.release()
        data = {'expected_generation': 0, 'release_id': release.pk}
        response = self.post(self.url, data)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()['approval_generation'], 1)
        self.assertEqual(self.post(self.url, data).status_code, 409)
        self.assertEqual(self.post(self.url, dict(data, expected_generation=1)).json()['approval_generation'], 1)
        response = self.post('/api/firmware/devices/inlet-01/retry', {'expected_generation': 1})
        self.assertEqual(response.json()['approval_generation'], 2)
        response = self.post(self.url, {'expected_generation': 2, 'release_id': None})
        self.assertEqual(response.json()['approval_generation'], 3)
        self.assertIsNone(response.json()['desired_release'])
        self.assertEqual(FirmwareApproval.objects.count(), 3)
        self.assertTrue(all(item.approved_by == self.admin for item in FirmwareApproval.objects.all()))
        history = self.client.get('/api/firmware/devices/inlet-01/history')
        self.assertEqual(len(history.json()['events']), 3)
        self.assertNotIn('credential', history.content.decode())
        self.assertNotIn('credential', self.client.get('/api/firmware/devices').content.decode())

    def test_incompatible_disabled_tampered_and_same_version_fail(self):
        self.sign_in()
        wrong = self.release('outlet')
        self.assertEqual(self.post(self.url, {'expected_generation': 0, 'release_id': wrong.pk}).status_code, 400)
        release = self.release()
        release.enabled = False
        release.save()
        data = {'expected_generation': 0, 'release_id': release.pk}
        self.assertEqual(self.post(self.url, data).status_code, 400)
        release.enabled = True
        release.signature = 'invalid'
        release.save()
        self.assertEqual(self.post(self.url, data).status_code, 400)
        response = self.client.patch(f'/api/firmware/releases/{release.pk}', {'enabled': True}, format='json', HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 400)
        release.delete()
        release = self.release()
        self.device.reported_version = release.version
        self.device.save()
        self.assertEqual(self.post(self.url, dict(data, release_id=release.pk)).status_code, 400)
        self.assertEqual(FirmwareApproval.objects.count(), 0)

    def test_control_needs_confirmation_and_recent_maintenance(self):
        self.sign_in()
        self.device.profile = 'control'
        self.device.save()
        release = self.release('control')
        data = {'expected_generation': 0, 'release_id': release.pk, 'maintenance_confirmed': True}
        self.assertEqual(self.post(self.url, data).status_code, 400)
        self.device.maintenance = True
        self.device.last_seen = timezone.now() - timedelta(minutes=4)
        self.device.save()
        self.assertEqual(self.post(self.url, data).status_code, 400)
        self.device.last_seen = timezone.now()
        self.device.save()
        self.assertEqual(self.post(self.url, dict(data, maintenance_confirmed=False)).status_code, 400)
        self.assertEqual(self.post(self.url, data).status_code, 200)

    def test_release_enablement_and_report_history(self):
        self.sign_in()
        release = self.release()
        url = f'/api/firmware/releases/{release.pk}'
        response = self.client.patch(url, {'enabled': False}, format='json', HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 200, response.data)
        from django.contrib.admin.models import LogEntry
        self.assertEqual(LogEntry.objects.filter(user=self.admin).count(), 1)
        device_client = APIClient()
        device_client.credentials(HTTP_AUTHORIZATION='Bearer test-device-token')
        report = {'version': '1.0.0', 'status': 'healthy', 'maintenance': False}
        for _ in range(2):
            self.assertEqual(device_client.post('/api/devices/inlet-01/report', report, format='json').status_code, 200)
        self.assertEqual(DeviceReport.objects.count(), 1)
        release.enabled = True
        release.save()
        self.assertEqual(self.post(self.url, {'expected_generation': 0, 'release_id': release.pk}).status_code, 200)
        self.device.refresh_from_db()
        self.assertEqual(self.device.reported_version, '1.0.0')
        self.assertIsNotNone(self.device.last_seen)
        history = self.client.get('/api/firmware/devices/inlet-01/history').json()['events']
        self.assertEqual({item['kind'] for item in history}, {'approval', 'report'})

    def test_bounded_pagination_and_strict_operations(self):
        self.sign_in()
        Device.objects.bulk_create([Device(device_id=f'inlet-{i:03d}', profile='inlet', hardware='wroom32-4mb-v1', credential_hash='a'*64) for i in range(60)])
        response = self.client.get('/api/firmware/devices').json()
        self.assertEqual(len(response['results']), 50)
        self.assertEqual(response['next_page'], 2)
        self.assertEqual(self.client.get('/api/firmware/devices?page=bad').status_code, 400)
        response = self.post(self.url, {'expected_generation': 0, 'release_id': None, 'reported_version': 'fake'})
        self.assertEqual(response.status_code, 400)
