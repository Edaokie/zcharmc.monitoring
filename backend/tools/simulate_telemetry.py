"""Isolated PostgreSQL + real HTTP/Socket.IO reliability simulation.

Never connects to Railway/Vercel. Starts a loopback-only backend and disposable
PostgreSQL. Requires requirements-simulation.txt and Node 24 for dashboard probes.
Default duration is three hours. --duration-seconds 45 --interval-seconds 1 gives
a short smoke run (not a soak test). Reports are atomically updated throughout.
"""
import argparse
import csv
import io
import json
import math
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone as utc
from pathlib import Path

import fasteners
import pgserver
import requests
import socketio

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("co2", "temperature", "humidity", "ph", "pm25", "flow_rate", "level",
          "weight", "no2", "so2", "pressure1", "pressure2")


def require(value, message):
    if not value:
        raise AssertionError(message)


def iso(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration-seconds", type=float, default=10800)
    parser.add_argument("--interval-seconds", type=float, default=15)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--port", type=int, default=0, help="Optional local port for browser inspection")
    args = parser.parse_args()
    if args.duration_seconds < 1 or args.interval_seconds < .1 or not args.node:
        parser.error("Use positive duration/interval and provide Node 24 with --node")
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / "report.json"
    report = {"status": "starting", "run_id": "SYNTHETIC-SOAK-" + uuid.uuid4().hex[:12],
              "requested_duration_seconds": args.duration_seconds,
              "scope": "isolated local PostgreSQL; no production writes",
              "started_at": datetime.now(utc.utc).isoformat(), "cycles": 0, "created": 0,
              "duplicates": 0, "conflicts": 0, "invalid": 0, "outages": 0,
              "backend_restarts": 0, "reconnects": 0, "delayed": 0, "missing": 0,
              "verification_passes": 0, "browser_verified": False}
    started = time.monotonic()
    def write_report():
        report["elapsed_seconds"] = round(time.monotonic() - started, 2)
        temporary = report_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, indent=2))
        temporary.replace(report_path)
    write_report()
    # Avoid inheriting a real DATABASE_URL/key or .env file into the local service.
    directory = Path(tempfile.mkdtemp(prefix="zc-soak-", dir="/tmp"))
    server = process = client = log = None
    events = []
    inputs = {}
    pending = []
    def stop_signal(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    try:
        pgserver.PostgresServer.runtime_path = directory / "run"
        pgserver.PostgresServer.runtime_path.mkdir()
        pgserver.PostgresServer._lock = fasteners.InterProcessLock(directory / "run" / ".lock")
        server = pgserver.get_server(directory / "db", cleanup_mode="delete")
        if args.port:
            port = args.port
        else:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))
        base = f"http://127.0.0.1:{port}"
        key = secrets.token_urlsafe(32)
        env = {**os.environ, "DATABASE_URL": server.get_uri(), "DJANGO_SECRET_KEY": secrets.token_urlsafe(32),
               "INGEST_API_KEY": key, "ALLOW_PUBLIC_READ": "true", "DJANGO_DEBUG": "false",
               "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost", "DJANGO_SECURE_SSL_REDIRECT": "false",
               "CORS_ALLOWED_ORIGINS": f"{base},http://127.0.0.1:5094,http://localhost:5094",
               "PORT": str(port), "DJANGO_SETTINGS_MODULE": "config.settings"}
        os.environ.update(env)
        sys.path.insert(0, str(ROOT))
        import django
        django.setup()
        from django.contrib.auth import get_user_model
        from django.db import close_old_connections
        from rest_framework.authtoken.models import Token
        from monitoring.models import IngestionStatus, Reading
        from monitoring.serializers import ReadingSerializer
        log = (args.output / "backend.log").open("w")
        subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=ROOT, env=env,
                       stdout=log, stderr=log, check=True)
        staff = get_user_model().objects.create_user(username="local-simulation-operator", is_staff=True)
        token = Token.objects.create(user=staff).key
        headers = {"Authorization": "Bearer " + key}
        report["backend_url"] = base

        def get(path):
            response = requests.get(base + path, timeout=15)
            response.raise_for_status()
            return response

        def connect():
            nonlocal client
            if client and client.connected:
                client.disconnect()
            client = socketio.Client(reconnection=False)
            client.on("co2_update", lambda row: events.append(row))
            client.connect(base, transports=["websocket"])
            report["reconnects"] += 1
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                wanted = {row["id"] for row in get("/api/latest").json()}
                if wanted <= {row["id"] for row in events[-10:]}:
                    return
                time.sleep(.05)
            raise AssertionError("Reconnect snapshot missing")

        def start_backend():
            nonlocal process
            process = subprocess.Popen([sys.executable, "-m", "gunicorn", "config.wsgi:application",
                                        "--config", "gunicorn.conf.py", "--graceful-timeout", "2", "--bind", f"127.0.0.1:{port}"],
                                       cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
            for _ in range(80):
                try:
                    if get("/api/health").json()["database"] == "ok":
                        connect()
                        return
                except requests.RequestException:
                    if process.poll() is not None:
                        raise RuntimeError("Backend exited; see backend.log")
                time.sleep(.1)
            raise RuntimeError("Backend startup timed out")

        def stop_backend():
            if process and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)

        def send(payload, expected=201):
            response = requests.post(base + "/api/ingest", json=payload, headers=headers, timeout=15)
            require(response.status_code == expected, f"Expected {expected}, got {response.status_code}: {response.text}")
            if expected == 201:
                row = response.json()["data"]
                inputs[row["id"]] = {**payload, "id": row["id"]}
                report["created"] += 1
            elif expected == 200:
                report["duplicates"] += 1
            elif expected == 409:
                report["conflicts"] += 1
            elif expected == 400:
                report["invalid"] += 1
            return response

        def verify():
            close_old_connections()
            stored = list(Reading.objects.order_by("id"))
            require(len(stored) == len(inputs), "Database count disagrees with accepted uploads")
            for row in stored:
                payload = inputs[row.id]
                require(row.message_id.startswith(report["run_id"]), "Unexpected non-synthetic row")
                require(row.timestamp == iso(payload["timestamp"]), "Stored timestamp changed")
                for field in FIELDS:
                    require(getattr(row, field) == payload.get(field), f"Stored {field} differs")
            latest = get("/api/latest").json()
            expected_latest = [dict(ReadingSerializer(Reading.objects.filter(node_id=n).first()).data)
                               for n in ("inlet", "outlet") if Reading.objects.filter(node_id=n).exists()]
            require(latest == expected_latest, "Latest disagrees with database ordering")
            for node in ("inlet", "outlet"):
                history = get("/api/history/" + node).json()
                require(history == list(ReadingSerializer(Reading.objects.filter(node_id=node)[:100], many=True).data),
                        "History values/order differ from database")
            exported = list(csv.DictReader(io.StringIO(get("/api/export/csv").text)))
            require({int(row["id"]) for row in exported} == set(inputs), "CSV IDs disagree")
            for row in exported:
                payload = inputs[int(row["id"])]
                require(iso(row["timestamp"]) == iso(payload["timestamp"]), "CSV timestamp changed")
                for field in FIELDS:
                    wanted = payload.get(field)
                    require(row[field] == "" if wanted is None else float(row[field]) == wanted, f"CSV {field} disagrees")
            series = get("/api/series?range=24h").json()
            require(sum(row["count"] for row in series) == len(stored), "Historical chart count disagrees")
            buckets = {}
            for row in stored:
                bucket = row.timestamp.replace(second=0, microsecond=0)
                buckets.setdefault((row.node_id, bucket), []).append(row)
            for row in series:
                group = buckets.get((row["node_id"], iso(row["timestamp"]).replace(second=0, microsecond=0)), [])
                require(row["count"] == len(group), "Historical chart bucket count differs")
                for field in FIELDS:
                    values = [getattr(item, field) for item in group if getattr(item, field) is not None]
                    wanted = sum(values) / len(values) if values else None
                    actual = row[field]
                    require(actual is None if wanted is None else actual is not None and math.isclose(actual, wanted, rel_tol=1e-9, abs_tol=1e-9),
                            f"Historical chart {field} mean differs")
            # Exercise actual dashboard code with delivered events plus fresh reconnect snapshots.
            connect()
            now = datetime.now(utc.utc)
            by_node = {row["node_id"]: row for row in latest}
            incoming, outgoing = by_node.get("inlet"), by_node.get("outlet")
            efficiency = None
            if incoming and outgoing and incoming["co2"] is not None and outgoing["co2"] is not None and incoming["co2"] > 0:
                if all(0 <= (now - iso(row["timestamp"])).total_seconds() < 60 for row in (incoming, outgoing)) and abs((iso(incoming["timestamp"]) - iso(outgoing["timestamp"])).total_seconds()) <= 10:
                    efficiency = (incoming["co2"] - outgoing["co2"]) / incoming["co2"] * 100
            fixture = args.output / "dashboard-fixture.json"
            fixture.write_text(json.dumps({"events": events, "latest": latest, "now": now.timestamp() * 1000,
                                           "expected_efficiency": efficiency}))
            subprocess.run([args.node, "--experimental-strip-types", str(ROOT / "tools/dashboard_probe.mjs"), str(fixture)],
                           check=True, stdout=subprocess.DEVNULL)
            # Bound local memory just as the dashboard does. Latest snapshots retained.
            del events[:-400]
            response = requests.get(base + "/api/operations", headers={"Authorization": "Token " + token}, timeout=15)
            require(response.status_code == 200 and response.json()["database"] == "ok", "Operations unavailable")
            totals = {field: sum(getattr(row, field) for row in IngestionStatus.objects.all())
                      for field in ("accepted", "duplicates", "conflicts", "invalid")}
            require(totals == {"accepted": report["created"], **{name: report[name] for name in ("duplicates", "conflicts", "invalid")}},
                    "Durable operational counters disagree")
            (args.output / "operations.json").write_text(json.dumps(response.json(), indent=2))
            report["verification_passes"] += 1
            report["last_verified_at"] = now.isoformat()
            report["latest"] = [{k: row[k] for k in ("id", "node_id", "co2", "timestamp")} for row in latest]
            write_report()

        start_backend()
        for payload in ({"node_id": "inlet"}, {"node_id": "outlet", "co2": None},
                        {"node_id": "inlet", "co2": 1, "timestamp": (datetime.now(utc.utc) + timedelta(days=1)).isoformat()},
                        {"node_id": "outlet", "humidity": 101}):
            send(payload, 400)
        report["status"] = "running"
        # Duration measures active simulation, excluding migration/startup.
        active_start = time.monotonic()
        last_verified = active_start
        step = 0
        while time.monotonic() - active_start < args.duration_seconds:
            cycle_start = time.monotonic()
            now = datetime.now(utc.utc)
            pair = []
            for node, base_co2 in (("inlet", 1200), ("outlet", 480)):
                payload = {"node_id": node, "message_id": f'{report["run_id"]}:{node}:{step}',
                           "timestamp": now.isoformat(), "co2": base_co2 + step % 17,
                           "temperature": 26, "humidity": 50, "ph": 7, "level": 40,
                           "pressure1": 0, "pressure2": 12.3}
                if step % 3 == 1:
                    payload["co2"] = None
                    payload.pop("temperature")
                    report["missing"] += 1
                pair.append(payload)
            # Backend downtime is a real connection failure; retain unsent payloads.
            if step % 8 == 2:
                client.disconnect()
                stop_backend()
                report["outages"] += 1
                try:
                    requests.post(base + "/api/ingest", json=pair[0], headers=headers, timeout=1)
                except requests.RequestException:
                    pending.extend(pair)
                else:
                    raise AssertionError("Expected stopped backend connection failure")
                time.sleep(min(args.interval_seconds, 2))
                start_backend()
                report["backend_restarts"] += 1
                # Newer samples arrive before queued older uploads.
                fresh = [{**p, "message_id": p["message_id"] + ":after-restart",
                          "timestamp": datetime.now(utc.utc).isoformat()} for p in pair]
                for payload in fresh:
                    send(payload)
                for payload in pending:
                    send(payload)
                pending.clear()
            else:
                for payload in pair:
                    send(payload)
            # Lost acknowledgement: resend the identical committed message.
            send(pair[0], 200)
            # Deliberately conflicting message must not overwrite the stored record.
            if step % 4 == 0:
                send({**pair[0], "pressure1": 1}, 409)
            # A delayed sample must be stored but must not replace latest.
            if step % 4 == 1:
                for payload in pair:
                    send({**payload, "message_id": payload["message_id"] + ":delayed",
                          "timestamp": (now - timedelta(minutes=2)).isoformat()})
                    report["delayed"] += 1
            # Drop just the viewer connection and restore persisted latest state.
            if step % 5 == 3:
                client.disconnect()
                connect()
            step += 1
            report["cycles"] = step
            if step == 4 or time.monotonic() - last_verified >= max(10, args.interval_seconds * 4):
                verify()
                last_verified = time.monotonic()
            write_report()
            remaining = min(args.interval_seconds - (time.monotonic() - cycle_start),
                            args.duration_seconds - (time.monotonic() - active_start))
            if remaining > 0:
                time.sleep(remaining)
        verify()
        report["active_duration_seconds"] = round(time.monotonic() - active_start, 2)
        require(report["outages"] > 0 and report["delayed"] > 0 and report["missing"] > 0 and report["conflicts"] > 0,
                "Run too short to cover all fault scenarios; increase duration")
        report["status"] = "passed"
    except BaseException as error:
        report["status"] = "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
        report["error"] = str(error) or type(error).__name__
        raise
    finally:
        try:
            if client and client.connected:
                client.disconnect()
            if process and process.poll() is None:
                stop_backend()
            if log:
                log.close()
            if server:
                from django.db import connections
                connections.close_all()
                server._cleanup()
        finally:
            report["finished_at"] = datetime.now(utc.utc).isoformat()
            write_report()
            shutil.rmtree(directory, ignore_errors=True)
            print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
