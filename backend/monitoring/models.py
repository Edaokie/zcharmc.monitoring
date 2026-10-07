from django.db import models
from django.utils import timezone

NODE_IDS = ("inlet", "outlet")
MEASUREMENT_FIELDS = (
    "co2", "temperature", "humidity", "ph", "pm25", "flow_rate", "level",
    "weight", "no2", "so2", "pressure1", "pressure2",
)


class Reading(models.Model):
    node_id = models.CharField(max_length=32, choices=[(n, n) for n in NODE_IDS])
    message_id = models.CharField(max_length=128, null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)
    received_at = models.DateTimeField(auto_now_add=True)
    co2 = models.FloatField(null=True, blank=True)
    temperature = models.FloatField(null=True, blank=True)
    humidity = models.FloatField(null=True, blank=True)
    ph = models.FloatField(null=True, blank=True)
    pm25 = models.FloatField(null=True, blank=True)
    flow_rate = models.FloatField(null=True, blank=True)
    level = models.FloatField(null=True, blank=True)
    weight = models.FloatField(null=True, blank=True)
    no2 = models.FloatField(null=True, blank=True)
    so2 = models.FloatField(null=True, blank=True)
    pressure1 = models.FloatField(null=True, blank=True)
    pressure2 = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp", "-id"]
        indexes = [
            models.Index(fields=["node_id", "-timestamp"], name="reading_node_time"),
            models.Index(fields=["-timestamp"], name="reading_time"),
        ]
        constraints = [models.UniqueConstraint(
            fields=["node_id", "message_id"], name="unique_node_message",
        )]


class ValveSnapshot(models.Model):
    node_id = models.CharField(max_length=32, unique=True, default="solenoid_valves")
    valves = models.JSONField(default=list)
    timestamp = models.DateTimeField(default=timezone.now)


class IngestionStatus(models.Model):
    """Bounded aggregate counters; no payloads, keys, IPs, or unbounded event log."""
    node_id = models.CharField(max_length=32, unique=True)
    accepted = models.PositiveBigIntegerField(default=0)
    duplicates = models.PositiveBigIntegerField(default=0)
    conflicts = models.PositiveBigIntegerField(default=0)
    invalid = models.PositiveBigIntegerField(default=0)
    unauthorized = models.PositiveBigIntegerField(default=0)
    server_errors = models.PositiveBigIntegerField(default=0)
    last_received_at = models.DateTimeField(null=True, blank=True)
    last_accepted_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_outcome = models.CharField(max_length=32, blank=True)


class FirmwareRelease(models.Model):
    version = models.CharField(max_length=31)
    profile = models.CharField(max_length=16, choices=[(p, p) for p in ("inlet", "outlet", "control")])
    hardware = models.CharField(max_length=64)
    manifest = models.TextField(help_text="Exact canonical signed JSON; do not reformat.")
    signature = models.TextField(help_text="Base64 RSA-PSS manifest signature.")
    base_url = models.URLField(help_text="HTTPS directory containing image and .bin.sig release assets.")
    enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["version", "profile", "hardware"], name="unique_firmware_release")]

    def __str__(self):
        return f"{self.version} / {self.profile} / {self.hardware}"

    def clean(self):
        from .ota import validate_release
        validate_release(self)


class Device(models.Model):
    device_id = models.SlugField(max_length=64, unique=True)
    profile = models.CharField(max_length=16, choices=[(p, p) for p in ("inlet", "outlet", "control")])
    hardware = models.CharField(max_length=64)
    credential_hash = models.CharField(max_length=64, editable=False)
    enabled = models.BooleanField(default=True)
    desired_release = models.ForeignKey(FirmwareRelease, null=True, blank=True, on_delete=models.PROTECT)
    approval_generation = models.PositiveBigIntegerField(default=0)
    reported_version = models.CharField(max_length=31, blank=True)
    reported_status = models.CharField(max_length=32, blank=True)
    maintenance = models.BooleanField(default=False)
    last_seen = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.device_id

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.desired_release_id:
            release = self.desired_release
            if (release.profile, release.hardware) != (self.profile, self.hardware) or not release.enabled:
                raise ValidationError("Choose an enabled release matching this device's profile and hardware.")


class FirmwareApproval(models.Model):
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    release = models.ForeignKey(FirmwareRelease, null=True, on_delete=models.PROTECT)
    generation = models.PositiveBigIntegerField()
    approved_by = models.ForeignKey("auth.User", null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
