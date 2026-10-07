import csv
import math
from datetime import timedelta

from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import MEASUREMENT_FIELDS, NODE_IDS, Reading
from .permissions import IngestPermission
from .serializers import ReadingSerializer
from .services import save_payload

RANGES = {
    "10min": timedelta(minutes=10), "30min": timedelta(minutes=30),
    "1h": timedelta(hours=1), "6h": timedelta(hours=6), "12h": timedelta(hours=12),
    "24h": timedelta(days=1), "7d": timedelta(days=7), "30d": timedelta(days=30),
}


def filtered_readings(request):
    query = Reading.objects.all()
    node_id = request.query_params.get("node_id")
    if node_id == "solenoid_valves":
        return query.none()
    if node_id:
        if node_id not in NODE_IDS:
            from rest_framework.exceptions import NotFound
            raise NotFound(f"Unknown node_id: {node_id}")
        query = query.filter(node_id=node_id)
    period = request.query_params.get("range")
    if period:
        if period not in RANGES:
            raise serializers.ValidationError({"range": "Unknown date range."})
        now = timezone.now()
        return query.filter(timestamp__gte=now - RANGES[period], timestamp__lte=now)
    dates = {}
    for name in ("start", "end"):
        raw = request.query_params.get(name)
        if raw:
            try:
                value = parse_datetime(raw)
            except ValueError:
                value = None
            if value is None:
                raise serializers.ValidationError({name: "Use an ISO 8601 datetime."})
            dates[name] = timezone.make_aware(value) if timezone.is_naive(value) else value
    if len(dates) == 2 and dates["start"] > dates["end"]:
        raise serializers.ValidationError({"end": "Must be on or after start."})
    if "start" in dates:
        query = query.filter(timestamp__gte=dates["start"])
    if "end" in dates:
        query = query.filter(timestamp__lte=dates["end"])
    return query


def integer_param(request, name, default, maximum=None):
    try:
        value = int(request.query_params.get(name, default))
    except (ValueError, TypeError):
        raise serializers.ValidationError({name: "Expected an integer."})
    if value < 1 or (maximum and value > maximum):
        raise serializers.ValidationError({name: f"Must be between 1 and {maximum or 'the requested page'}."})
    return value


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def index(request):
    return Response({"status": "ok", "message": "ZCharMC Django Monitoring API is running."})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return Response({"status": "unavailable", "database": "unavailable"}, status=503)
    return Response({"status": "ok", "database": "ok", "message": "CO2 Monitor API is running"})


@api_view(["GET"])
def nodes(request):
    return Response([{"node_id": n, "table": "monitoring_reading"} for n in NODE_IDS])


@api_view(["GET"])
def latest(request):
    rows = [Reading.objects.filter(node_id=n).first() for n in NODE_IDS]
    return Response(ReadingSerializer([r for r in rows if r], many=True).data)


@api_view(["GET"])
def history(request, node_id=None):
    query = filtered_readings(request)
    if node_id == "solenoid_valves":
        return Response([])
    if node_id:
        if node_id not in NODE_IDS:
            from rest_framework.exceptions import NotFound
            raise NotFound(f"Unknown node_id: {node_id}")
        query = query.filter(node_id=node_id)
    return Response(ReadingSerializer(query[:100], many=True).data)


@api_view(["GET"])
def readings(request):
    page = integer_param(request, "page", 1)
    per_page = integer_param(request, "per_page", 50, 500)
    query = filtered_readings(request)
    total = query.count()
    offset = (page - 1) * per_page
    return Response({
        "data": ReadingSerializer(query[offset:offset + per_page], many=True).data,
        "pagination": {"page": page, "per_page": per_page, "total": total,
                       "total_pages": max(1, math.ceil(total / per_page))},
    })


@api_view(["GET"])
def stats(request):
    aggregates = {"total_records": Count("id")}
    for field in MEASUREMENT_FIELDS:
        label = "temp" if field == "temperature" else field
        for prefix, function in (("min", Min), ("max", Max), ("avg", Avg)):
            aggregates[f"{prefix}_{label}"] = function(field)
    return Response(filtered_readings(request).aggregate(**aggregates))


def threshold_params(request):
    defaults = {"co2_warn": 3000, "co2_danger": 5000, "ph_min": 5.5,
                "ph_max": 8.5, "level_min": 20, "level_max": 90}
    for name, default in defaults.items():
        try:
            value = float(request.query_params.get(name, default))
        except (ValueError, TypeError):
            raise serializers.ValidationError({name: "Expected a finite number."})
        if not math.isfinite(value):
            raise serializers.ValidationError({name: "Expected a finite number."})
        defaults[name] = value
    for low, high in (("co2_warn", "co2_danger"), ("ph_min", "ph_max"), ("level_min", "level_max")):
        if defaults[low] > defaults[high]:
            raise serializers.ValidationError({high: f"Must be at least {low}."})
    return defaults


@api_view(["GET"])
def alerts(request):
    t = threshold_params(request)
    query = filtered_readings(request).filter(
        Q(co2__gte=t["co2_warn"]) | Q(ph__lt=t["ph_min"]) | Q(ph__gt=t["ph_max"])
        | Q(level__lt=t["level_min"]) | Q(level__gt=t["level_max"])
    )[:100]
    results = []
    for row in query:
        data = dict(ReadingSerializer(row).data)
        if row.co2 is not None and row.co2 >= t["co2_danger"]:
            severity, reason = "danger", f'CO2 >= {t["co2_danger"]:g} ppm'
        elif row.co2 is not None and row.co2 >= t["co2_warn"]:
            severity, reason = "warning", f'CO2 >= {t["co2_warn"]:g} ppm'
        elif row.ph is not None and not t["ph_min"] <= row.ph <= t["ph_max"]:
            severity, reason = "warning", f"pH {row.ph:g} out of bounds"
        else:
            severity, reason = "warning", f"Level {row.level:g}% out of bounds"
        data.update(alert_type=severity, threshold=reason)
        results.append(data)
    return Response(results)


class CSVBuffer:
    def write(self, value):
        return value


@api_view(["GET"])
def export_csv(request):
    query = filtered_readings(request)
    columns = ["id", "node_id", *MEASUREMENT_FIELDS, "timestamp"]
    writer = csv.writer(CSVBuffer())

    def rows():
        yield writer.writerow(columns)
        for row in query.values_list(*columns).iterator(chunk_size=1000):
            yield writer.writerow([v.isoformat() if hasattr(v, "isoformat") else v for v in row])

    response = StreamingHttpResponse(rows(), content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="readings.csv"'
    response["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


@api_view(["POST"])
@authentication_classes([])
@permission_classes([IngestPermission])
def ingest(request):
    if not isinstance(request.data, dict):
        raise serializers.ValidationError("Expected a JSON object.")
    event, created = save_payload(request.data)
    return Response({"data": event, "created": created}, status=201 if created else 200)
