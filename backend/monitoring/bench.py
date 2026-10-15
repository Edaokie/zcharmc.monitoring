"""Read-only staff views of explicitly simulated readings, separate from research data."""
from django.db.models import OuterRef, Subquery
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound

from .fleet import FirmwareOperator, page
from .models import Device, DeviceTestReading


def reading_data(record):
    return dict(message_id=record.message_id, payload=record.payload, received_at=record.received_at)


@api_view(['GET'])
@permission_classes([FirmwareOperator])
def devices(request):
    latest = DeviceTestReading.objects.filter(device_id=OuterRef('pk')).order_by('-received_at', '-pk')
    query = Device.objects.order_by('device_id').annotate(
        test_payload=Subquery(latest.values('payload')[:1]),
        test_received=Subquery(latest.values('received_at')[:1]))
    def serialize(device):
        return dict(device_id=device.device_id, profile=device.profile, enabled=device.enabled,
                    allow_test_telemetry=device.allow_test_telemetry,
                    reported_version=device.reported_version, last_seen=device.last_seen,
                    latest=dict(payload=device.test_payload, received_at=device.test_received) if device.test_payload else None)
    return page(request, query, serialize)


@api_view(['GET'])
@permission_classes([FirmwareOperator])
def history(request, device_id):
    device = Device.objects.filter(device_id=device_id).first()
    if device is None:
        raise NotFound()
    rows = DeviceTestReading.objects.filter(device=device).order_by('-received_at', '-pk')
    return page(request, rows, reading_data)
