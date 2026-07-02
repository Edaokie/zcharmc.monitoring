import os
import json
import sqlite3
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify
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
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
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
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_start()
    print('[MQTT] Client started')

# ─────────────────────────────────────────
# REST API Endpoints
# ─────────────────────────────────────────
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
