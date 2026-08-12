import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, BarChart3, FileText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { StatCard } from "@/components/monitor/StatCard";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  fetchReadings,
  fetchStats,
  exportCSV,
  type Reading,
  type Stats,
  type DateRange,
  type ReadingsFilter,
} from "@/lib/api";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

const DATE_RANGES: { label: string; value: DateRange | "custom" }[] = [
  { label: "10 min", value: "10min" },
  { label: "30 min", value: "30min" },
  { label: "1 hour", value: "1h" },
  { label: "6 hours", value: "6h" },
  { label: "12 hours", value: "12h" },
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Custom", value: "custom" },
];

const NODES = ["All", "inlet", "outlet"];

const SENSOR_LABELS: Record<string, string> = {
  All: "All Sensors",
  co2: "CO₂",
  temperature: "Temperature",
  humidity: "Humidity",
  pressure: "Pressure (PS-01 & PS-02)",
  flow_rate: "Flow Rate",
  ph: "pH",
  pm25: "PM2.5",
};

function ReportsPage() {
  const [range, setRange] = useState<DateRange | "custom">("24h");
  const [node, setNode] = useState("All");
  const [sensor, setSensor] = useState("All");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"charts" | "records">("charts");

  const [readings, setReadings] = useState<Reading[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);

  // Build filter object from current state
  function buildFilter(): ReadingsFilter {
    const filter: ReadingsFilter = { page, per_page: 50 };
    if (node !== "All") filter.node_id = node;
    if (range !== "custom") {
      filter.range = range as DateRange;
    } else if (customStart && customEnd) {
      filter.start = customStart;
      filter.end = customEnd;
    }
    return filter;
  }

  // Fetch data
  async function loadData() {
    setLoading(true);
    try {
      const filter = buildFilter();
      const [readingsRes, statsRes] = await Promise.all([
        fetchReadings(filter),
        fetchStats(filter),
      ]);
      setReadings(readingsRes.data);
      setTotalPages(readingsRes.pagination.total_pages);
      setTotalRecords(readingsRes.pagination.total);
      setStats(statsRes);
    } catch (err) {
      console.error("[Reports] Failed to load:", err);
      toast.error("Failed to load reports data. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  // Load on mount and when page changes
  useEffect(() => {
    loadData();
  }, [page]);

  // Handle Apply Filters
  function handleApply() {
    setPage(1);
    loadData();
  }

  // Handle exports
  function handleExportAll() {
    const filter = buildFilter();
    delete filter.page;
    delete filter.per_page;
    exportCSV(filter);
    toast.success("Downloading CSV...");
  }

  function handleExportPerNode() {
    const filter = buildFilter();
    delete filter.page;
    delete filter.per_page;
    if (node !== "All") {
      exportCSV({ ...filter, node_id: node });
      toast.success(`Downloading CSV for ${node}...`);
    } else {
      ["inlet", "outlet"].forEach((n) => {
        exportCSV({ ...filter, node_id: n });
      });
      toast.success("Downloading 2 CSV files (inlet & outlet)...");
    }
  }

  // Chart data from readings — filter by selected sensor tab
  const showCo2 = sensor === "All" || sensor === "co2";
  const showPressure = sensor === "All" || sensor === "pressure";

  const co2ChartInlet = readings
    .filter((r) => r.node_id === "inlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.co2 ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const co2ChartOutlet = readings
    .filter((r) => r.node_id === "outlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.co2 ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const ps01Chart = readings
    .filter((r) => r.node_id === "inlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.pressure1 ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const ps02Chart = readings
    .filter((r) => r.node_id === "outlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.pressure2 ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const tempChart = readings
    .filter((r) => r.node_id === "inlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.temperature ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const humidityChart = readings
    .filter((r) => r.node_id === "inlet")
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.humidity ?? 0 }))
    .sort((a, b) => a.t - b.t);

  const hasChartData = co2ChartInlet.length > 0 || co2ChartOutlet.length > 0;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historical readings, statistical summaries, and data exports for inlet &amp; outlet nodes.
        </p>
      </header>

      {/* ── Filter bar ── */}
      <div className="border border-border rounded-sm p-4 flex flex-wrap items-end gap-3 bg-card">
        <Field label="Date range">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as DateRange | "custom")}
            className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Custom date range inputs */}
        {range === "custom" && (
          <>
            <Field label="Start">
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
              />
            </Field>
          </>
        )}

        <Field label="Node">
          <select
            value={node}
            onChange={(e) => setNode(e.target.value)}
            className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
          >
            {NODES.map((n) => (
              <option key={n} value={n}>
                {n === "All" ? "All Nodes" : n.charAt(0).toUpperCase() + n.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sensor">
          <select
            value={sensor}
            onChange={(e) => setSensor(e.target.value)}
            className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
          >
            {Object.entries(SENSOR_LABELS).map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </Field>

        <button
          onClick={handleApply}
          disabled={loading}
          className="bg-foreground text-background text-xs font-medium px-4 py-2 rounded-sm hover:bg-foreground/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          Apply filters
        </button>
      </div>

      {/* ── Stats summary ── */}
      <section>
        <SectionLabel>Summary statistics</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
          <StatCard label="Total records" value={totalRecords} />
          <StatCard
            label="Avg CO₂"
            value={stats?.avg_co2 != null ? stats.avg_co2.toFixed(1) : "—"}
            unit={stats?.avg_co2 != null ? "ppm" : ""}
          />
          <StatCard
            label="Min CO₂"
            value={stats?.min_co2 != null ? stats.min_co2.toFixed(0) : "—"}
            unit={stats?.min_co2 != null ? "ppm" : ""}
          />
          <StatCard
            label="Max CO₂"
            value={stats?.max_co2 != null ? stats.max_co2.toFixed(0) : "—"}
            unit={stats?.max_co2 != null ? "ppm" : ""}
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
          <StatCard
            label="Avg Temp"
            value={stats?.avg_temp != null ? stats.avg_temp.toFixed(1) : "—"}
            unit={stats?.avg_temp != null ? "°C" : ""}
          />
          <StatCard
            label="Avg Humidity"
            value={stats?.avg_humidity != null ? stats.avg_humidity.toFixed(1) : "—"}
            unit={stats?.avg_humidity != null ? "%" : ""}
          />
          <StatCard
            label="Avg PS-01"
            value={stats?.avg_pressure1 != null ? stats.avg_pressure1.toFixed(1) : "—"}
            unit={stats?.avg_pressure1 != null ? "psi" : ""}
          />
          <StatCard
            label="Avg PS-02"
            value={stats?.avg_pressure2 != null ? stats.avg_pressure2.toFixed(1) : "—"}
            unit={stats?.avg_pressure2 != null ? "psi" : ""}
          />
        </div>
      </section>

      {/* ── Tabs: Charts / Records ── */}
      <div className="flex gap-1 border-b border-border">
        <TabBtn
          active={activeTab === "charts"}
          onClick={() => setActiveTab("charts")}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Charts"
        />
        <TabBtn
          active={activeTab === "records"}
          onClick={() => setActiveTab("records")}
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`Records (${totalRecords})`}
        />
      </div>

      {/* ── Charts tab ── */}
      {activeTab === "charts" && (
        <div className="space-y-6">
          {/* CO₂ history chart */}
          {showCo2 && (
            <ChartCard title="CO₂ history — Inlet vs Outlet" subtitle="ppm">
              {hasChartData ? (
                <TimeSeriesChart
                  height={280}
                  yLabel="ppm"
                  series={[
                    { name: "Inlet CO₂", data: co2ChartInlet },
                    { name: "Outlet CO₂", data: co2ChartOutlet, dashed: true },
                  ]}
                />
              ) : (
                <EmptyChart loading={loading} />
              )}
            </ChartCard>
          )}

          {/* Pressure history chart */}
          {showPressure && (
            <ChartCard
              title="Pressure history — PS-01 & PS-02"
              subtitle="PS-01 Left Tank (solid) · PS-02 Right Tank (dashed) · Max 150 psi"
            >
              {ps01Chart.length > 0 || ps02Chart.length > 0 ? (
                <TimeSeriesChart
                  height={280}
                  yLabel="psi"
                  series={[
                    { name: "PS-01 Left Tank", data: ps01Chart },
                    { name: "PS-02 Right Tank", data: ps02Chart, dashed: true },
                  ]}
                  thresholds={[{ value: 150, label: "Max 150 psi" }]}
                />
              ) : (
                <EmptyChart loading={loading} />
              )}
            </ChartCard>
          )}

          {/* Temp & Humidity */}
          {(sensor === "All" || sensor === "temperature" || sensor === "humidity") && (
            <ChartCard title="Temperature & Humidity — Inlet" subtitle="°C solid · % dashed">
              {tempChart.length > 0 ? (
                <TimeSeriesChart
                  height={240}
                  series={[
                    { name: "Inlet Temp (°C)", data: tempChart },
                    { name: "Inlet Humidity (%)", data: humidityChart, dashed: true },
                  ]}
                />
              ) : (
                <EmptyChart loading={loading} />
              )}
            </ChartCard>
          )}
        </div>
      )}

      {/* ── Records tab ── */}
      {activeTab === "records" && (
        <section className="border border-border rounded-sm bg-card">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Records
              <span className="text-xs text-muted-foreground font-normal ml-2">
                ({totalRecords} total · page {page}/{totalPages})
              </span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleExportPerNode}
                className="border border-border text-xs px-3 py-1.5 rounded-sm hover:bg-muted flex items-center gap-1.5"
              >
                <Download className="h-3 w-3" />
                Export per node
              </button>
              <button
                onClick={handleExportAll}
                className="bg-foreground text-background text-xs px-3 py-1.5 rounded-sm flex items-center gap-1.5"
              >
                <Download className="h-3 w-3" />
                Export all
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead className="text-right">CO₂ (ppm)</TableHead>
                  <TableHead className="text-right">Temp (°C)</TableHead>
                  <TableHead className="text-right">Humidity (%)</TableHead>
                  <TableHead className="text-right">pH</TableHead>
                  <TableHead className="text-right">PM2.5</TableHead>
                  <TableHead className="text-right">Flow (L/m)</TableHead>
                  <TableHead className="text-right">PS-01 (psi)</TableHead>
                  <TableHead className="text-right">PS-02 (psi)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No readings found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  readings.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {format(new Date(r.timestamp), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
                            r.node_id === "inlet"
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-amber-500/10 text-amber-600"
                          }`}
                        >
                          {r.node_id}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.co2?.toFixed(1) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.temperature?.toFixed(1) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.humidity?.toFixed(1) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.ph?.toFixed(2) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.pm25?.toFixed(1) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.flow_rate?.toFixed(1) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.pressure1 != null ? r.pressure1.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.pressure2 != null ? r.pressure2.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-border">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-xs px-3 py-1.5 border border-border rounded-sm hover:bg-muted disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-xs px-3 py-1.5 border border-border rounded-sm hover:bg-muted disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
      {children}
    </p>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded-sm bg-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs px-4 py-2 border-b-2 transition-colors ${
        active
          ? "border-foreground text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyChart({ loading }: { loading: boolean }) {
  return (
    <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
      {loading ? "Loading..." : "No data for selected filters"}
    </div>
  );
}
