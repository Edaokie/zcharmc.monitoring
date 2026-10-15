"""CI may register signed releases; only staff may enable or assign them."""
import json
import re
import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from .models import FirmwareRelease


class RegistrationPermission(BasePermission):
    def has_permission(self, request, view):
        key = settings.OTA_RELEASE_REGISTRATION_KEY
        supplied = request.headers.get("Authorization", "")
        return bool(key) and secrets.compare_digest(
            supplied.encode(), f"Bearer {key}".encode(),
        )


class SignedManifestSerializer(serializers.Serializer):
    manifest = serializers.CharField(max_length=4096, trim_whitespace=False)
    signature = serializers.CharField(max_length=512, trim_whitespace=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) != {"manifest", "signature"}:
            raise serializers.ValidationError("Expected only manifest and signature.")
        return super().to_internal_value(data)


class RegistrationSerializer(serializers.Serializer):
    base_url = serializers.URLField(max_length=200)
    releases = SignedManifestSerializer(many=True, min_length=3, max_length=3)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) != {"base_url", "releases"}:
            raise serializers.ValidationError("Expected only base_url and releases.")
        return super().to_internal_value(data)


class ReleaseConflict(Exception):
    pass


@transaction.atomic
def register_package(base_url, entries):
    repository = settings.OTA_RELEASE_REPOSITORY
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValidationError("Configure OTA_RELEASE_REPOSITORY as owner/repository.")
    candidates = []
    identities = set()
    for entry in entries:
        try:
            data = json.loads(entry["manifest"])
            candidate = FirmwareRelease(
                version=data["version"], profile=data["profile"], hardware=data["hardware"],
                manifest=entry["manifest"], signature=entry["signature"], base_url=base_url,
            )
            candidate.full_clean(validate_unique=False, validate_constraints=False)
            expected = f"https://github.com/{repository}/releases/download/firmware-v{candidate.version}"
            if base_url != expected:
                raise ValueError()
            identities.add((candidate.version, candidate.hardware, data["commit"]))
            candidates.append(candidate)
        except (KeyError, TypeError, ValueError) as error:
            raise ValidationError("Invalid release package or repository/tag URL.") from error
    if len(identities) != 1 or sorted(item.profile for item in candidates) != ["control", "inlet", "outlet"]:
        raise ValidationError("Supply one release per role from the same version, hardware and commit.")
    created_count = 0
    # Stable insertion/lock order also covers overlapping retries on PostgreSQL.
    for candidate in sorted(candidates, key=lambda item: item.profile):
        release, created = FirmwareRelease.objects.get_or_create(
            version=candidate.version, profile=candidate.profile, hardware=candidate.hardware,
            defaults={"manifest": candidate.manifest, "signature": candidate.signature,
                      "base_url": candidate.base_url, "enabled": False},
        )
        # PSS can produce different valid signatures for the same manifest.
        # A retry never changes an existing release, its enabled flag or device approvals.
        if release.manifest != candidate.manifest or release.base_url != candidate.base_url:
            raise ReleaseConflict()
        created_count += int(created)
    return created_count


@api_view(["POST"])
@authentication_classes([])
@permission_classes([RegistrationPermission])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        created = register_package(serializer.validated_data["base_url"], serializer.validated_data["releases"])
    except ValidationError:
        return Response({"error": "Release package rejected; check signatures, metadata and repository configuration."}, status=400)
    except ReleaseConflict:
        return Response({"error": "An existing release has different immutable metadata. Publish a new version."}, status=409)
    response = Response({"registered": 3, "created": created, "device_assignments_changed": False},
                        status=201 if created else 200)
    response["Cache-Control"] = "no-store"
    return response
