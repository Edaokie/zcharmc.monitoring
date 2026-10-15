"""Durable, idempotent acceptance of explicitly opted-in simulated device readings."""
from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Device, DeviceTestReading
from .ota import DevicePermission
from .serializers import SensorPayloadSerializer
from .services import MessageConflict


@api_view(['POST'])
@authentication_classes([])
@permission_classes([DevicePermission])
def ingest(request, device_id):
    data = request.data
    if not isinstance(data, dict) or set(data) != {'source', 'reading'} or data['source'] != 'simulated':
        raise serializers.ValidationError('Expected an explicitly simulated reading envelope.')
    if not isinstance(data['reading'], dict):
        raise serializers.ValidationError('Expected a reading object.')
    serializer = SensorPayloadSerializer(data=data['reading'])
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
        if device.profile not in ('inlet', 'outlet') or reading['node_id'] != device.profile:
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
