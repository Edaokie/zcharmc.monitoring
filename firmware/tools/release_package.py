"""Create or verify a signed OTA release package. Never flashes a device.

Uses OpenSSL RSA-3072/PSS/SHA-256 signatures with a 32-byte salt. Private keys
must live outside Git. Every profile has a distinct image and signed manifest;
metadata binds the role, hardware, version, commit, size and image digest.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

PROFILES = ("inlet", "outlet", "control")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\Z")
HARDWARE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
FIELDS = {"schema", "version", "profile", "hardware", "commit", "image", "size", "sha256"}


def run(*args):
    result = subprocess.run(["openssl", *map(str, args)], capture_output=True, check=False)
    if result.returncode:
        raise ValueError("OpenSSL operation failed; check key type and signature.")
    return result.stdout


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(manifest):
    require(isinstance(manifest, dict) and set(manifest) == FIELDS, "Unexpected manifest fields")
    require(type(manifest["schema"]) is int and manifest["schema"] == 1, "Unsupported schema")
    require(isinstance(manifest["version"], str) and VERSION.fullmatch(manifest["version"])
            and len(manifest["version"]) <= 31, "Version must be a semantic version of at most 31 bytes")
    require(manifest["profile"] in PROFILES, "Unknown profile")
    require(isinstance(manifest["hardware"], str) and HARDWARE.fullmatch(manifest["hardware"]), "Invalid hardware ID")
    require(isinstance(manifest["commit"], str) and COMMIT.fullmatch(manifest["commit"]), "Full source commit required")
    require(manifest["image"] == f'{manifest["profile"]}.bin', "Image must match profile")
    require(type(manifest["size"]) is int and manifest["size"] > 0, "Image must not be empty")
    require(isinstance(manifest["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"]), "Invalid SHA-256")


def canonical(manifest):
    validate(manifest)
    return json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def signature_options():
    return ["-sigopt", "rsa_padding_mode:pss", "-sigopt", "rsa_pss_saltlen:32"]


def sign(source, private_key, destination):
    run("dgst", "-sha256", "-sign", private_key, *signature_options(), "-out", destination, source)
    require(destination.stat().st_size == 384, "Use an RSA-3072 signing key")


def verify_signature(source, public_key, signature):
    require(signature.stat().st_size == 384, "Expected RSA-3072 signature")
    run("dgst", "-sha256", "-verify", public_key, *signature_options(), "-signature", signature, source)


def image_identity(content, profile, version):
    # ESP-IDF app descriptor begins after the 24-byte image and 8-byte segment headers.
    require(len(content) >= 112 and content[0] == 0xE9 and content[32:36] == bytes.fromhex("3254cdab"), "Not an ESP-IDF application image")
    require(content[48:80].split(b"\0", 1)[0] == version.encode("ascii"), "Embedded image version mismatch")
    require(content[80:112].split(b"\0", 1)[0] == ("zcharmc-" + profile).encode("ascii"), "Embedded image role mismatch")


def package(input_dir, output, version, hardware, commit, key):
    # Validate all inputs before producing any output. Existing packages are immutable.
    manifests = []
    for profile in PROFILES:
        image = input_dir / f"{profile}.bin"
        require(image.is_file(), f"Missing {profile}.bin")
        content = image.read_bytes()
        manifest = {"schema": 1, "version": version, "profile": profile, "hardware": hardware,
                    "commit": commit, "image": image.name, "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest()}
        validate(manifest)
        image_identity(content, profile, version)
        require(len(content) <= 0x1A0000, "Image exceeds the configured OTA slot")
        manifests.append(manifest)
    require(not output.exists(), "Output already exists; use a new release directory")
    output.mkdir(parents=True)
    try:
        public_key = output / "release-public.pem"
        public_key.write_bytes(run("pkey", "-in", key, "-pubout"))
        for manifest in manifests:
            image = output / manifest["image"]
            shutil.copyfile(input_dir / image.name, image)
            metadata = output / f'{manifest["profile"]}.manifest.json'
            metadata.write_bytes(canonical(manifest))
            sign(image, key, image.with_suffix(".bin.sig"))
            sign(metadata, key, metadata.with_suffix(".json.sig"))
            verify_package(metadata, public_key, manifest["profile"], hardware)
    except BaseException:
        shutil.rmtree(output)
        raise


def verify_package(metadata, trusted_key, expected_profile, expected_hardware):
    # The key must come from provisioning, not from the downloaded package.
    verify_signature(metadata, trusted_key, metadata.with_suffix(".json.sig"))
    original = metadata.read_bytes()
    manifest = json.loads(original)
    require(original == canonical(manifest), "Manifest is not canonical")
    require(manifest["profile"] == expected_profile, "Profile mismatch")
    require(manifest["hardware"] == expected_hardware, "Hardware mismatch")
    image = metadata.parent / manifest["image"]
    content = image.read_bytes()
    image_identity(content, expected_profile, manifest["version"])
    require(len(content) == manifest["size"], "Image size mismatch")
    require(hashlib.sha256(content).hexdigest() == manifest["sha256"], "Image digest mismatch")
    verify_signature(image, trusted_key, image.with_suffix(".bin.sig"))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    build = actions.add_parser("package")
    build.add_argument("--input", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--hardware", required=True)
    build.add_argument("--commit", required=True)
    build.add_argument("--key", type=Path, required=True)
    build.add_argument("--trusted-key", type=Path, required=True)
    verify = actions.add_parser("verify")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--trusted-key", type=Path, required=True)
    verify.add_argument("--profile", choices=PROFILES, required=True)
    verify.add_argument("--hardware", required=True)
    args = parser.parse_args()
    try:
        if args.action == "package":
            generated = run("pkey", "-in", args.key, "-pubout", "-outform", "DER")
            expected = run("pkey", "-pubin", "-in", args.trusted_key, "-outform", "DER")
            require(generated == expected, "Signing key does not match the provisioned public trust anchor")
            package(args.input, args.output, args.version, args.hardware, args.commit, args.key)
            print("Created and verified signed packages for inlet, outlet and control.")
        else:
            manifest = verify_package(args.manifest, args.trusted_key, args.profile, args.hardware)
            print(f'Verified {manifest["profile"]} {manifest["version"]} ({manifest["hardware"]}).')
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f"Release rejected: {error}\n")


if __name__ == "__main__":
    main()
