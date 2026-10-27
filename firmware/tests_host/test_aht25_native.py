"""Compile and run the AHT25 CRC/measurement decoder natively with sanitizers."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class Aht25DecoderTests(unittest.TestCase):
    def test_crc_and_decode(self):
        firmware = Path(__file__).resolve().parents[1]
        compiler = shutil.which('cc')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'aht25'
            subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
                            '-I', str(firmware / 'src/idf'), str(firmware / 'src/idf/aht25.c'),
                            str(firmware / 'tests_host/native/test_aht25.c'), '-lm', '-o', str(binary)],
                           check=True, capture_output=True)
            subprocess.run([str(binary)], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
