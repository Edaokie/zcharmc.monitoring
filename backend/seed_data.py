"""
Seed the SQLite database with fake sensor data so the frontend
can be tested without the ESP32 firmware running.

Run:  python seed_data.py
"""
import sqlite3
import random
from datetime import datetime, timedelta

DB_PATH = 'instance/co2.db'

# Ensure instance dir exists
import os
os.makedirs('instance', exist_ok=True)

db = sqlite3.connect(DB_PATH)
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

# Generate 24 hours of data, one reading every 30 seconds per node
now = datetime.now()
nodes = ['inlet', 'outlet', 'solenoid_valves']
records = []

print('[Seed] Generating 24 hours of test data for 3 nodes...')

for minutes_ago in range(0, 24 * 60, 1):  # every minute for 24 hours
    t = now - timedelta(minutes=minutes_ago)
    timestamp = t.isoformat()

    for node in nodes:
        if node == 'inlet':
            co2 = 3500 + random.uniform(-800, 1200) + 500 * (1 + 0.5 * random.random()) * (0.5 + 0.5 * abs((minutes_ago % 120 - 60) / 60))
            temp = 28 + random.uniform(-2, 3)
            humidity = 62 + random.uniform(-8, 8)
        elif node == 'outlet':
            co2 = 1800 + random.uniform(-400, 600) + 300 * (0.5 + 0.5 * abs((minutes_ago % 120 - 60) / 60))
            temp = 26 + random.uniform(-2, 2.5)
            humidity = 58 + random.uniform(-7, 7)
        else:  # solenoid_valves
            co2 = 400 + random.uniform(-50, 100)  # ambient levels
            temp = 27 + random.uniform(-1.5, 1.5)
            humidity = 60 + random.uniform(-5, 5)

        records.append((node, round(co2, 1), round(temp, 1), round(humidity, 1), timestamp))

db.executemany(
    'INSERT INTO readings (node_id, co2, temperature, humidity, timestamp) VALUES (?, ?, ?, ?, ?)',
    records
)
db.commit()
db.close()

print(f'[Seed] Inserted {len(records)} records ({len(records) // 3} per node)')
print(f'[Seed] Database: {os.path.abspath(DB_PATH)}')
print('[Seed] Done! You can now start the backend with: python app.py')
