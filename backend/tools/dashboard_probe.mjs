// Exercise the exact pure helpers used by the dashboard against real socket events.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compareReadings, mergeReading } from '../../frontend/src/lib/readings.ts';
import { adsorptionEfficiency, sensorPoints } from '../../frontend/src/lib/monitoring.ts';
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const latest = {};
let buffer = [];
for (const row of fixture.events) {
  const previous = latest[row.node_id];
  if (!previous || compareReadings(row, previous) > 0) latest[row.node_id] = row;
  buffer = mergeReading(buffer, row, 10000);
}
for (const row of fixture.latest) {
  assert.deepEqual(latest[row.node_id], row, `Dashboard latest disagrees for ${row.node_id}`);
}
assert.equal(new Set(buffer.map(r => r.id)).size, buffer.length, 'Reconnect produced duplicate points');
const expected = fixture.expected_efficiency;
const actual = adsorptionEfficiency(latest.inlet, latest.outlet, fixture.now);
assert.equal(actual, expected, 'Dashboard efficiency disagrees');
for (const field of ['co2', 'pressure1', 'temperature']) {
  const points = sensorPoints(buffer, field);
  assert.ok(points.every(p => p.v === null || Number.isFinite(p.v)));
  assert.equal(points.filter(p => p.v === 0).length, buffer.filter(r => r[field] === 0).length);
  assert.equal(points.filter(p => p.v === null).length, buffer.filter(r => r[field] == null).length);
}
console.log('PASS: actual dashboard helpers, socket latest/replay ordering, null gaps, zeros and efficiency');
