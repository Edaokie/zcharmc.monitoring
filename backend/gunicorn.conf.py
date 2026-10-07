import os

bind = f"0.0.0.0:{os.getenv('PORT', '5001')}"
# Socket.IO state is process-local. More workers require an external message manager.
workers = 1
worker_class = "gthread"
threads = 8
timeout = 60
accesslog = "-"
errorlog = "-"
