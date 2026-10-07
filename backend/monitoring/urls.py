from django.urls import path
from rest_framework.authtoken.views import obtain_auth_token

from . import views

urlpatterns = [
    path("", views.index),
    path("api/health", views.health),
    path("api/nodes", views.nodes),
    path("api/latest", views.latest),
    path("api/history", views.history),
    path("api/history/<str:node_id>", views.history),
    path("api/readings", views.readings),
    path("api/stats", views.stats),
    path("api/alerts", views.alerts),
    path("api/export/csv", views.export_csv),
    path("api/ingest", views.ingest),
    path("api/auth/token", obtain_auth_token),
]
