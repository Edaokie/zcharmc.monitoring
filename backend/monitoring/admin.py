from django.contrib import admin

from .models import IngestionStatus, Reading, ValveSnapshot


@admin.register(Reading)
class ReadingAdmin(admin.ModelAdmin):
    list_display = ["id", "node_id", "co2", "timestamp", "received_at"]
    list_filter = ["node_id"]
    date_hierarchy = "timestamp"
    readonly_fields = [f.name for f in Reading._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(ValveSnapshot)
class ValveSnapshotAdmin(admin.ModelAdmin):
    list_display = ["node_id", "timestamp"]
    readonly_fields = ["node_id", "valves", "timestamp"]

    def has_add_permission(self, request):
        return False


@admin.register(IngestionStatus)
class IngestionStatusAdmin(admin.ModelAdmin):
    list_display = ["node_id", "accepted", "duplicates", "conflicts", "invalid",
                    "unauthorized", "server_errors", "last_received_at", "last_outcome"]
    readonly_fields = [f.name for f in IngestionStatus._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
