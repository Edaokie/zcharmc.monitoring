"""Device-authenticated OTA polling and staff-managed immutable releases."""
import base64
import hashlib
import json
import re
import secrets
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework import serializers

from .models import Device


def validate_release(release):
    try:
        raw = release.manifest.encode("ascii")
        data = json.loads(raw)
        if set(data) != {"schema", "version", "profile", "hardware", "commit", "image", "size", "sha256"}:
            raise ValueError()
        if raw != json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii"):
            raise ValueError()
        if type(data["schema"]) is not int or data["schema"] != 1 or (data["version"], data["profile"], data["hardware"]) != (release.version, release.profile, release.hardware):
            raise ValueError()
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", release.version):
            raise ValueError()
        if data["image"] != release.profile + ".bin" or type(data["size"]) is not int or data["size"] <= 0:
            raise ValueError()
        if not re.fullmatch(r"[0-9a-f]{64}", data["sha256"]) or not re.fullmatch(r"[0-9a-f]{40}", data["commit"]):
            raise ValueError()
        url = urlparse(release.base_url)
        if url.scheme != "https" or url.hostname not in settings.OTA_ASSET_HOSTS or url.port not in (None, 443) or url.username or url.password or url.query or url.fragment:
            raise ValueError()
        key = serialization.load_pem_public_key(settings.OTA_SIGNING_PUBLIC_KEY.encode())
        if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 3072:
            raise ValueError()
        key.verify(base64.b64decode(release.signature, validate=True), raw,
                   padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    except Exception as error:
        raise ValidationError("Release signature, metadata or HTTPS asset host is invalid; configure the trusted OTA public key.") from error


class DevicePermission(BasePermission):
    def has_permission(self, request, view):
        auth = request.headers.get("Authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        if not token or len(token) > 256:
            return False
        device = Device.objects.filter(device_id=view.kwargs["device_id"], enabled=True).first()
        if not device or not secrets.compare_digest(device.credential_hash, hashlib.sha256(token.encode()).hexdigest()):
            return False
        request.ota_device = device
        return True


def private(response):
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([DevicePermission])
def target(request, device_id):
    device = request.ota_device
    release = device.desired_release
    if not release or not release.enabled:
        return private(Response(status=204))
    try:
        validate_release(release)
        if (release.profile, release.hardware) != (device.profile, device.hardware):
            raise ValidationError("Incompatible target")
    except ValidationError:
        return private(Response({"error": "OTA release unavailable"}, status=503))
    return private(Response({"generation": device.approval_generation, "manifest": release.manifest,
                             "signature": release.signature, "base_url": release.base_url.rstrip("/")}))


class ReportSerializer(serializers.Serializer):
    version = serializers.CharField(max_length=31)
    status = serializers.ChoiceField(choices=["healthy", "pending", "updating", "rolled_back", "failed", "not_provisioned"])
    maintenance = serializers.BooleanField()


@api_view(["POST"])
@authentication_classes([])
@permission_classes([DevicePermission])
def report(request, device_id):
    serializer = ReportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    Device.objects.filter(pk=request.ota_device.pk).update(reported_version=data["version"],
        reported_status=data["status"], maintenance=data["maintenance"], last_seen=timezone.now())
    return private(Response({"ok": True}))
