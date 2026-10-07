import csv
import math
from datetime import timedelta

from django.db import connection
from django.db.models import Avg, Count, Max, Min, Q
from django.db.models.functions import TruncHour, TruncMinute, TruncSecond
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response

from .models import MEASUREMENT_FIELDS, NODE_IDS, Reading
from .permissions import IngestPermission
from .serializers import ReadingSerializer
from .services import save_payload

RANGES = {
    "1m": timedelta(minutes=1), "10min": timedelta(minutes=10), "30min": timedelta(minutes=30),
    "1h": timedelta(hours=1), "6h": timedelta(hours=6), "12h": timedelta(hours=12),
    "24h": timedelta(days=1), "7d": timedelta(days=7), "30d": timedelta(days=30),
}


def filtered_readings(request, now=None):
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
        now = now or timezone.now()
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
def series(request):
    """Bound chart responses while covering the complete selected time window."""
    period = request.query_params.get("range")
    if period not in RANGES:
        raise serializers.ValidationError({"range": "A supported date range is required."})
    now = timezone.now()
    cutoff = now - RANGES[period]
    truncate = TruncSecond if period == "1m" else TruncHour if period in ("7d", "30d") else TruncMinute
    interval = timedelta(seconds=1) if truncate == TruncSecond else timedelta(hours=1) if truncate == TruncHour else timedelta(minutes=1)
    query = filtered_readings(request, now=now).order_by().annotate(bucket=truncate("timestamp"))
    rows = query.values("node_id", "bucket").annotate(
        count=Count("id"), **{field: Avg(field) for field in MEASUREMENT_FIELDS},
    )
    buckets = {(row["node_id"], row["bucket"]): row for row in rows}
    node_id = request.query_params.get("node_id")
    nodes = [node_id] if node_id else NODE_IDS
    if node_id == "solenoid_valves":
        return Response([])
    bucket = cutoff.replace(microsecond=0)
    if truncate != TruncSecond:
        bucket = bucket.replace(second=0)
    if truncate == TruncHour:
        bucket = bucket.replace(minute=0)
    results = []
    while bucket <= now:
        for node in nodes:
            row = buckets.get((node, bucket))
            # Explicit empty buckets break the line through telemetry outages.
            results.append({
                "node_id": node, "timestamp": max(bucket, cutoff).isoformat(),
                "count": row["count"] if row else 0,
                **{field: row[field] if row else None for field in MEASUREMENT_FIELDS},
            })
        bucket += interval
    return Response(results)


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
        breaches = []
        if row.co2 is not None and row.co2 >= t["co2_warn"]:
            danger = row.co2 >= t["co2_danger"]
            limit = t["co2_danger"] if danger else t["co2_warn"]
            breaches.append(("co2", "CO₂", row.co2, "ppm", "danger" if danger else "warning",
                             f"CO2 >= {limit:g} ppm"))
        if row.ph is not None and not t["ph_min"] <= row.ph <= t["ph_max"]:
            breaches.append(("ph", "pH", row.ph, "", "warning",
                             f'pH outside {t["ph_min"]:g}–{t["ph_max"]:g}'))
        if row.level is not None and not t["level_min"] <= row.level <= t["level_max"]:
            breaches.append(("level", "Level", row.level, "%", "warning",
                             f'Level outside {t["level_min"]:g}–{t["level_max"]:g}%'))
        for sensor, label, value, unit, severity, reason in breaches:
            results.append({**data, "alert_id": f"{row.id}:{sensor}", "sensor": sensor,
                            "sensor_label": label, "value": value, "unit": unit,
                            "alert_type": severity, "threshold": reason, "status": "recorded"})
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


@api_view(["GET"])
@permission_classes([IsAdminUser])
def operations(request):
    """Staff-only diagnostics, regardless of the public dashboard read setting."""
    from .contract import MAX_FUTURE_SECONDS, SENSOR_CONTRACT
    from .models import IngestionStatus
    from .operations import NODES
    now = timezone.now()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        counters = {row["node_id"]: row for row in IngestionStatus.objects.values()}
        results = []
        for node in NODES:
            row = counters.get(node, {
                **{field.name: field.get_default() for field in IngestionStatus._meta.fields if field.name not in ("id", "node_id")},
                "node_id": node,
            })
            row.pop("id", None)
            received = row.get("last_received_at")
            latest = Reading.objects.filter(node_id=node).first() if node in NODE_IDS else None
            age = (now - received).total_seconds() if received else None
            results.append({**row, "upload_age_seconds": age,
                            "upload_status": "never_seen" if age is None else "recent" if age < 60 else "stale",
                            "latest_measurement_at": latest.timestamp if latest else None})
        return Response({"database": "ok", "server_time": now, "nodes": results,
                         "max_future_seconds": MAX_FUTURE_SECONDS, "sensor_contract": SENSOR_CONTRACT})
    except Exception:
        return Response({"database": "unavailable", "server_time": now}, status=503)
