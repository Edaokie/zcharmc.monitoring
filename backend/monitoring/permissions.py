import secrets

from django.conf import settings
from rest_framework.permissions import BasePermission


class ReadPermission(BasePermission):
    def has_permission(self, request, view):
        return settings.ALLOW_PUBLIC_READ or bool(request.user and request.user.is_authenticated)


class IngestPermission(BasePermission):
    message = "A valid ingestion bearer key is required."

    def has_permission(self, request, view):
        expected = settings.INGEST_API_KEY
        supplied = request.headers.get("Authorization", "")
        return bool(expected) and secrets.compare_digest(supplied, f"Bearer {expected}")
