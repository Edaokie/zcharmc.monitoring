"""Compile and run the SCD41 CRC/measurement decoder natively with sanitizers."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class Scd41DecoderTests(unittest.TestCase):
    def test_crc_and_decode(self):
        firmware = Path(__file__).resolve().parents[1]
        compiler = shutil.which('cc')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'scd41'
            subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
                            '-I', str(firmware / 'src/idf'), str(firmware / 'src/idf/scd41.c'),
                            str(firmware / 'tests_host/native/test_scd41.c'), '-lm', '-o', str(binary)],
                           check=True, capture_output=True)
            subprocess.run([str(binary)], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
