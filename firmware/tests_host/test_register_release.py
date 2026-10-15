import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

TOOLS = Path(__file__).parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import register_release as delivery
import release_package as package


class RegistrationClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        key = cls.root / 'test-only.pem'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072',
                        '-out', str(key)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        inputs = cls.root / 'input'
        inputs.mkdir()
        for role in package.PROFILES:
            image = bytearray(256)
            image[0] = 0xE9
            image[32:36] = bytes.fromhex('3254cdab')
            image[48:53] = b'1.2.3'
            name = ('zcharmc-' + role).encode()
            image[80:80+len(name)] = name
            (inputs / f'{role}.bin').write_bytes(image)
        cls.output = cls.root / 'release'
        package.package(inputs, cls.output, '1.2.3', 'test-board', 'a'*40, key)
        cls.trusted = cls.output / 'release-public.pem'

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def payload(self, **changes):
        args = dict(directory=self.output, trusted_key=self.trusted, repository='example/repo',
                    tag='firmware-v1.2.3', commit='a'*40)
        args.update(changes)
        return delivery.payload_for(**args)

    def test_downloaded_assets_verified_before_building_registration_payload(self):
        result = self.payload()
        self.assertEqual(result['base_url'], 'https://github.com/example/repo/releases/download/firmware-v1.2.3')
        self.assertEqual(len(result['releases']), 3)
        self.assertNotIn('enabled', json.dumps(result))
        with self.assertRaises(ValueError): self.payload(tag='firmware-v1.2.4')
        with self.assertRaises(ValueError): self.payload(commit='c'*40)
        with self.assertRaises(ValueError): self.payload(tag='../../invalid')
        with tempfile.TemporaryDirectory() as temp:
            copy = Path(temp) / 'copy'
            shutil.copytree(self.output, copy)
            (copy / 'control.bin').write_bytes(b'tampered')
            with self.assertRaises(ValueError): self.payload(directory=copy)

    def response(self):
        response = MagicMock()
        response.__enter__.return_value = io.BytesIO(
            b'{"registered":3,"created":3,"device_assignments_changed":false}')
        return response

    @patch.object(delivery, 'time')
    @patch.object(delivery, 'build_opener')
    def test_lost_response_retries_identical_payload_with_separate_credential(self, opener, clock):
        opener.return_value.open.side_effect = [URLError('lost acknowledgement'), self.response()]
        result = delivery.register('https://backend.example', 'test-registration-secret', self.payload())
        self.assertEqual(result['registered'], 3)
        calls = opener.return_value.open.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].args[0].data, calls[1].args[0].data)
        self.assertEqual(calls[0].args[0].get_header('Authorization'), 'Bearer test-registration-secret')
        self.assertEqual(calls[0].args[0].full_url, 'https://backend.example/api/firmware/releases/register')
        self.assertIsInstance(opener.call_args.args[0], delivery.NoRedirect)

    @patch.object(delivery, 'time')
    @patch.object(delivery, 'build_opener')
    def test_http_errors_are_bounded_and_do_not_expose_response_body(self, opener, clock):
        for status, attempts in [(403, 1), (409, 1), (302, 1), (503, 3)]:
            opener.return_value.open.reset_mock()
            opener.return_value.open.side_effect = HTTPError('https://backend.example', status, 'error', {},
                                                           io.BytesIO(b'secret-response'))
            with self.subTest(status=status), self.assertRaises(ValueError) as caught:
                delivery.register('https://backend.example', 'test-registration-secret', self.payload())
            self.assertNotIn('secret-response', str(caught.exception))
            self.assertNotIn('test-registration-secret', str(caught.exception))
            self.assertEqual(opener.return_value.open.call_count, attempts)
        self.assertIsNone(delivery.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))

    @patch.object(delivery, 'build_opener')
    def test_invalid_backend_or_missing_key_never_sends_credentials(self, opener):
        for backend in ['http://backend.example', 'https://user:password@backend.example',
                        'https://backend.example/path', 'https://backend.example?query=1', 'https://']:
            with self.subTest(backend=backend), self.assertRaises(ValueError):
                delivery.register(backend, 'test-secret', {})
        with self.assertRaises(ValueError): delivery.register('https://backend.example', '', {})
        with self.assertRaises(ValueError): delivery.register('https://backend.example', 'secret\nvalue', {})
        opener.assert_not_called()
