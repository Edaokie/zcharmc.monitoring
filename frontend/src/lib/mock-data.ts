import { ALERT_THRESHOLDS } from "./alerts";

// Shared types and threshold constants used by real monitoring components.
// Fake data generators have been removed — all data comes from the backend API and WebSocket.

// ─────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────

/** A single time-series data point for charts */
export interface SensorPoint {
  t: number; // epoch ms
  v: number | null;
}

/** Represents a valve or vacuum actuator state from the hardware */
export interface ValveState {
  id: string;
  label: string;
  open: boolean | null;
  lastReported: number | null;
}

// ─────────────────────────────────────────
// Alert thresholds
// ─────────────────────────────────────────

export const THRESHOLDS = {
  ...ALERT_THRESHOLDS,
  pressureMax: 150, // psi — upper limit
  pressureWarn: 130, // psi — warn level
  offlineMs: 60_000,
};

// ─────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────

export function co2Status(v: number): "normal" | "warning" | "danger" {
  if (v >= THRESHOLDS.co2Danger) return "danger";
  if (v >= THRESHOLDS.co2Warn) return "warning";
  return "normal";
}
