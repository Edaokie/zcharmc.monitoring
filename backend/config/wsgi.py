import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.wsgi import get_wsgi_application

django_application = get_wsgi_application()

import socketio
from monitoring.realtime import sio

# Preserve the existing socket.io-client dashboard without eventlet or Redis.
application = socketio.WSGIApp(sio, django_application)
