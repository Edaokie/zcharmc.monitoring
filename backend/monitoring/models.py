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
