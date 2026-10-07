import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("release_package", Path(__file__).parents[1] / "tools/release_package.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.key = cls.root / "test-only-private.pem"
        cls.other_key = cls.root / "other-private.pem"
        for key in (cls.key, cls.other_key):
            subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", str(key)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.other_public = cls.root / "other-public.pem"
        cls.other_public.write_bytes(release.run("pkey", "-in", cls.other_key, "-pubout"))
        cls.inputs = cls.root / "inputs"
        cls.inputs.mkdir()
        for profile in release.PROFILES:
            # Descriptor-shaped fixture only: invalid machine code, never flashable.
            content = bytearray(256)
            content[0] = 0xE9
            content[32:36] = bytes.fromhex("3254cdab")
            content[48:53] = b"1.2.3"
            name = ("zcharmc-" + profile).encode()
            content[80:80+len(name)] = name
            (cls.inputs / f"{profile}.bin").write_bytes(content)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def make_package(self):
        out = self.root / self._testMethodName
        release.package(self.inputs, out, "1.2.3", "test-board", "a" * 40, self.key)
        return out

    def test_all_roles_verify_and_existing_output_is_immutable(self):
        out = self.make_package()
        for profile in release.PROFILES:
            data = release.verify_package(out / f"{profile}.manifest.json", out / "release-public.pem", profile, "test-board")
            self.assertEqual(data["version"], "1.2.3")
        with self.assertRaises(ValueError):
            release.package(self.inputs, out, "1.2.3", "test-board", "a" * 40, self.key)

    def test_wrong_role_hardware_and_signing_key_rejected(self):
        out = self.make_package()
        manifest = out / "inlet.manifest.json"
        for key, role, hardware in ((out / "release-public.pem", "control", "test-board"),
                                    (out / "release-public.pem", "inlet", "other-board"),
                                    (self.other_public, "inlet", "test-board")):
            with self.assertRaises(ValueError):
                release.verify_package(manifest, key, role, hardware)

    def test_swapped_image_or_embedded_version_rejected(self):
        content = (self.inputs / "inlet.bin").read_bytes()
        with self.assertRaises(ValueError): release.image_identity(content, "outlet", "1.2.3")
        with self.assertRaises(ValueError): release.image_identity(content, "inlet", "9.9.9")

    def test_changed_binary_rejected(self):
        out = self.make_package()
        (out / "control.bin").write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            release.verify_package(out / "control.manifest.json", out / "release-public.pem", "control", "test-board")

    def test_changed_manifest_rejected(self):
        out = self.make_package()
        manifest = out / "inlet.manifest.json"
        data = json.loads(manifest.read_bytes())
        data["version"] = "9.9.9"
        manifest.write_bytes(release.canonical(data))
        with self.assertRaises(ValueError):
            release.verify_package(manifest, out / "release-public.pem", "inlet", "test-board")

    def test_invalid_metadata_and_path_escape_rejected(self):
        out = self.make_package()
        data = json.loads((out / "inlet.manifest.json").read_bytes())
        for field, value in (("image", "../control.bin"), ("version", "latest"), ("hardware", "../../board"),
                             ("commit", "short"), ("schema", True), ("size", True), ("profile", "unknown")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.canonical({**data, field: value})


if __name__ == "__main__":
    unittest.main()
