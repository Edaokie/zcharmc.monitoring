import assert from "node:assert/strict";
import test from "node:test";
import { formatPhtAxis, formatPhtDateTime, formatPhtTime, phtInputToIso } from "../src/lib/time.ts";

// 2026-11-18T08:30:05Z is 16:30:05 in Philippine Time (UTC+8).
const UTC_SAMPLE = "2026-11-18T08:30:05Z";

test("formats UTC timestamps in Philippine Time regardless of host timezone", () => {
  assert.equal(formatPhtDateTime(UTC_SAMPLE), "2026-11-18 16:30:05");
  assert.equal(formatPhtTime(Date.parse(UTC_SAMPLE)), "16:30:05");
});

test("rolls over to the next PHT day after 16:00 UTC", () => {
  assert.equal(formatPhtDateTime("2026-11-18T16:00:00Z"), "2026-11-19 00:00:00");
});

test("axis labels add the date only for multi-day spans", () => {
  const t = Date.parse(UTC_SAMPLE);
  assert.equal(formatPhtAxis(t, 3_600_000), "16:30");
  assert.equal(formatPhtAxis(t, 7 * 86_400_000), "Nov 18 16:30");
});

test("datetime-local input is read as Philippine Time and sent as UTC", () => {
  assert.equal(phtInputToIso("2026-11-18T16:30"), "2026-11-18T08:30:00.000Z");
  assert.equal(phtInputToIso("2026-11-19T00:00"), "2026-11-18T16:00:00.000Z");
});
