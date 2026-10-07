export const ALERT_THRESHOLDS = {
  co2Warn: 3000,
  co2Danger: 5000,
  phMin: 5.5,
  phMax: 8.5,
  levelMin: 20,
  levelMax: 90,
};
export const RANGE_MS = {
  "1m": 60_000,
  "10min": 600_000,
  "30min": 1_800_000,
  "1h": 3_600_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

export interface AlertRecord {
  id: string;
  timestamp: number;
  node: string;
  sensor: "co2" | "ph" | "level";
  label: string;
  type: "co2_high" | "co2_danger" | "ph" | "level";
  triggered: number;
  unit: string;
  threshold: string;
  severity: "warning" | "danger";
  status: "recorded";
}

interface AlertSource {
  id?: number;
  node_id: string;
  timestamp: string;
  co2?: number | null;
  ph?: number | null;
  level?: number | null;
  sensor?: "co2" | "ph" | "level";
  value?: number;
  alert_type?: "warning" | "danger";
  threshold?: string;
}

/** Historical and live events share identities and never imply acknowledgement/resolution. */
export function alertsForReading(row: AlertSource): AlertRecord[] {
  const records: AlertRecord[] = [];
  const t = ALERT_THRESHOLDS;
  function add(
    sensor: AlertRecord["sensor"],
    value: number,
    severity: AlertRecord["severity"],
    threshold: string,
  ) {
    records.push({
      id: `${row.id ?? `${row.node_id}:${row.timestamp}`}:${sensor}`,
      timestamp: Date.parse(row.timestamp),
      node: row.node_id,
      sensor,
      label: { co2: "CO₂", ph: "pH", level: "Level" }[sensor],
      type: sensor === "co2" ? (severity === "danger" ? "co2_danger" : "co2_high") : sensor,
      triggered: value,
      unit: { co2: "ppm", ph: "", level: "%" }[sensor],
      threshold,
      severity,
      status: "recorded",
    });
  }
  // New APIs identify the breach explicitly. Fallback supports the previous cloud API.
  if (row.sensor && row.value != null && Number.isFinite(row.value)) {
    add(row.sensor, row.value, row.alert_type ?? "warning", row.threshold ?? "Threshold exceeded");
    return records;
  }
  if (row.co2 != null && Number.isFinite(row.co2) && row.co2 >= t.co2Warn) {
    const danger = row.co2 >= t.co2Danger;
    add(
      "co2",
      row.co2,
      danger ? "danger" : "warning",
      `CO2 >= ${danger ? t.co2Danger : t.co2Warn} ppm`,
    );
  }
  if (row.ph != null && Number.isFinite(row.ph) && (row.ph < t.phMin || row.ph > t.phMax))
    add("ph", row.ph, "warning", `pH outside ${t.phMin}–${t.phMax}`);
  if (
    row.level != null &&
    Number.isFinite(row.level) &&
    (row.level < t.levelMin || row.level > t.levelMax)
  )
    add("level", row.level, "warning", `Level outside ${t.levelMin}–${t.levelMax}%`);
  return records;
}

export function filterAlerts(
  records: AlertRecord[],
  range: keyof typeof RANGE_MS,
  node: string,
  type: string,
  now: number,
) {
  const unique = new Map(records.map((record) => [record.id, record]));
  return [...unique.values()]
    .filter(
      (record) =>
        record.timestamp >= now - RANGE_MS[range] &&
        record.timestamp <= now &&
        (node === "All" || record.node === node) &&
        (type === "All" || record.type === type),
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function alertsCSV(records: AlertRecord[]): string {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    ["id", "timestamp", "node", "sensor", "value", "unit", "severity", "threshold", "status"],
    ...records.map((record) => [
      record.id,
      new Date(record.timestamp).toISOString(),
      record.node,
      record.label,
      record.triggered,
      record.unit,
      record.severity,
      record.threshold,
      record.status,
    ]),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}
