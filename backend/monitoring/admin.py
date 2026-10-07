from django.contrib import admin
from django.db import transaction

from .models import Device, FirmwareApproval, FirmwareRelease, IngestionStatus, Reading, ValveSnapshot


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


@admin.register(FirmwareRelease)
class FirmwareReleaseAdmin(admin.ModelAdmin):
    list_display = ["version", "profile", "hardware", "enabled", "created_at"]
    list_filter = ["profile", "enabled"]

    def get_readonly_fields(self, request, obj=None):
        return ["version", "profile", "hardware", "manifest", "signature", "base_url", "created_at"] if obj else ["created_at"]

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    actions = ["reapprove"]

    @admin.action(description="Approve another attempt for selected devices")
    @transaction.atomic
    def reapprove(self, request, queryset):
        for device in queryset.select_for_update():
            if not device.desired_release_id:
                continue
            device.full_clean()
            device.approval_generation += 1
            device.save(update_fields=["approval_generation"])
            FirmwareApproval.objects.create(device=device, release=device.desired_release,
                generation=device.approval_generation, approved_by=request.user)

    list_display = ["device_id", "profile", "reported_version", "desired_release", "reported_status", "maintenance", "last_seen"]
    readonly_fields = ["device_id", "profile", "hardware", "credential_hash", "approval_generation", "reported_version", "reported_status", "maintenance", "last_seen"]

    def has_add_permission(self, request):
        return False

    @transaction.atomic
    def save_model(self, request, obj, form, change):
        original = Device.objects.select_for_update().get(pk=obj.pk)
        obj.approval_generation = original.approval_generation
        if original.desired_release_id != obj.desired_release_id:
            obj.approval_generation = original.approval_generation + 1
            FirmwareApproval.objects.create(device=obj, release=obj.desired_release,
                generation=obj.approval_generation, approved_by=request.user)
        # Do not overwrite a status report received while the admin form was open.
        obj.save(update_fields=["desired_release", "enabled", "approval_generation"])

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(FirmwareApproval)
class FirmwareApprovalAdmin(admin.ModelAdmin):
    list_display = ["device", "release", "generation", "approved_by", "created_at"]
    readonly_fields = [f.name for f in FirmwareApproval._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
