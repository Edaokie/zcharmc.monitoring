import math

from rest_framework import serializers

from .models import MEASUREMENT_FIELDS, NODE_IDS, Reading


class ReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reading
        fields = ["id", "node_id", "message_id", *MEASUREMENT_FIELDS, "timestamp", "received_at"]


class FiniteFloatField(serializers.FloatField):
    def to_internal_value(self, data):
        if isinstance(data, bool):
            raise serializers.ValidationError("Expected a finite number.")
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            raise serializers.ValidationError("Expected a finite number.")
        return value


class SensorPayloadSerializer(serializers.Serializer):
    node_id = serializers.ChoiceField(choices=NODE_IDS)
    message_id = serializers.CharField(max_length=128, required=False)
    timestamp = serializers.DateTimeField(required=False)

    def get_fields(self):
        fields = super().get_fields()
        fields.update({name: FiniteFloatField(required=False, allow_null=True)
                       for name in MEASUREMENT_FIELDS})
        return fields


class ValveSerializer(serializers.Serializer):
    id = serializers.ChoiceField(choices=[f"sv{i}" for i in range(1, 7)])
    label = serializers.CharField(max_length=80)
    open = serializers.BooleanField()


class ValvePayloadSerializer(serializers.Serializer):
    node_id = serializers.ChoiceField(choices=["solenoid_valves"])
    valves = ValveSerializer(many=True, allow_empty=False, max_length=6)

    def validate_valves(self, valves):
        if len({v["id"] for v in valves}) != len(valves):
            raise serializers.ValidationError("Duplicate valve IDs.")
        return valves
