import socketio
import hashlib
from types import SimpleNamespace
from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user
from django.contrib.sessions.backends.db import SessionStore
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
            ticket = auth.get('ticket') if isinstance(auth, dict) else None
            browser_user = None
            if isinstance(ticket, str) and len(ticket) <= 256:
                cache_key = 'browser-socket:' + hashlib.sha256(ticket.encode()).hexdigest()
                session_key = cache.get(cache_key)
                consumed = cache.delete(cache_key)
                if session_key and consumed:
                    browser_user = get_user(SimpleNamespace(session=SessionStore(session_key=session_key)))
            browser_ok = browser_user and browser_user.is_authenticated and browser_user.is_active
            token_ok = isinstance(key, str) and Token.objects.filter(key=key, user__is_active=True).exists()
            if not browser_ok and not token_ok:
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
