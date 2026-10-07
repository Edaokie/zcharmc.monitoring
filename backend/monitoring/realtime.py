import socketio
from django.conf import settings
from django.db import close_old_connections

sio = socketio.Server(
    async_mode="threading", cors_allowed_origins=settings.SOCKET_ALLOWED_ORIGINS or None,
    max_http_buffer_size=256 * 1024, logger=False, engineio_logger=False,
)


@sio.event
def connect(sid, environ, auth):
    close_old_connections()
    try:
        if not settings.ALLOW_PUBLIC_READ:
            from rest_framework.authtoken.models import Token
            key = auth.get("token") if isinstance(auth, dict) else None
            if not isinstance(key, str) or not Token.objects.filter(key=key, user__is_active=True).exists():
                return False
        # Restore the latest state after reconnecting instead of showing invented values.
        from .models import NODE_IDS, Reading, ValveSnapshot
        from .serializers import ReadingSerializer
        for node_id in NODE_IDS:
            reading = Reading.objects.filter(node_id=node_id).first()
            if reading:
                sio.emit("co2_update", dict(ReadingSerializer(reading).data), to=sid)
        for snapshot in ValveSnapshot.objects.all():
            sio.emit("valve_update", {
                "node_id": snapshot.node_id, "valves": snapshot.valves,
                "timestamp": snapshot.timestamp.isoformat(),
            }, to=sid)
    finally:
        close_old_connections()


def unsupported_actuation(sid, data):
    # Firmware commands are not implemented. Never claim a physical action succeeded.
    result = {"ok": False, "error": "Hardware actuation is not available in this backend."}
    sio.emit("command_error", result, to=sid)
    return result


sio.on("actuate_valve", unsupported_actuation)
sio.on("actuate_vacuum", unsupported_actuation)
