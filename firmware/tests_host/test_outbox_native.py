"""Execute the actual portable C outbox against a fault-injected NOR flash model."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
import unittest


class NativeOutboxTests(unittest.TestCase):
    def test_flash_recovery_and_retry_policy(self):
        compiler = shutil.which('cc') or shutil.which('gcc') or shutil.which('clang')
        self.assertIsNotNone(compiler, 'Install a C compiler to test native flash recovery.')
        firmware = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'outbox-test'
            subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror',
                            '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                            '-I', str(firmware / 'src/idf'),
                            str(firmware / 'src/idf/outbox.c'),
                            str(firmware / 'tests_host/native/test_outbox.c'), '-o', str(binary)], check=True, capture_output=True)
            dump = Path(directory) / 'queue.bin'
            result = subprocess.run([str(binary), str(dump)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('power-cut boundaries passed', result.stdout)
            sys.path.insert(0, str(firmware / 'tools'))
            import dump_outbox
            rows = list(dump_outbox.decode(dump.read_bytes()))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['device_id'], 'bench-inlet')
            self.assertEqual(rows[0]['reading']['temperature'], 29.3)
            self.assertEqual(rows[0]['reading']['timestamp'], '2025-10-09T08:53:20.123Z')
            export = Path(directory) / 'recovery.jsonl'
            command = [sys.executable, str(firmware / 'tools/dump_outbox.py'), str(dump), '--output', str(export)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(export.stat().st_mode & 0o777, 0o600)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            corrupted = bytearray(dump.read_bytes())
            corrupted[4096+40] ^= 1
            with self.assertRaises(ValueError):
                list(dump_outbox.decode(corrupted))
