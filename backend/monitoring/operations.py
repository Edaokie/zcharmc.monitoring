"""Durable per-node counters plus secret-free structured failure logs."""
import json
import logging

from django.db.models import F
from django.utils import timezone
from rest_framework.views import exception_handler as drf_exception_handler

from .models import IngestionStatus, NODE_IDS

logger = logging.getLogger(__name__)
NODES = (*NODE_IDS, "solenoid_valves", "unknown")


def record_outcome(node, outcome):
    node = node if node in NODES else "unknown"
    IngestionStatus.objects.get_or_create(node_id=node)
    now = timezone.now()
    updates = {outcome: F(outcome) + 1, "last_outcome": outcome}
    if outcome in ("accepted", "duplicates"):
        updates["last_received_at"] = now
        if outcome == "accepted":
            updates["last_accepted_at"] = now
    else:
        updates["last_failure_at"] = now
    IngestionStatus.objects.filter(node_id=node).update(**updates)


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    request = context.get("request")
    if request and request.path.rstrip("/") == "/api/ingest":
        status = response.status_code if response else 500
        outcome = "unauthorized" if status in (401, 403) else "conflicts" if status == 409 else "invalid" if status < 500 else "server_errors"
        # Accessing .data can itself raise ParseError; never mask the original error.
        node = "unknown"
        if outcome != "unauthorized":
            try:
                data = request.data
                node = data.get("node_id", "unknown") if isinstance(data, dict) else "unknown"
                node = node if node in NODES else "unknown"
            except Exception:
                pass
        logger.warning(json.dumps({"event": "ingestion_failure", "node_id": node,
                                   "outcome": outcome, "http_status": status}))
        try:
            record_outcome(node, outcome)
        except Exception:
            # Database outages cannot be counted in that same database. Logs survive.
            logger.exception("Ingestion counter unavailable")
    return response
