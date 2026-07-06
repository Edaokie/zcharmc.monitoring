// Mock data generators for the CO2 monitoring UI.
// Replace with Socket.IO / REST feeds when wiring to the Flask backend.

export type NodeId = "node1" | "node2" | "node3";

export interface SensorPoint {
  t: number; // epoch ms
  v: number;
}

export interface ValveState {
  id: string;
  label: string;
  open: boolean;
  lastToggled: number;
}

const seed = (n: number) => {
  let x = Math.sin(n) * 10000;
  return x - Math.floor(x);
};

export function generateSeries(
  count: number,
  intervalMs: number,
  base: number,
  amp: number,
  offset = 0,
): SensorPoint[] {
  const now = Date.now();
  const points: SensorPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * intervalMs;
    const noise = (seed(i + offset) - 0.5) * amp * 0.4;
    const wave = Math.sin((i + offset) / 8) * amp;
    points.push({ t, v: Math.max(0, base + wave + noise) });
  }
  return points;
}

export interface DashboardSnapshot {
  co2: { node1: SensorPoint[]; node2: SensorPoint[] };
  no2: { node1: SensorPoint[]; node2: SensorPoint[] };
  so2: { node1: SensorPoint[]; node2: SensorPoint[] };
  ph: { node1: SensorPoint[]; node2: SensorPoint[] };
  temp: { node1: SensorPoint[]; node2: SensorPoint[] };
  humidity: { node1: SensorPoint[]; node2: SensorPoint[] };
  pm25: { node1: SensorPoint[]; node2: SensorPoint[] };
  flow: { node1: SensorPoint[]; node2: SensorPoint[] };
  level: { node1: number; node2: number };
  valves: ValveState[];
  health: { node1: number; node2: number; node3: number }; // last-seen epoch ms
}

export function generateSnapshot(count = 60, intervalMs = 5000): DashboardSnapshot {
  return {
    co2: {
      node1: generateSeries(count, intervalMs, 4200, 800, 1),
      node2: generateSeries(count, intervalMs, 2100, 600, 2),
    },
    no2: {
      node1: generateSeries(count, intervalMs, 45, 15, 3),
      node2: generateSeries(count, intervalMs, 22, 10, 4),
    },
    so2: {
      node1: generateSeries(count, intervalMs, 30, 12, 5),
      node2: generateSeries(count, intervalMs, 14, 8, 6),
    },
    ph: {
      node1: generateSeries(count, intervalMs, 7.1, 0.6, 7),
      node2: generateSeries(count, intervalMs, 6.9, 0.5, 8),
    },
    temp: {
      node1: generateSeries(count, intervalMs, 28, 3, 9),
      node2: generateSeries(count, intervalMs, 26, 2.5, 10),
    },
    humidity: {
      node1: generateSeries(count, intervalMs, 62, 8, 11),
      node2: generateSeries(count, intervalMs, 58, 7, 12),
    },
    pm25: {
      node1: generateSeries(count, intervalMs, 38, 12, 13),
      node2: generateSeries(count, intervalMs, 18, 8, 14),
    },
    flow: {
      node1: generateSeries(count, intervalMs, 2.4, 0.6, 15),
      node2: generateSeries(count, intervalMs, 2.3, 0.5, 16),
    },
    level: { node1: 62, node2: 41 },
    valves: [
      { id: "n1a", label: "N1 valve A", open: true, lastToggled: Date.now() - 1000 * 60 * 12 },
      { id: "n1b", label: "N1 valve B", open: false, lastToggled: Date.now() - 1000 * 60 * 45 },
      { id: "n2a", label: "N2 valve A", open: true, lastToggled: Date.now() - 1000 * 60 * 8 },
      { id: "n2b", label: "N2 valve B", open: false, lastToggled: Date.now() - 1000 * 60 * 90 },
    ],
    health: {
      node1: Date.now() - 2000,
      node2: Date.now() - 4000,
      node3: Date.now() - 3000,
    },
  };
}

export interface AlertRecord {
  id: string;
  timestamp: number;
  node: NodeId;
  sensor: string;
  type: "co2_high" | "ph_out" | "level_low" | "valve_fault" | "sensor_offline";
  triggered: number;
  threshold: string;
  status: "active" | "resolved";
  duration?: string;
}

export function generateAlerts(): AlertRecord[] {
  const now = Date.now();
  return [
    { id: "a1", timestamp: now - 1000 * 60 * 5, node: "node1", sensor: "CO2", type: "co2_high", triggered: 5320, threshold: "> 5000 ppm", status: "active" },
    { id: "a2", timestamp: now - 1000 * 60 * 40, node: "node2", sensor: "pH", type: "ph_out", triggered: 5.2, threshold: "5.5–8.5", status: "active" },
    { id: "a3", timestamp: now - 1000 * 60 * 60 * 3, node: "node1", sensor: "CO2", type: "co2_high", triggered: 4800, threshold: "> 3000 ppm", status: "resolved", duration: "12 min" },
    { id: "a4", timestamp: now - 1000 * 60 * 60 * 6, node: "node2", sensor: "Liquid", type: "level_low", triggered: 8, threshold: "< 10%", status: "resolved", duration: "24 min" },
    { id: "a5", timestamp: now - 1000 * 60 * 60 * 12, node: "node1", sensor: "Heartbeat", type: "sensor_offline", triggered: 0, threshold: "> 60s", status: "resolved", duration: "3 min" },
  ];
}

export const THRESHOLDS = {
  co2Warn: 3000,
  co2Danger: 5000,
  phMin: 5.5,
  phMax: 8.5,
  levelMin: 10,
  offlineMs: 60_000,
};

export function co2Status(v: number): "normal" | "warning" | "danger" {
  if (v >= THRESHOLDS.co2Danger) return "danger";
  if (v >= THRESHOLDS.co2Warn) return "warning";
  return "normal";
}
