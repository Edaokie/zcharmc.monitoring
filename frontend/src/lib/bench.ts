export interface BenchSnapshot {
  node_id: string;
  message_id: string;
  timestamp: string;
  valves?: Record<string, boolean>;
  weights?: Record<string, number>;
  [field: string]: unknown;
}
export interface BenchReading {
  payload: BenchSnapshot;
  received_at: string;
  message_id?: string;
}
export interface BenchDevice {
  device_id: string;
  profile: string;
  enabled: boolean;
  allow_test_telemetry: boolean;
  reported_version: string;
  last_seen: string | null;
  latest: BenchReading | null;
}
export const BENCH_FIELDS: [string, string, string][] = [
  ["co2", "CO₂", "ppm"],
  ["temperature", "Temperature", "°C"],
  ["humidity", "Humidity", "%RH"],
  ["ph", "pH", "pH"],
  ["pm25", "PM2.5", "µg/m³"],
  ["flow_rate", "Flow", "L/min"],
  ["level", "Level", "%"],
  ["weight", "Weight", "g"],
  ["no2", "NO₂", "ppm"],
  ["so2", "SO₂", "ppm"],
  ["pressure1", "Pressure 1", "psi"],
  ["pressure2", "Pressure 2", "psi"],
];
export function benchValues(snapshot: BenchSnapshot): { label: string; value: string }[] {
  const rows = BENCH_FIELDS.flatMap(([field, label, unit]) => {
    const value = snapshot[field];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ label, value: `${value} ${unit}` }]
      : [];
  });
  for (const [id, open] of Object.entries(snapshot.valves ?? {})) {
    if (typeof open === "boolean")
      rows.push({
        label: id.toUpperCase(),
        value: open ? "Open (simulated)" : "Closed (simulated)",
      });
  }
  for (const [id, weight] of Object.entries(snapshot.weights ?? {})) {
    if (typeof weight === "number" && Number.isFinite(weight))
      rows.push({ label: id, value: `${weight} g (simulated)` });
  }
  return rows;
}
