import type { MeasurementField } from "./monitoring";
import { apiRequest, API_PROXY } from "./http";

// ─────────────────────────────────────────
// API Service Layer — all backend communication
// ─────────────────────────────────────────
// Django runs on Railway in production and port 5001 locally.
// All REST calls go through this file so components stay clean.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
export interface Reading {
  id: number;
  node_id: string;
  co2: number | null;
  temperature: number | null;
  humidity: number | null;
  no2: number | null;
  so2: number | null;
  ph: number | null;
  pm25: number | null;
  flow_rate: number | null;
  level: number | null;
  weight: number | null;
  pressure1: number | null;
  pressure2: number | null;
  timestamp: string;
}

export interface PaginatedResponse {
  data: Reading[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface Stats {
  total_records: number;
  min_co2: number | null;
  max_co2: number | null;
  avg_co2: number | null;
  min_temp: number | null;
  max_temp: number | null;
  avg_temp: number | null;
  min_humidity: number | null;
  max_humidity: number | null;
  avg_humidity: number | null;
  min_pressure1: number | null;
  max_pressure1: number | null;
  avg_pressure1: number | null;
  min_pressure2: number | null;
  max_pressure2: number | null;
  avg_pressure2: number | null;
}

export interface AlertReading extends Reading {
  alert_type: "warning" | "danger";
  threshold: string;
  sensor?: "co2" | "ph" | "level";
  value?: number;
  alert_id?: string;
}

export type DateRange = "1m" | "10min" | "30min" | "1h" | "6h" | "12h" | "24h" | "7d" | "30d";

export interface ReadingsFilter {
  node_id?: string;
  range?: DateRange;
  start?: string;
  end?: string;
  page?: number;
  per_page?: number;
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function buildParams(filter: ReadingsFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.node_id) params.set("node_id", filter.node_id);
  if (filter.range) params.set("range", filter.range);
  if (filter.start) params.set("start", filter.start);
  if (filter.end) params.set("end", filter.end);
  if (filter.page) params.set("page", String(filter.page));
  if (filter.per_page) params.set("per_page", String(filter.per_page));
  return params;
}

async function apiFetch<T>(path: string, params?: URLSearchParams): Promise<T> {
  return apiRequest(params ? `${path}?${params}` : path);
}

// ─────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────

/** Health check — verify backend is running */
export async function fetchHealth(): Promise<{ status: string; message: string }> {
  return apiFetch("/api/health");
}

/** Chart averages over the complete range (seconds, minutes, or hours). */
export type SeriesReading = Pick<Reading, MeasurementField | "node_id" | "timestamp"> & {
  count: number;
};

export async function fetchSeries(
  range: DateRange | { start: string; end: string },
  signalOrOptions?: AbortSignal | { signal?: AbortSignal; nodeId?: string },
): Promise<SeriesReading[]> {
  const options =
    signalOrOptions instanceof AbortSignal ? { signal: signalOrOptions } : (signalOrOptions ?? {});
  const params =
    typeof range === "string"
      ? new URLSearchParams({ range })
      : new URLSearchParams({ start: range.start, end: range.end });
  if (options.nodeId) params.set("node_id", options.nodeId);
  return apiRequest(`/api/series?${params}`, { signal: options.signal });
}

/** Get filtered, paginated readings */
export async function fetchReadings(filter: ReadingsFilter = {}): Promise<PaginatedResponse> {
  return apiFetch("/api/readings", buildParams(filter));
}

/** Get aggregate statistics */
export async function fetchStats(filter: ReadingsFilter = {}): Promise<Stats> {
  return apiFetch("/api/stats", buildParams(filter));
}

/** Get alert readings (CO2 above threshold) */
export async function fetchAlerts(
  filter: ReadingsFilter = {},
  co2Warn = 3000,
  co2Danger = 5000,
): Promise<AlertReading[]> {
  const params = buildParams(filter);
  params.set("co2_warn", String(co2Warn));
  params.set("co2_danger", String(co2Danger));
  return apiFetch("/api/alerts", params);
}

/** Download CSV — triggers browser file download */
export function exportCSV(filter: ReadingsFilter = {}): void {
  const params = buildParams(filter);
  const url = `${API_PROXY}/api/export/csv?${params}`;
  // Open in new tab triggers download because of Content-Disposition header
  window.open(url, "_blank");
}

export { BACKEND_URL };
