import eventlet
eventlet.monkey_patch()

import os
import io
import csv
import json
import sqlite3
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from flask_socketio import SocketIO
import paho.mqtt.client as mqtt

# ─────────────────────────────────────────
# Load environment variables
# ─────────────────────────────────────────
load_dotenv()

# ─────────────────────────────────────────
# Flask + SocketIO setup
# ─────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'secret')
CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# ─────────────────────────────────────────
# Config
# ─────────────────────────────────────────
MQTT_BROKER = os.getenv('MQTT_BROKER', '10.10.79.142')
MQTT_PORT   = int(os.getenv('MQTT_PORT', 1883))
MQTT_TOPIC  = os.getenv('MQTT_TOPIC', 'co2monitor/#')
DB_PATH     = os.path.join('instance', 'co2.db')

# ─────────────────────────────────────────
# Database
# ─────────────────────────────────────────
def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.execute('''
        CREATE TABLE IF NOT EXISTS readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id     TEXT    NOT NULL,
            co2         REAL    NOT NULL,
            temperature REAL,
            humidity    REAL,
            timestamp   TEXT    NOT NULL
        )
    ''')
    db.commit()
    db.close()
    print('[DB] Database initialized')

def save_reading(node_id, co2, temperature, humidity):
    db = get_db()
    db.execute(
        'INSERT INTO readings (node_id, co2, temperature, humidity, timestamp) VALUES (?, ?, ?, ?, ?)',
        (node_id, co2, temperature, humidity, datetime.now().isoformat())
    )
    db.commit()
    db.close()

# ─────────────────────────────────────────
# MQTT Callbacks (VERSION2 signature)
# ─────────────────────────────────────────
def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f'[MQTT] Connected to broker {MQTT_BROKER}')
        client.subscribe(MQTT_TOPIC)
        print(f'[MQTT] Subscribed to {MQTT_TOPIC}')
    else:
        print(f'[MQTT] Connection failed with code {reason_code}')

def on_message(client, userdata, msg):
    try:
        raw = msg.payload.decode('utf-8').strip()
        if not raw or not raw.startswith('{'):
            print(f'[MQTT] Skipping non-JSON on {msg.topic}: {raw}')
            return
        payload = json.loads(raw)

        print(f'[MQTT] Received on {msg.topic}: {payload}')

        node_id     = payload.get('node_id', 'unknown')
        co2         = payload.get('co2', 0)
        temperature = payload.get('temperature', 0)
        humidity    = payload.get('humidity', 0)

        # save to database
        save_reading(node_id, co2, temperature, humidity)

        # push live update to dashboard via WebSocket
        socketio.emit('co2_update', {
            'node_id':     node_id,
            'co2':         co2,
            'temperature': temperature,
            'humidity':    humidity,
            'timestamp':   datetime.now().isoformat()
        })

        print(f'[WS] Emitted co2_update for {node_id}')

    except Exception as e:
        print(f'[MQTT] Error processing message: {e}')

# ─────────────────────────────────────────
# MQTT Client
# ─────────────────────────────────────────
def start_mqtt():
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_connect = on_connect
        client.on_message = on_message
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_start()
        print('[MQTT] Client started')
    except Exception as e:
        print(f'[MQTT] ⚠️  Could not connect to broker {MQTT_BROKER}:{MQTT_PORT} — {e}')
        print('[MQTT] The API will still work, but no live sensor data will be received.')
        print('[MQTT] Start the Mosquitto broker and restart this server to enable MQTT.')

# ─────────────────────────────────────────
# Helper: parse date range from query params
# ─────────────────────────────────────────
def parse_date_range():
    """
    Parse date range from query params.
    Supports:
      ?range=10min | 30min | 1h | 6h | 12h | 24h | 7d | 30d
      ?start=2026-07-01T00:00:00&end=2026-07-07T23:59:59  (custom)
    Returns (start_iso, end_iso) or (None, None) for no filter.
    """
    range_param = request.args.get('range')
    start_param = request.args.get('start')
    end_param   = request.args.get('end')

    now = datetime.now()

    if range_param:
        ranges = {
            '10min': timedelta(minutes=10),
            '30min': timedelta(minutes=30),
            '1h':    timedelta(hours=1),
            '6h':    timedelta(hours=6),
            '12h':   timedelta(hours=12),
            '24h':   timedelta(hours=24),
            '7d':    timedelta(days=7),
            '30d':   timedelta(days=30),
        }
        delta = ranges.get(range_param)
        if delta:
            return (now - delta).isoformat(), now.isoformat()

    if start_param and end_param:
        return start_param, end_param

    return None, None

# ─────────────────────────────────────────
# REST API Endpoints
# ─────────────────────────────────────────
@app.route('/')
def index():
    return jsonify({
        'status': 'ok',
        'message': 'ZCharMC Monitoring Backend API is running.',
        'endpoints': {
            'health': '/api/health',
            'latest': '/api/latest',
            'history': '/api/history',
            'readings': '/api/readings',
            'stats': '/api/stats',
            'alerts': '/api/alerts'
        }
    })

@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'message': 'CO2 Monitor API is running'
    })

@app.route('/api/latest')
def latest():
    db = get_db()
    rows = db.execute('''
        SELECT * FROM readings
        WHERE id IN (
            SELECT MAX(id) FROM readings GROUP BY node_id
        )
        ORDER BY node_id
    ''').fetchall()
    db.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/history')
def history():
    db = get_db()
    rows = db.execute('''
        SELECT * FROM readings
        ORDER BY id DESC
        LIMIT 100
    ''').fetchall()
    db.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/history/<node_id>')
def history_by_node(node_id):
    db = get_db()
    rows = db.execute('''
        SELECT * FROM readings
        WHERE node_id = ?
        ORDER BY id DESC
        LIMIT 100
    ''', (node_id,)).fetchall()
    db.close()
    return jsonify([dict(row) for row in rows])

# ─────────────────────────────────────────
# NEW: Paginated, filtered readings
# ─────────────────────────────────────────
@app.route('/api/readings')
def readings():
    """
    Get filtered, paginated readings.
    Query params:
      - node_id:  filter by node (optional)
      - range:    10min | 30min | 1h | 6h | 12h | 24h | 7d | 30d
      - start/end: custom date range (ISO format)
      - page:     page number (default 1)
      - per_page: items per page (default 50, max 500)
    """
    node_id  = request.args.get('node_id')
    page     = max(1, int(request.args.get('page', 1)))
    per_page = min(500, max(1, int(request.args.get('per_page', 50))))
    offset   = (page - 1) * per_page

    start_dt, end_dt = parse_date_range()

    conditions = []
    params = []

    if node_id:
        conditions.append('node_id = ?')
        params.append(node_id)
    if start_dt:
        conditions.append('timestamp >= ?')
        params.append(start_dt)
    if end_dt:
        conditions.append('timestamp <= ?')
        params.append(end_dt)

    where = 'WHERE ' + ' AND '.join(conditions) if conditions else ''

    db = get_db()

    # Get total count for pagination metadata
    count_row = db.execute(f'SELECT COUNT(*) as total FROM readings {where}', params).fetchone()
    total = count_row['total']

    # Get paginated rows
    rows = db.execute(
        f'SELECT * FROM readings {where} ORDER BY id DESC LIMIT ? OFFSET ?',
        params + [per_page, offset]
    ).fetchall()
    db.close()

    return jsonify({
        'data': [dict(row) for row in rows],
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'total_pages': max(1, -(-total // per_page)),  # ceiling division
        }
    })

# ─────────────────────────────────────────
# NEW: Summary statistics
# ─────────────────────────────────────────
@app.route('/api/stats')
def stats():
    """
    Get aggregate statistics.
    Query params: same filters as /api/readings (node_id, range, start/end)
    """
    node_id = request.args.get('node_id')
    start_dt, end_dt = parse_date_range()

    conditions = []
    params = []

    if node_id:
        conditions.append('node_id = ?')
        params.append(node_id)
    if start_dt:
        conditions.append('timestamp >= ?')
        params.append(start_dt)
    if end_dt:
        conditions.append('timestamp <= ?')
        params.append(end_dt)

    where = 'WHERE ' + ' AND '.join(conditions) if conditions else ''

    db = get_db()
    row = db.execute(f'''
        SELECT
            COUNT(*)       as total_records,
            MIN(co2)       as min_co2,
            MAX(co2)       as max_co2,
            AVG(co2)       as avg_co2,
            MIN(temperature) as min_temp,
            MAX(temperature) as max_temp,
            AVG(temperature) as avg_temp,
            MIN(humidity)  as min_humidity,
            MAX(humidity)  as max_humidity,
            AVG(humidity)  as avg_humidity
        FROM readings {where}
    ''', params).fetchone()
    db.close()

    return jsonify(dict(row) if row else {})

# ─────────────────────────────────────────
# NEW: CSV Export
# ─────────────────────────────────────────
@app.route('/api/export/csv')
def export_csv():
    """
    Download readings as CSV.
    Query params: same filters as /api/readings (node_id, range, start/end)
    """
    node_id = request.args.get('node_id')
    start_dt, end_dt = parse_date_range()

    conditions = []
    params = []

    if node_id:
        conditions.append('node_id = ?')
        params.append(node_id)
    if start_dt:
        conditions.append('timestamp >= ?')
        params.append(start_dt)
    if end_dt:
        conditions.append('timestamp <= ?')
        params.append(end_dt)

    where = 'WHERE ' + ' AND '.join(conditions) if conditions else ''

    db = get_db()
    rows = db.execute(
        f'SELECT id, node_id, co2, temperature, humidity, timestamp FROM readings {where} ORDER BY id DESC',
        params
    ).fetchall()
    db.close()

    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['id', 'node_id', 'co2', 'temperature', 'humidity', 'timestamp'])
    for row in rows:
        writer.writerow([row['id'], row['node_id'], row['co2'], row['temperature'], row['humidity'], row['timestamp']])

    # Generate filename with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    node_suffix = f'_{node_id}' if node_id else '_all'
    range_suffix = f'_{request.args.get("range", "custom")}' if (start_dt or request.args.get('range')) else ''
    filename = f'co2_readings{node_suffix}{range_suffix}_{timestamp}.csv'

    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Access-Control-Expose-Headers': 'Content-Disposition'
        }
    )

# ─────────────────────────────────────────
# NEW: Alerts (threshold-based from readings)
# ─────────────────────────────────────────
@app.route('/api/alerts')
def alerts():
    """
    Get readings that exceeded thresholds.
    Query params: same filters as /api/readings
    """
    co2_warn   = float(request.args.get('co2_warn', 3000))
    co2_danger = float(request.args.get('co2_danger', 5000))
    start_dt, end_dt = parse_date_range()

    conditions = [f'co2 >= ?']
    params = [co2_warn]

    if start_dt:
        conditions.append('timestamp >= ?')
        params.append(start_dt)
    if end_dt:
        conditions.append('timestamp <= ?')
        params.append(end_dt)

    where = 'WHERE ' + ' AND '.join(conditions)

    db = get_db()
    rows = db.execute(
        f'SELECT * FROM readings {where} ORDER BY id DESC LIMIT 100',
        params
    ).fetchall()
    db.close()

    result = []
    for row in rows:
        r = dict(row)
        r['alert_type'] = 'danger' if r['co2'] >= co2_danger else 'warning'
        r['threshold'] = f'> {int(co2_danger)} ppm' if r['co2'] >= co2_danger else f'> {int(co2_warn)} ppm'
        result.append(r)

    return jsonify(result)

# ─────────────────────────────────────────
# WebSocket Events
# ─────────────────────────────────────────
@socketio.on('connect')
def on_ws_connect():
    print('[WS] Dashboard client connected')

@socketio.on('disconnect')
def on_ws_disconnect():
    print('[WS] Dashboard client disconnected')

# ─────────────────────────────────────────
# Main
# ─────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'True':
        start_mqtt()
    print('[Flask] Starting server on port 5001...')
    socketio.run(app, host='0.0.0.0', port=5001, debug=False)