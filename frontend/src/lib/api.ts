import type { MeasurementField } from "./monitoring";

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
  const url = params ? `${BACKEND_URL}${path}?${params}` : `${BACKEND_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────

/** Health check — verify backend is running */
export async function fetchHealth(): Promise<{ status: string; message: string }> {
  return apiFetch("/api/health");
}

/** Get latest reading for each node */
export async function fetchLatest(): Promise<Reading[]> {
  return apiFetch("/api/latest");
}

/** Get last 100 readings (most recent first) */
export async function fetchHistory(nodeId?: string): Promise<Reading[]> {
  const path = nodeId ? `/api/history/${nodeId}` : "/api/history";
  return apiFetch(path);
}

/** Chart averages over the complete range (seconds, minutes, or hours). */
export type SeriesReading = Pick<Reading, MeasurementField | "node_id" | "timestamp"> & {
  count: number;
};

export async function fetchSeries(
  range: DateRange,
  signal?: AbortSignal,
): Promise<SeriesReading[]> {
  const response = await fetch(`${BACKEND_URL}/api/series?range=${range}`, { signal });
  if (!response.ok) throw new Error(`History API error ${response.status}`);
  return response.json();
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
  const url = `${BACKEND_URL}/api/export/csv?${params}`;
  // Open in new tab triggers download because of Content-Disposition header
  window.open(url, "_blank");
}

export { BACKEND_URL };
