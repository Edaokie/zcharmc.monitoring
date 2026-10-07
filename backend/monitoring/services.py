from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from .models import Reading, ValveSnapshot
from .serializers import ReadingSerializer, SensorPayloadSerializer, ValvePayloadSerializer


class MessageConflict(APIException):
    status_code = 409
    default_detail = "message_id already exists with different reading data. Retry the original payload."
    default_code = "message_conflict"


def save_payload(payload):
    """Validate, commit, then publish. Failed writes are never acknowledged."""
    if payload.get("node_id") == "solenoid_valves":
        serializer = ValvePayloadSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        timestamp = timezone.now()
        with transaction.atomic():
            ValveSnapshot.objects.update_or_create(
                node_id=data["node_id"], defaults={"valves": data["valves"], "timestamp": timestamp},
            )
            event = {**data, "timestamp": timestamp.isoformat()}
            transaction.on_commit(lambda: broadcast("valve_update", event))
        return event, True

    serializer = SensorPayloadSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        if data.get("message_id"):
            defaults = {k: v for k, v in data.items() if k not in ("node_id", "message_id")}
            reading, created = Reading.objects.get_or_create(
                node_id=data["node_id"], message_id=data["message_id"], defaults=defaults,
            )
            if not created and any(getattr(reading, field) != value for field, value in defaults.items()):
                raise MessageConflict()
        else:
            reading, created = Reading.objects.create(**data), True
        event = dict(ReadingSerializer(reading).data)
        if created:
            transaction.on_commit(lambda: broadcast("co2_update", event))
    return event, created


def broadcast(event, payload):
    import logging
    from .realtime import sio

    try:
        sio.emit(event, payload)
    except Exception:
        # A transient client failure must not turn an already committed write into a 500.
        logging.getLogger(__name__).exception("Realtime broadcast failed")
