import base64
import hashlib
import json
import tempfile
from io import StringIO
from pathlib import Path
from django.core.management import call_command
from django.core.management.base import CommandError
from types import SimpleNamespace

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from monitoring.admin import DeviceAdmin
from monitoring.models import Device, FirmwareApproval, FirmwareRelease
from monitoring.ota import validate_release


@override_settings(ALLOW_PUBLIC_READ=True)
class OtaTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.public = cls.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        self.settings_key = override_settings(OTA_SIGNING_PUBLIC_KEY=self.public)
        self.settings_key.enable()
        self.addCleanup(self.settings_key.disable)
        self.device = Device.objects.create(device_id='inlet-01', profile='inlet', hardware='wroom32-4mb-v1',
            credential_hash=hashlib.sha256(b'private-device-token').hexdigest())
        self.client = APIClient()
        self.url = '/api/devices/inlet-01/ota'
        self.client.credentials(HTTP_AUTHORIZATION='Bearer private-device-token')

    def release(self, profile='inlet', **changes):
        metadata = dict(schema=1, version='1.2.3', profile=profile, hardware='wroom32-4mb-v1',
            commit='a'*40, image=profile+'.bin', size=100, sha256='b'*64)
        metadata.update(changes)
        raw = json.dumps(metadata, sort_keys=True, separators=(',', ':'))
        signature = self.key.sign(raw.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
        release = FirmwareRelease(version=metadata['version'], profile=profile, hardware=metadata['hardware'],
            manifest=raw, signature=base64.b64encode(signature).decode(),
            base_url='https://github.com/example/repo/releases/download/firmware-v1.2.3', enabled=True)
        release.save()
        return release

    def assign(self, release):
        self.device.desired_release = release
        self.device.approval_generation = 1
        self.device.save()

    def test_device_token_required_even_with_public_reads(self):
        self.client.credentials()
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer wrong-token')
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer private-device-token')
        self.assertEqual(self.client.get('/api/devices/outlet-01/ota').status_code, 403)

    def test_target_disabled_and_revoked(self):
        self.assertEqual(self.client.get(self.url).status_code, 204)
        release = self.release()
        release.full_clean()
        self.assign(release)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(response.json()['manifest'], release.manifest)
        release.enabled = False
        release.save()
        self.assertEqual(self.client.get(self.url).status_code, 204)
        self.device.enabled = False
        self.device.save()
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_tamper_wrong_role_and_hardware_fail_closed(self):
        release = self.release('outlet')
        self.assign(release)  # Bypass form validation deliberately.
        with self.assertRaises(ValidationError): self.device.full_clean()
        self.assertEqual(self.client.get(self.url).status_code, 503)
        release.profile = 'inlet'
        release.save()
        self.assertEqual(self.client.get(self.url).status_code, 503)
        release = self.release(hardware='other-board')
        self.assign(release)
        self.assertEqual(self.client.get(self.url).status_code, 503)

    def test_invalid_metadata_trust_anchor_and_asset_origin(self):
        release = self.release(schema=True, version="1.2.4")
        with self.assertRaises(ValidationError): validate_release(release)
        release = self.release()
        with override_settings(OTA_SIGNING_PUBLIC_KEY='untrusted'):
            with self.assertRaises(ValidationError): validate_release(release)
        for url in ['http://github.com/a', 'https://attacker.invalid/a', 'https://github.com:444/a', 'https://github.com/a?token=secret']:
            release.base_url = url
            with self.assertRaises(ValidationError): validate_release(release)

    def test_status_isolated_and_token_rotation(self):
        report = '/api/devices/inlet-01/report'
        response = self.client.post(report, {'version':'1.2.3', 'status':'healthy', 'maintenance':True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.device.refresh_from_db()
        self.assertEqual(self.device.reported_version, '1.2.3')
        self.assertIsNotNone(self.device.last_seen)
        self.assertIsNone(self.device.desired_release)
        self.assertEqual(self.client.post(report, {'version':'x', 'status':'invented', 'maintenance':False}, format='json').status_code, 400)
        self.device.credential_hash = hashlib.sha256(b'rotated-token').hexdigest()
        self.device.save()
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_provisioning_files_and_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / 'first.json'
            output = StringIO()
            options = dict(profile='inlet', hardware='wroom32-4mb-v1',
                backend='https://example.up.railway.app', stdout=output)
            call_command('provision_device', 'inlet-01', output=first, **options)
            token = json.loads(first.read_text())['device_token']
            self.assertNotIn(token, output.getvalue())
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            self.client.credentials(HTTP_AUTHORIZATION='Bearer '+token)
            self.assertEqual(self.client.get(self.url).status_code, 204)
            with self.assertRaises(FileExistsError):
                call_command('provision_device', 'inlet-01', output=first, **options)
            self.assertEqual(self.client.get(self.url).status_code, 204)
            call_command('provision_device', 'inlet-01', output=Path(directory)/'second.json', **options)
            self.assertEqual(self.client.get(self.url).status_code, 403)
            with self.assertRaises(CommandError):
                call_command('provision_device', 'inlet-01', output=Path(directory)/'bad.json',
                    **{**options, 'profile':'outlet'})

    def test_import_is_atomic_and_disabled_until_review(self):
        with tempfile.TemporaryDirectory() as directory:
            for profile in ('inlet', 'outlet', 'control'):
                release = self.release(profile)
                path = Path(directory)/f'{profile}.manifest.json'
                path.write_text(release.manifest)
                path.with_suffix('.json.sig').write_bytes(base64.b64decode(release.signature))
            FirmwareRelease.objects.all().delete()
            signature = Path(directory)/'control.manifest.json.sig'
            valid = signature.read_bytes()
            signature.write_bytes(b'invalid')
            options = dict(base_url='https://github.com/example/repo/releases/download/firmware-v1.2.3', stdout=StringIO())
            with self.assertRaises(CommandError): call_command('import_firmware_release', Path(directory), **options)
            self.assertEqual(FirmwareRelease.objects.count(), 0)
            signature.write_bytes(valid)
            call_command('import_firmware_release', Path(directory), **options)
            self.assertEqual(FirmwareRelease.objects.count(), 3)
            self.assertFalse(FirmwareRelease.objects.filter(enabled=True).exists())

    def test_staff_approval_audit_and_explicit_retry(self):
        release = self.release()
        user = get_user_model().objects.create_superuser('operator', 'operator@example.com', 'test-password')
        request = SimpleNamespace(user=user)
        manager = DeviceAdmin(Device, admin.site)
        self.device.desired_release = release
        self.device.full_clean()
        Device.objects.filter(pk=self.device.pk).update(reported_version="fresh-report")
        manager.save_model(request, self.device, None, True)
        self.device.refresh_from_db()
        self.assertEqual(self.device.reported_version, "fresh-report")
        self.assertEqual(self.device.approval_generation, 1)
        self.assertEqual(FirmwareApproval.objects.get().approved_by, user)
        manager.reapprove(request, Device.objects.filter(pk=self.device.pk))
        self.device.refresh_from_db()
        self.assertEqual(self.device.approval_generation, 2)
        self.assertEqual(FirmwareApproval.objects.count(), 2)
        anonymous = APIClient()
        self.assertEqual(anonymous.post('/admin/monitoring/device/', {}).status_code, 302)
