# ─────────────────────────────────────────────────────────────────────────────
# backend/tests/test_app.py
# ─────────────────────────────────────────────────────────────────────────────
#
# WHAT IS THIS FILE?
#   This is the pytest test suite for the Flask backend.
#   pytest automatically discovers files named "test_*.py" and runs
#   any function whose name starts with "test_".
#
# HOW TO RUN LOCALLY:
#   cd backend
#   pytest tests/ -v
#
# WHAT IS A FLASK TEST CLIENT?
#   Flask comes with a built-in test client that lets you send HTTP
#   requests to your app WITHOUT starting a real server.
#   It's fast, isolated, and doesn't need a port or network.
#   Think of it as a "fake browser" built into Flask for testing.
#
# ─────────────────────────────────────────────────────────────────────────────

import os
import sys
import tempfile
import sqlite3
import pytest

# Add the backend directory to sys.path so we can import app.py
# (pytest runs from the backend/ directory thanks to working-directory in CI)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ─────────────────────────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────────────────────────
# A pytest "fixture" is a reusable setup/teardown function.
# When a test function has a parameter with the same name as a fixture,
# pytest automatically runs the fixture and passes its return value in.
#
# The "yield" keyword is like a "pause" — code before yield is setup,
# code after yield is teardown (cleanup). This runs after each test.

@pytest.fixture
def app():
    """
    Create and configure a fresh Flask app instance for testing.
    Uses a temporary SQLite database that gets deleted after each test.
    This ensures tests are isolated — they don't affect each other.
    """
    # Create a temporary file to use as the test database
    # tempfile.mkstemp() returns (file_descriptor, file_path)
    db_fd, db_path = tempfile.mkstemp(suffix=".db")

    # Set environment variables BEFORE importing the app
    # so the app picks them up during module load
    os.environ.setdefault("MQTT_BROKER", "127.0.0.1")
    os.environ.setdefault("SECRET_KEY", "test-secret")

    # Import the Flask app
    # We do this INSIDE the fixture so env vars are set first
    from app import app as flask_app, init_db, DB_PATH

    # Override the database path to our temp file
    import app as app_module
    app_module.DB_PATH = db_path

    # Put Flask into TESTING mode:
    #   - Exceptions propagate to the test (so we see real errors)
    #   - No real server is started
    flask_app.config.update({
        "TESTING": True,
        "SECRET_KEY": "test-secret",
    })

    # Initialize the schema in our temp database
    with flask_app.app_context():
        init_db()

    # "yield" the app to the test function
    yield flask_app

    # ── TEARDOWN: runs after each test ───────────────────────────────────
    # Close and delete the temporary database file
    os.close(db_fd)
    os.unlink(db_path)
    # Restore the DB path
    app_module.DB_PATH = DB_PATH


@pytest.fixture
def client(app):
    """
    Create a Flask test client from the app fixture.
    The test client lets us make HTTP requests (GET, POST, etc.)
    without starting a real server.
    """
    return app.test_client()


@pytest.fixture
def seeded_db(app):
    """
    Insert a few sample readings into the test database.
    Used by tests that need data to already be present.
    """
    import app as app_module
    db = sqlite3.connect(app_module.DB_PATH)
    db.execute(
        """INSERT INTO readings
           (node_id, co2, temperature, humidity, no2, so2, ph, pm25, flow_rate, level, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("inlet", 1500.0, 28.5, 65.0, 40.0, 20.0, 7.1, 35.0, 2.4, 60.0, "2026-01-01T10:00:00")
    )
    db.execute(
        """INSERT INTO readings
           (node_id, co2, temperature, humidity, no2, so2, ph, pm25, flow_rate, level, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("outlet", 800.0, 27.0, 62.0, 20.0, 10.0, 6.9, 18.0, 2.3, 40.0, "2026-01-01T10:00:05")
    )
    # Also add a high-CO2 reading to trigger alert tests
    db.execute(
        """INSERT INTO readings
           (node_id, co2, temperature, humidity, no2, so2, ph, pm25, flow_rate, level, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("inlet", 4500.0, 30.0, 70.0, 60.0, 35.0, 6.5, 50.0, 2.1, 55.0, "2026-01-01T10:01:00")
    )
    db.commit()
    db.close()


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Health & Root
# ─────────────────────────────────────────────────────────────────────────────

def test_root_endpoint_returns_ok(client):
    """
    The root endpoint (/) should return HTTP 200 and a JSON body
    describing available API routes.
    """
    response = client.get("/")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.get_json()
    assert data is not None, "Response body should be JSON"
    assert data.get("status") == "ok", f"Expected status='ok', got {data}"


def test_health_endpoint_returns_ok(client):
    """
    GET /api/health should always return HTTP 200 with status='ok'.
    This is the simplest possible liveness check.
    """
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Latest readings endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_latest_returns_empty_when_no_data(client):
    """
    GET /api/latest with an empty database should return HTTP 200
    and an empty list — not a 500 error.
    """
    response = client.get("/api/latest")
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list), "Should return a list"
    assert len(data) == 0, "Should be empty when no readings exist"


def test_latest_returns_one_per_node(client, seeded_db):
    """
    GET /api/latest should return the most recent reading for each node.
    With our seeded data (inlet, outlet), we expect 2 rows.
    """
    response = client.get("/api/latest")
    assert response.status_code == 200
    data = response.get_json()
    # We inserted 2 nodes (inlet and outlet), so expect 2 rows
    node_ids = {row["node_id"] for row in data}
    assert "inlet" in node_ids, "Should include 'inlet' node"
    assert "outlet" in node_ids, "Should include 'outlet' node"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — History endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_history_returns_list(client, seeded_db):
    """
    GET /api/history should return a list of readings, newest first,
    limited to 100 rows.
    """
    response = client.get("/api/history")
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) > 0, "Should return readings when data exists"


def test_history_by_node_filters_correctly(client, seeded_db):
    """
    GET /api/history/inlet should only return readings for the 'inlet' node.
    """
    response = client.get("/api/history/inlet")
    assert response.status_code == 200
    data = response.get_json()
    assert all(r["node_id"] == "inlet" for r in data), \
        "All returned readings should be for 'inlet'"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Paginated readings endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_readings_returns_paginated_response(client, seeded_db):
    """
    GET /api/readings should return a dict with 'data' and 'pagination' keys.
    """
    response = client.get("/api/readings")
    assert response.status_code == 200
    data = response.get_json()
    assert "data" in data, "Response should have a 'data' key"
    assert "pagination" in data, "Response should have a 'pagination' key"
    assert isinstance(data["data"], list)


def test_readings_pagination_fields(client, seeded_db):
    """
    The pagination object should include page, per_page, total, total_pages.
    """
    response = client.get("/api/readings?per_page=1&page=1")
    assert response.status_code == 200
    pagination = response.get_json()["pagination"]
    assert "page" in pagination
    assert "per_page" in pagination
    assert "total" in pagination
    assert "total_pages" in pagination
    assert pagination["per_page"] == 1


def test_readings_node_filter(client, seeded_db):
    """
    GET /api/readings?node_id=outlet should only return outlet readings.
    """
    response = client.get("/api/readings?node_id=outlet")
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert all(r["node_id"] == "outlet" for r in data), \
        "All readings should be for 'outlet'"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Stats endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_stats_returns_aggregate_fields(client, seeded_db):
    """
    GET /api/stats should return aggregate fields like avg_co2, max_co2, etc.
    """
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.get_json()
    expected_fields = ["total_records", "min_co2", "max_co2", "avg_co2"]
    for field in expected_fields:
        assert field in data, f"Missing expected field: {field}"


def test_stats_total_records_correct(client, seeded_db):
    """
    Stats should count the correct total number of records.
    We seeded 3 rows (2 inlet + 1 outlet with high CO2).
    """
    response = client.get("/api/stats")
    data = response.get_json()
    assert data["total_records"] == 3, \
        f"Expected 3 records, got {data['total_records']}"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Alerts endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_alerts_returns_list(client, seeded_db):
    """
    GET /api/alerts should return a list of readings above the CO2 threshold.
    """
    response = client.get("/api/alerts?co2_warn=3000&co2_danger=5000")
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)


def test_alerts_filters_by_threshold(client, seeded_db):
    """
    We seeded one reading with co2=4500 (above warning=3000, below danger=5000).
    The alert should be tagged 'warning'.
    """
    response = client.get("/api/alerts?co2_warn=3000&co2_danger=5000")
    data = response.get_json()
    # Should find the 4500 ppm reading
    assert len(data) >= 1, "Should find at least 1 alert"
    high_co2 = [r for r in data if r["co2"] == 4500.0]
    assert len(high_co2) == 1, "Should find the 4500 ppm reading"
    assert high_co2[0]["alert_type"] == "warning", \
        "4500 ppm should be 'warning' (below danger threshold of 5000)"


# ─────────────────────────────────────────────────────────────────────────────
# TESTS — Database schema integrity
# ─────────────────────────────────────────────────────────────────────────────

def test_database_has_all_columns(app):
    """
    Verify the database schema contains all 11 expected columns.
    This catches cases where init_db() is out of sync with save_reading().
    """
    import app as app_module
    db = sqlite3.connect(app_module.DB_PATH)
    cursor = db.execute("PRAGMA table_info(readings)")
    columns = {row[1] for row in cursor.fetchall()}
    db.close()

    expected_columns = {
        "id", "node_id", "co2", "temperature", "humidity",
        "no2", "so2", "ph", "pm25", "flow_rate", "level", "timestamp"
    }
    missing = expected_columns - columns
    assert not missing, f"Database is missing columns: {missing}"
