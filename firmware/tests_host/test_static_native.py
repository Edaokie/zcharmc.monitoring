"""Execute all three real static adapters and decode their versioned queue payloads."""
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import dump_outbox


class StaticProfilesTests(unittest.TestCase):
    def test_three_static_profiles_and_legacy_compatibility(self):
        firmware = Path(__file__).resolve().parents[1]
        compiler = shutil.which('cc')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            for role in ('inlet', 'outlet', 'control'):
                with self.subTest(role=role):
                    binary = Path(directory) / role
                    subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror',
                                    '-fsanitize=address,undefined', '-DZC_DATA_MODE=1', f'-DZC_PROFILE="{role}"',
                                    '-I', str(firmware / 'src/idf'), str(firmware / 'src/idf/sensors.c'),
                                    str(firmware / 'tests_host/native/test_static.c'), '-o', str(binary)], check=True, capture_output=True)
                    sample = Path(directory) / f'{role}.bin'
                    subprocess.run([str(binary), str(sample)], check=True, capture_output=True)
                    payload = sample.read_bytes()
                    record = bytearray(256)
                    struct.pack_into('<IIQQ', record, 0, 0x5a435131, len(payload), 1, 0)
                    record[24:24+len(payload)] = payload
                    struct.pack_into('<II', record, 248, zlib.crc32(record[:248]), 0xfffffffe)
                    partition = dump_outbox.FORMAT + bytes([255])*(4096-16) + record + bytes([255])*(4096-256)
                    rows = list(dump_outbox.decode(partition))
                    self.assertEqual(rows[0]['reading']['node_id'], role)
                    self.assertEqual(rows[0]['source'], 'simulated')
                    self.assertEqual(rows[0]['device_id'], f'bench-{role}')
                    if role == 'control':
                        self.assertEqual(rows[0]['reading']['valves'], dict.fromkeys(('sv1','sv2','sv3','sv4'), False))
                        self.assertEqual(rows[0]['reading']['weights'], {'weight1': 1000, 'weight2': 2000})
                    else:
                        self.assertEqual(rows[0]['reading']['co2'], 4000 if role == 'inlet' else 800)
                        self.assertIn('ph', rows[0]['reading'])
                        self.assertEqual('level' in rows[0]['reading'], role == 'outlet')
