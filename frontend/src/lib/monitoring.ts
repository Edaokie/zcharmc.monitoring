export type MeasurementField =
  | "co2"
  | "temperature"
  | "humidity"
  | "ph"
  | "pm25"
  | "flow_rate"
  | "level"
  | "weight"
  | "no2"
  | "so2"
  | "pressure1"
  | "pressure2";

export function measurement(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sensorPoints(rows: readonly { timestamp: string }[], field: MeasurementField) {
  return rows
    .map((row) => ({
      t: Date.parse(row.timestamp),
      v: measurement((row as Record<string, unknown>)[field]),
    }))
    .filter((point) => Number.isFinite(point.t))
    .sort((a, b) => a.t - b.t);
}

export function freshness(lastSeen: number | null | undefined, now: number, maxAge = 60_000) {
  if (lastSeen == null || !Number.isFinite(lastSeen)) return "No data";
  const age = now - lastSeen;
  return age >= 0 && age < maxAge ? "Fresh" : "Stale";
}

interface CO2Sample {
  co2?: number | null;
  timestamp: string;
}

/** Compare recent, closely timed samples; missing outlet data must never imply 100%. */
export function adsorptionEfficiency(
  inlet: CO2Sample | undefined,
  outlet: CO2Sample | undefined,
  now: number,
  maxAge = 60_000,
  maxSkew = 10_000,
): number | null {
  const incoming = measurement(inlet?.co2);
  const outgoing = measurement(outlet?.co2);
  if (!inlet || !outlet || incoming == null || outgoing == null || incoming <= 0 || outgoing < 0)
    return null;
  const inletTime = Date.parse(inlet.timestamp);
  const outletTime = Date.parse(outlet.timestamp);
  if (
    freshness(inletTime, now, maxAge) !== "Fresh" ||
    freshness(outletTime, now, maxAge) !== "Fresh" ||
    Math.abs(inletTime - outletTime) > maxSkew
  )
    return null;
  return ((incoming - outgoing) / incoming) * 100;
}
