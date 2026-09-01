# 🍓 Raspberry Pi — Backend Setup Guide
> ZCharMC Monitoring System · Flask + MQTT + SQLite

This document covers the full setup of the backend on a Raspberry Pi,
from cloning the repo to running it as a persistent background service.

---

## ✅ Prerequisites

- Raspberry Pi with Raspberry Pi OS (Debian-based)
- Python 3.9+
- Git installed
- Internet access (for initial package installation)
- Mosquitto MQTT broker (installed in this guide)

---

## 1. Clone the Repository

```bash
cd ~
git clone <your-repo-url> zcharmc.monitoring-develop
cd zcharmc.monitoring-develop
```

> Replace `<your-repo-url>` with the actual Git remote URL.

---

## 2. Create a Python Virtual Environment

Run this from the **project root** (not inside `backend/`):

```bash
cd ~/zcharmc.monitoring-develop
python3 -m venv venv
source venv/bin/activate
```

You should see `(venv)` in your terminal prompt.

---

## 3. Install Python Dependencies

```bash
cd ~/zcharmc.monitoring-develop/backend
pip install -r requirements.txt
```

Expected output: all packages successfully installed including Flask, Flask-SocketIO, paho-mqtt, eventlet, etc.

---

## 4. Install & Start Mosquitto (MQTT Broker)

The backend requires an MQTT broker running locally on the Pi.

```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients -y
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
sudo systemctl status mosquitto
```

You should see `Active: active (running)` in the status output.

---

## 5. Configure Environment Variables

The backend reads its configuration from a `.env` file in the `backend/` folder.

```bash
nano ~/zcharmc.monitoring-develop/backend/.env
```

Set the following (adjust values as needed):

```env
FLASK_APP=app.py
FLASK_ENV=production
FLASK_RUN_PORT=5001
MQTT_BROKER=127.0.0.1
MQTT_PORT=1883
MQTT_TOPIC=co2monitor/#
SECRET_KEY=co2monitoringsecretkey
```

> `MQTT_BROKER=127.0.0.1` points to the local Mosquitto broker running on the Pi itself.

Save and exit: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## 6. Run the Backend Manually (Test First)

Before setting up the service, verify it starts correctly:

```bash
cd ~/zcharmc.monitoring-develop/backend
source ../venv/bin/activate
python app.py
```

Expected output:
```
[DB] Database initialized
 * Running on http://0.0.0.0:5001
```

Test the health endpoint from another terminal or device:

```bash
curl http://localhost:5001/api/health
```

You should get a JSON response back. Once confirmed, stop it with `Ctrl+C`.

---

## 7. Set Up as a systemd Service (Auto-start on Boot)

### 7a. Edit the service file to match your username and folder

```bash
nano ~/zcharmc.monitoring-develop/backend/zcharmc-backend.service
```

Update these lines to match your actual username and folder name:

```ini
[Service]
User=edrian
WorkingDirectory=/home/edrian/zcharmc.monitoring-develop/backend
ExecStart=/home/edrian/zcharmc.monitoring-develop/venv/bin/python app.py
```

> **Note:** The `venv/` folder is in the project root (`zcharmc.monitoring-develop/`),
> not inside `backend/`. Make sure `ExecStart` points one level up.

Save and exit: `Ctrl+O` → `Enter` → `Ctrl+X`

### 7b. Copy the service file and enable it

Run these commands from inside the `backend/` directory:

```bash
cd ~/zcharmc.monitoring-develop/backend

sudo cp zcharmc-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable zcharmc-backend
sudo systemctl start zcharmc-backend
sudo systemctl status zcharmc-backend
```

Expected status output:
```
● zcharmc-backend.service - ZCharMC Monitoring Flask Backend Service
     Active: active (running) since ...
```

---

## 8. Verify Everything is Working

### Check service logs (live)
```bash
sudo journalctl -u zcharmc-backend -f
```

### Test API endpoints

```bash
# Health check
curl http://localhost:5001/api/health

# Latest sensor readings
curl http://localhost:5001/api/latest

# All readings
curl http://localhost:5001/api/readings

# Stats
curl http://localhost:5001/api/stats
```

### Test from another device on the same network
```bash
curl http://<raspi-ip>:5001/api/health
```

---

## 9. Test MQTT Pipeline with Fake Data (Optional)

To verify the MQTT → backend → database pipeline before connecting real sensors:

```bash
mosquitto_pub -h 127.0.0.1 -t "co2monitor/node1" \
  -m '{"co2": 850, "temperature": 24.5, "humidity": 60}'
```

Then check if the data was received:
```bash
curl http://localhost:5001/api/latest
```

---

## 📋 Available API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/latest` | Latest reading per node |
| GET | `/api/readings` | All readings (paginated) |
| GET | `/api/history` | Reading history |
| GET | `/api/history/<node_id>` | History for a specific node |
| GET | `/api/stats` | Aggregated statistics |
| GET | `/api/alerts` | Alert data |
| GET | `/api/export/csv` | Export all data as CSV |

---

## 🔧 Useful Commands

| Task | Command |
|------|---------|
| Start service | `sudo systemctl start zcharmc-backend` |
| Stop service | `sudo systemctl stop zcharmc-backend` |
| Restart service | `sudo systemctl restart zcharmc-backend` |
| Check status | `sudo systemctl status zcharmc-backend` |
| View live logs | `sudo journalctl -u zcharmc-backend -f` |
| Check MQTT broker | `sudo systemctl status mosquitto` |

---

## 🗂️ Project Structure (Backend)

```
zcharmc.monitoring-develop/
├── venv/                        # Python virtual environment (project root)
├── backend/
│   ├── app.py                   # Main Flask application
│   ├── requirements.txt         # Python dependencies
│   ├── .env                     # Environment variables (not committed)
│   ├── seed_data.py             # Optional: seed database with test data
│   ├── zcharmc-backend.service  # systemd service unit file
│   ├── instance/
│   │   └── co2.db               # SQLite database (auto-created on first run)
│   └── tests/                   # Unit tests
├── frontend/                    # React/Vite dashboard
└── firmware/                    # PlatformIO ESP32 firmware
```

---

## ⚠️ Troubleshooting

**Service fails to start**
```bash
sudo journalctl -u zcharmc-backend -n 50 --no-pager
```
Check that paths in the `.service` file match your actual username and folder.

**MQTT not connecting**
```bash
sudo systemctl status mosquitto
mosquitto_sub -h 127.0.0.1 -t "co2monitor/#" -v
```
Make sure Mosquitto is running and `.env` has `MQTT_BROKER=127.0.0.1`.

**Port 5001 already in use**
```bash
sudo lsof -i :5001
```
Kill the conflicting process or change `FLASK_RUN_PORT` in `.env`.

**Database not created**
The `instance/co2.db` file is auto-created when `app.py` starts. Make sure the `instance/` directory exists:
```bash
mkdir -p ~/zcharmc.monitoring-develop/backend/instance
```
