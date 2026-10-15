"""Durable, idempotent acceptance of explicitly opted-in simulated device readings."""
from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Device, DeviceTestReading
from .ota import DevicePermission
from .serializers import SensorPayloadSerializer, FiniteFloatField
from .contract import MAX_FUTURE_SECONDS
from django.utils import timezone
from datetime import timedelta
from .services import MessageConflict


class StrictFields(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({'non_field_errors': ['Unexpected snapshot fields.']})
        return super().to_internal_value(data)


class BenchValves(StrictFields):
    sv1 = serializers.BooleanField()
    sv2 = serializers.BooleanField()
    sv3 = serializers.BooleanField()
    sv4 = serializers.BooleanField()


class BenchWeights(StrictFields):
    weight1 = FiniteFloatField(min_value=0, max_value=1000000000)
    weight2 = FiniteFloatField(min_value=0, max_value=1000000000)


class ControlSnapshot(StrictFields):
    node_id = serializers.ChoiceField(choices=['control'])
    message_id = serializers.CharField(max_length=128)
    timestamp = serializers.DateTimeField()
    valves = BenchValves()
    weights = BenchWeights()

    def validate_timestamp(self, value):
        if value > timezone.now() + timedelta(seconds=MAX_FUTURE_SECONDS):
            raise serializers.ValidationError('Measurement timestamp exceeds the future allowance.')
        return value


@api_view(['POST'])
@authentication_classes([])
@permission_classes([DevicePermission])
def ingest(request, device_id):
    data = request.data
    if not isinstance(data, dict) or set(data) != {'source', 'reading'} or data['source'] != 'simulated':
        raise serializers.ValidationError('Expected an explicitly simulated reading envelope.')
    if not isinstance(data['reading'], dict):
        raise serializers.ValidationError('Expected a reading object.')
    serializer = (ControlSnapshot if request.ota_device.profile == 'control' else SensorPayloadSerializer)(data=data['reading'])
    serializer.is_valid(raise_exception=True)
    reading = dict(serializer.validated_data)
    if not reading.get('message_id') or 'timestamp' not in reading:
        raise serializers.ValidationError('A stable message_id and original UTC timestamp are required.')
    reading['timestamp'] = reading['timestamp'].isoformat()
    with transaction.atomic():
        # Serialize with disable/credential rotation/opt-out before accepting data.
        device = Device.objects.select_for_update().get(pk=request.ota_device.pk)
        if (not device.enabled or not device.allow_test_telemetry
                or device.credential_hash != request.ota_device.credential_hash):
            raise PermissionDenied('Simulated telemetry is disabled for this device.')
        if reading['node_id'] != device.profile:
            raise PermissionDenied('The reading must match the authenticated device role.')
        record, created = DeviceTestReading.objects.get_or_create(
            device=device, message_id=reading['message_id'], defaults={'payload': reading})
        if record.payload != reading:
            raise MessageConflict()
    # The transaction has committed before acknowledgement. A lost response is retryable.
    response = Response({'accepted': True, 'message_id': record.message_id,
                         'source': 'simulated', 'created': created}, status=201 if created else 200)
    response['Cache-Control'] = 'no-store'
    return response
