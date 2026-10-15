from django.urls import path
from rest_framework.authtoken.views import obtain_auth_token

from . import views, ota, release_registration, browser_auth, fleet, device_telemetry

urlpatterns = [
    path('api/auth/session', browser_auth.session),
    path('api/auth/login', browser_auth.sign_in),
    path('api/auth/logout', browser_auth.sign_out),
    path('api/auth/socket-ticket', browser_auth.socket_ticket),
    path('api/firmware/devices', fleet.devices),
    path('api/firmware/releases', fleet.releases),
    path('api/firmware/releases/<int:release_id>', fleet.enable_release),
    path('api/firmware/devices/<slug:device_id>/target', fleet.set_target),
    path('api/firmware/devices/<slug:device_id>/retry', fleet.set_target, {'retry': True}),
    path('api/firmware/devices/<slug:device_id>/history', fleet.history),
    path("api/firmware/releases/register", release_registration.register),
    path("api/devices/<slug:device_id>/telemetry", device_telemetry.ingest),
    path("api/devices/<slug:device_id>/ota", ota.target),
    path("api/devices/<slug:device_id>/report", ota.report),
    path("", views.index),
    path("api/health", views.health),
    path("api/operations", views.operations),
    path("api/nodes", views.nodes),
    path("api/latest", views.latest),
    path("api/history", views.history),
    path("api/history/<str:node_id>", views.history),
    path("api/readings", views.readings),
    path("api/series", views.series),
    path("api/stats", views.stats),
    path("api/alerts", views.alerts),
    path("api/export/csv", views.export_csv),
    path("api/ingest", views.ingest),
    path("api/auth/token", obtain_auth_token),
]
