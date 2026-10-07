from django.contrib import admin

from .models import Reading, ValveSnapshot


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
