import assert from "node:assert/strict";
import { test } from "node:test";
import { benchValues } from "../src/lib/bench.ts";

test("bench displays valid zero measurements and closed valves without fabricating missing sensors", () => {
  const rows = benchValues({
    node_id: "control",
    message_id: "test-1",
    timestamp: "2026-10-15T00:00:00Z",
    co2: 0,
    ph: Number.NaN,
    valves: { sv1: false, sv2: true },
    weights: { weight1: 0 },
  });
  assert.deepEqual(rows, [
    { label: "CO₂", value: "0 ppm" },
    { label: "SV1", value: "Closed (simulated)" },
    { label: "SV2", value: "Open (simulated)" },
    { label: "weight1", value: "0 g (simulated)" },
  ]);
});
