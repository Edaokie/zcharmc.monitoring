"""Staff OTA operations. Device and CI credentials cannot authorize these routes."""
import json
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException, NotFound
from rest_framework.permissions import BasePermission

from .browser_auth import can_manage_firmware, private
from .models import Device, DeviceReport, FirmwareApproval, FirmwareRelease
from .ota import validate_release


class FirmwareOperator(BasePermission):
    def has_permission(self, request, view):
        return can_manage_firmware(request.user)


class Conflict(APIException):
    status_code = 409
    default_detail = 'This device changed. Refresh before approving another operation.'


def release_data(release):
    if release is None:
        return None
    try:
        validate_release(release)
        metadata = json.loads(release.manifest)
        verified = True
    except (ValidationError, ValueError, TypeError):
        metadata, verified = {}, False
    return dict(id=release.pk, version=release.version, profile=release.profile,
                hardware=release.hardware, enabled=release.enabled, verified=verified,
                commit=metadata.get('commit', ''), created_at=release.created_at)


def device_data(device):
    age = (timezone.now() - device.last_seen).total_seconds() if device.last_seen else None
    return dict(device_id=device.device_id, profile=device.profile, hardware=device.hardware,
                enabled=device.enabled, reported_version=device.reported_version,
                reported_status=device.reported_status, maintenance=device.maintenance,
                last_seen=device.last_seen,
                contact='never_seen' if age is None else 'recent' if age < 180 else 'stale',
                desired_release=release_data(device.desired_release),
                approval_generation=device.approval_generation)


def page(request, query, serialize):
    try:
        number = int(request.query_params.get('page', 1))
    except ValueError:
        raise serializers.ValidationError({'page': 'Expected a positive integer.'})
    if number < 1 or number > 100000:
        raise serializers.ValidationError({'page': 'Expected a positive page number.'})
    count = query.count()
    return private(dict(count=count, page=number, next_page=number+1 if count > number*50 else None,
                        results=[serialize(item) for item in query[(number-1)*50:number*50]]))


@api_view(['GET'])
@permission_classes([FirmwareOperator])
def devices(request):
    query = Device.objects.select_related('desired_release').order_by('device_id')
    if search := request.query_params.get('search', '').strip():
        query = query.filter(device_id__icontains=search[:64])
    return page(request, query, device_data)


@api_view(['GET'])
@permission_classes([FirmwareOperator])
def releases(request):
    query = FirmwareRelease.objects.order_by('-created_at', '-pk')
    for field in ('profile', 'hardware'):
        if value := request.query_params.get(field):
            query = query.filter(**{field: value})
    return page(request, query, release_data)


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({'non_field_errors': ['Unexpected operation fields.']})
        return super().to_internal_value(data)


class EnableSerializer(StrictSerializer):
    enabled = serializers.BooleanField()


@api_view(['PATCH'])
@permission_classes([FirmwareOperator])
@transaction.atomic
def enable_release(request, release_id):
    serializer = EnableSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    release = FirmwareRelease.objects.select_for_update().filter(pk=release_id).first()
    if release is None:
        raise NotFound()
    if serializer.validated_data['enabled']:
        try:
            validate_release(release)
        except ValidationError:
            raise serializers.ValidationError('The release signature or metadata is invalid.')
    release.enabled = serializer.validated_data['enabled']
    release.save(update_fields=['enabled'])
    # Reuse the administration audit log for release enablement changes.
    from django.contrib.admin.models import CHANGE, LogEntry
    LogEntry.objects.log_actions(user_id=request.user.pk, queryset=FirmwareRelease.objects.filter(pk=release.pk),
                                 action_flag=CHANGE, change_message=json.dumps([{'changed': {'fields': ['enabled']}}]))
    return private(release_data(release))


class TargetSerializer(StrictSerializer):
    expected_generation = serializers.IntegerField(min_value=0)
    release_id = serializers.IntegerField(min_value=1, allow_null=True)
    maintenance_confirmed = serializers.BooleanField(default=False)


class RetrySerializer(StrictSerializer):
    expected_generation = serializers.IntegerField(min_value=0)
    maintenance_confirmed = serializers.BooleanField(default=False)


def validate_target(device, release, confirmed):
    if not device.enabled:
        raise serializers.ValidationError('Enable this device in Django admin before assigning firmware.')
    if not release.enabled or (release.profile, release.hardware) != (device.profile, device.hardware):
        raise serializers.ValidationError('Choose an enabled release matching this device role and hardware.')
    try:
        validate_release(release)
    except ValidationError:
        raise serializers.ValidationError('The release signature or metadata is invalid.')
    if device.profile == 'control':
        recent = device.last_seen and device.last_seen >= timezone.now() - timedelta(seconds=180)
        if not confirmed or not device.maintenance or not recent:
            raise serializers.ValidationError('Control requires your maintenance confirmation and a maintenance report less than three minutes old.')


@api_view(['POST'])
@permission_classes([FirmwareOperator])
@transaction.atomic
def set_target(request, device_id, retry=False):
    serializer = (RetrySerializer if retry else TargetSerializer)(data=request.data)
    serializer.is_valid(raise_exception=True)
    device = Device.objects.select_for_update().filter(device_id=device_id).first()
    if device is None:
        raise NotFound()
    data = serializer.validated_data
    if device.approval_generation != data['expected_generation']:
        raise Conflict()
    release_id = device.desired_release_id if retry else data['release_id']
    if retry and release_id is None:
        raise serializers.ValidationError('There is no assigned release to retry.')
    release = None
    if release_id is not None:
        release = FirmwareRelease.objects.select_for_update().filter(pk=release_id).first()
        if release is None:
            raise NotFound('Release not found.')
        validate_target(device, release, data['maintenance_confirmed'])
        if device.reported_version == release.version:
            raise serializers.ValidationError('The device already reports this version. Publish a new version for another installation.')
    if retry or device.desired_release_id != release_id:
        device.desired_release = release
        device.approval_generation += 1
        device.save(update_fields=['desired_release', 'approval_generation'])
        FirmwareApproval.objects.create(device=device, release=release,
                                        generation=device.approval_generation, approved_by=request.user)
    return private(device_data(device))


@api_view(['GET'])
@permission_classes([FirmwareOperator])
def history(request, device_id):
    device = Device.objects.filter(device_id=device_id).first()
    if device is None:
        raise NotFound()
    approvals = [dict(kind='approval', timestamp=item.created_at, version=item.release.version if item.release else None,
                      generation=item.generation, actor=item.approved_by.get_username() if item.approved_by else 'Deleted user')
                 for item in FirmwareApproval.objects.filter(device=device).select_related('release', 'approved_by').order_by('-created_at')[:50]]
    reports = [dict(kind='report', timestamp=item.created_at, version=item.version, status=item.status,
                    maintenance=item.maintenance)
               for item in DeviceReport.objects.filter(device=device).order_by('-created_at')[:50]]
    return private(dict(events=sorted(approvals+reports, key=lambda item: item['timestamp'], reverse=True)[:50]))
