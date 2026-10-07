import assert from "node:assert/strict";
import test from "node:test";
import { compareReadings, mergeReading } from "../src/lib/readings.ts";

const current = { id: 2, node_id: "inlet", timestamp: "2026-10-07T04:01:00Z" };
const older = { id: 3, node_id: "inlet", timestamp: "2026-10-07T04:00:00Z" };

test("a delayed upload cannot become the latest reading even with a higher database ID", () => {
  assert.ok(compareReadings(older, current) < 0);
  assert.deepEqual(mergeReading([current], older, 120), [older, current]);
});

test("reconnect replay does not duplicate a chart point", () => {
  const buffer = [current];
  assert.equal(mergeReading(buffer, { ...current }, 120), buffer);
});

test("buffer retains newest measurement times and uses ID for timestamp ties", () => {
  const newer = { ...current, id: 4 };
  assert.ok(compareReadings(newer, current) > 0);
  assert.deepEqual(mergeReading([older, current], newer, 2), [current, newer]);
});

test("device message identities are scoped to their node", () => {
  const inlet = { node_id: "inlet", message_id: "boot:1", timestamp: current.timestamp };
  const outlet = { ...inlet, node_id: "outlet" };
  assert.equal(mergeReading([inlet], outlet, 120).length, 2);
  assert.equal(mergeReading([inlet], { ...inlet }, 120).length, 1);
});
