"""Compile and run the PMS7003 frame decoder natively with sanitizers."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class Pms7003ParserTests(unittest.TestCase):
    def test_frame_decoder(self):
        firmware = Path(__file__).resolve().parents[1]
        compiler = shutil.which('cc')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'pms'
            subprocess.run([compiler, '-std=c11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
                            '-I', str(firmware / 'src/idf'), str(firmware / 'src/idf/pms7003.c'),
                            str(firmware / 'tests_host/native/test_pms7003.c'), '-o', str(binary)],
                           check=True, capture_output=True)
            subprocess.run([str(binary)], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
