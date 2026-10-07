import assert from "node:assert/strict";
import test from "node:test";
import {
  adsorptionEfficiency,
  freshness,
  measurement,
  sensorPoints,
} from "../src/lib/monitoring.ts";
import { alertsForReading, filterAlerts, alertsCSV } from "../src/lib/alerts.ts";

const now = Date.parse("2026-10-07T12:00:00Z");
const inlet = { co2: 1000, timestamp: new Date(now - 1000).toISOString() };
const outlet = { co2: 400, timestamp: new Date(now - 2000).toISOString() };

test("missing measurements remain gaps while real zeros survive", () => {
  const rows = [
    { timestamp: "2026-10-07T12:00:00Z", co2: null },
    { timestamp: "2026-10-07T12:00:01Z", co2: 0 },
    { timestamp: "2026-10-07T12:00:02Z" },
  ];
  assert.deepEqual(
    sensorPoints(rows, "co2").map((point) => point.v),
    [null, 0, null],
  );
  assert.equal(measurement(Number.NaN), null);
  assert.equal(measurement("100"), null);
});

test("efficiency requires two valid recent paired CO2 readings", () => {
  assert.equal(adsorptionEfficiency(inlet, outlet, now), 60);
  assert.equal(adsorptionEfficiency(inlet, { ...outlet, co2: 0 }, now), 100);
  for (const value of [
    undefined,
    { ...outlet, co2: null },
    { ...outlet, co2: NaN },
    { ...outlet, co2: -1 },
    { ...outlet, timestamp: new Date(now - 60_000).toISOString() },
    { ...outlet, timestamp: new Date(now - 20_000).toISOString() },
    { ...outlet, timestamp: new Date(now + 1000).toISOString() },
  ]) {
    assert.equal(adsorptionEfficiency(inlet, value, now), null);
  }
  assert.equal(adsorptionEfficiency({ ...inlet, co2: 0 }, outlet, now), null);
});

test("freshness expires as the clock advances without another reading", () => {
  assert.equal(freshness(null, now), "No data");
  assert.equal(freshness(now, now), "Fresh");
  assert.equal(freshness(now, now + 60_000), "Stale");
  assert.equal(freshness(now + 1000, now), "Stale");
  // Replaying an old valve snapshot must retain its persisted age.
  assert.equal(freshness(now - 120_000, now), "Stale");
});

const row = { id: 42, node_id: "inlet", timestamp: inlet.timestamp, co2: 6000, ph: 0, level: 0 };
test("each breached sensor has its own value, unit, and recorded status", () => {
  const alerts = alertsForReading(row);
  assert.deepEqual(
    alerts.map((alert) => [alert.sensor, alert.triggered, alert.unit, alert.status]),
    [
      ["co2", 6000, "ppm", "recorded"],
      ["ph", 0, "", "recorded"],
      ["level", 0, "%", "recorded"],
    ],
  );
  assert.equal(alerts[0].severity, "danger");
  assert.equal(alertsForReading({ ...row, co2: null, ph: null, level: null }).length, 0);
});

test("historical and live copies deduplicate and every filter applies", () => {
  const events = alertsForReading(row);
  assert.equal(filterAlerts([...events, ...events], "1h", "All", "All", now).length, 3);
  assert.equal(filterAlerts(events, "1h", "outlet", "All", now).length, 0);
  assert.equal(filterAlerts(events, "1h", "inlet", "ph", now)[0].triggered, 0);
  assert.equal(filterAlerts(events, "1h", "All", "All", now + 3_600_000).length, 0);
});

test("explicit backend sensor metadata is preserved and exports never claim resolution", () => {
  const records = alertsForReading({
    ...row,
    sensor: "ph",
    value: 0,
    alert_type: "warning",
    threshold: "pH outside 5.5–8.5",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].sensor, "ph");
  const csv = alertsCSV(records);
  assert.match(csv, /"pH","0",""/);
  assert.match(csv, /recorded/);
  assert.doesNotMatch(csv, /resolved/);
});
