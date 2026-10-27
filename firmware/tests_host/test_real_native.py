"""Real-data mode: validity rules, source marking in the queue, and the USB export label."""
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


def partition_with(payload):
    record = bytearray(256)
    struct.pack_into('<IIQQ', record, 0, 0x5a435131, len(payload), 1, 0)
    record[24:24+len(payload)] = payload
    struct.pack_into('<II', record, 248, zlib.crc32(record[:248]), 0xfffffffe)
    return dump_outbox.FORMAT + bytes([255])*(4096-16) + record + bytes([255])*(4096-256)


class RealModeTests(unittest.TestCase):
    def test_real_adapter_and_export(self):
        firmware = Path(__file__).resolve().parents[1]
        compiler = shutil.which('cc')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            for role in ('inlet', 'outlet', 'control'):
                with self.subTest(role=role):
                    binary = Path(directory) / role
                    subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror',
                                    '-fsanitize=address,undefined', '-DZC_DATA_MODE=2', f'-DZC_PROFILE="{role}"',
                                    '-I', str(firmware / 'src/idf'), str(firmware / 'src/idf/sensors.c'),
                                    str(firmware / 'tests_host/native/test_real.c'), '-lm', '-o', str(binary)],
                                   check=True, capture_output=True)
                    sample = Path(directory) / f'{role}.bin'
                    subprocess.run([str(binary), str(sample)], check=True, capture_output=True)
                    if role == 'control':
                        self.assertFalse(sample.exists())
                        continue
                    rows = list(dump_outbox.decode(partition_with(sample.read_bytes())))
                    self.assertEqual(rows[0]['source'], 'real')
                    reading = rows[0]['reading']
                    self.assertTrue(reading['message_id'].startswith(f'real-{role}-'))
                    self.assertEqual({k: reading[k] for k in ('co2', 'temperature', 'humidity', 'pm25')},
                                     {'co2': 1234, 'temperature': 24.5, 'humidity': 45.6, 'pm25': 12})
                    self.assertNotIn('ph', reading)

    def test_unknown_source_is_refused_by_export(self):
        payload = bytearray(dump_outbox.SAMPLE_V2.size)
        struct.pack_into('<I', payload, 0, 2)
        fields = list(dump_outbox.SAMPLE_V2.unpack(bytes(payload)))
        fields[0], fields[1], fields[-5], fields[-2], fields[-1] = 2, 1, 1, 2, b'bench-inlet'.ljust(72, b'\0')
        with self.assertRaises(ValueError):
            list(dump_outbox.decode(partition_with(dump_outbox.SAMPLE_V2.pack(*fields))))


if __name__ == '__main__':
    unittest.main()
