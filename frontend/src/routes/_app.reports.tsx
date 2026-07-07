import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
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

const DATE_RANGES: { label: string; value: DateRange | 'custom' }[] = [
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

const NODES = ["All", "inlet", "outlet", "solenoid_valves"];

function ReportsPage() {
  const [range, setRange] = useState<DateRange | 'custom'>("24h");
  const [node, setNode] = useState("All");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);

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
      console.error('[Reports] Failed to load:', err);
      toast.error('Failed to load reports data. Is the backend running?');
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
    toast.success('Downloading CSV...');
  }

  function handleExportPerNode() {
    const filter = buildFilter();
    delete filter.page;
    delete filter.per_page;
    if (node !== "All") {
      filter.node_id = node;
    }
    // If "All" selected, export per-node separately
    if (node === "All") {
      ['inlet', 'outlet', 'solenoid_valves'].forEach(n => {
        exportCSV({ ...filter, node_id: n });
      });
      toast.success('Downloading 3 CSV files (one per node)...');
    } else {
      exportCSV(filter);
      toast.success(`Downloading CSV for ${node}...`);
    }
  }

  // Chart data from readings
  const co2ChartInlet = readings
    .filter(r => r.node_id === 'inlet')
    .map(r => ({ t: new Date(r.timestamp).getTime(), v: r.co2 }))
    .sort((a, b) => a.t - b.t);

  const co2ChartOutlet = readings
    .filter(r => r.node_id === 'outlet')
    .map(r => ({ t: new Date(r.timestamp).getTime(), v: r.co2 }))
    .sort((a, b) => a.t - b.t);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historical readings, filtered exports, and per-node summaries.
        </p>
      </header>

      {/* Filter bar */}
      <div className="border border-border rounded-sm p-4 flex flex-wrap items-end gap-3 bg-card">
        <Field label="Date range">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as DateRange | 'custom')}
            className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
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
              <option key={n} value={n}>{n === "All" ? "All" : n}</option>
            ))}
          </select>
        </Field>

        <Field label="Sensor">
          <select
            disabled
            className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background opacity-50"
          >
            <option>CO2 / Temp / Humidity</option>
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

      {/* Stats — REAL DATA */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total records" value={totalRecords} />
        <StatCard
          label="Avg CO2"
          value={stats?.avg_co2 != null ? stats.avg_co2.toFixed(1) : "—"}
          unit={stats?.avg_co2 != null ? "ppm" : ""}
        />
        <StatCard
          label="Min CO2"
          value={stats?.min_co2 != null ? stats.min_co2.toFixed(0) : "—"}
          unit={stats?.min_co2 != null ? "ppm" : ""}
        />
        <StatCard
          label="Max CO2"
          value={stats?.max_co2 != null ? stats.max_co2.toFixed(0) : "—"}
          unit={stats?.max_co2 != null ? "ppm" : ""}
        />
      </section>

      {/* CO2 history chart */}
      <ChartCard title="CO2 history">
        {co2ChartInlet.length > 0 || co2ChartOutlet.length > 0 ? (
          <TimeSeriesChart
            height={280}
            yLabel="ppm"
            series={[
              { name: "Inlet", data: co2ChartInlet },
              { name: "Outlet", data: co2ChartOutlet, dashed: true },
            ]}
          />
        ) : (
          <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
            {loading ? "Loading..." : "No data for selected filters"}
          </div>
        )}
      </ChartCard>

      {/* Records table with real data */}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Node</TableHead>
              <TableHead className="text-right">CO2 (ppm)</TableHead>
              <TableHead className="text-right">Temp (°C)</TableHead>
              <TableHead className="text-right">Humidity (%)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {readings.length === 0 && !loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No readings found for the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              readings.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {format(new Date(r.timestamp), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell>{r.node_id}</TableCell>
                  <TableCell className="text-right font-mono">{r.co2.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{r.temperature?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.humidity?.toFixed(1) ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-border">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs px-3 py-1.5 border border-border rounded-sm hover:bg-muted disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs px-3 py-1.5 border border-border rounded-sm hover:bg-muted disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-sm bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
      </div>
      {children}
    </section>
  );
}
