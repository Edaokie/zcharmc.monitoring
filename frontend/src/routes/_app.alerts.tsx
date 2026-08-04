import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Circle, CircleDot, Download, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchAlerts,
  exportCSV,
  type AlertReading,
  type DateRange,
  type ReadingsFilter,
} from "@/lib/api";
import { useSocket, type SocketReading } from "@/hooks/useSocket";
import { THRESHOLDS } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
});

interface AlertRecord {
  id: string;
  timestamp: number;
  node: string;
  sensor: string;
  type: "co2_high" | "co2_danger";
  triggered: number;
  threshold: string;
  status: "active" | "resolved";
  duration?: string;
}

function AlertsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Real-time alerts from WebSocket
  const { recentReadings } = useSocket();

  // Historical alerts from API
  const [apiAlerts, setApiAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AlertRecord | null>(null);

  // Filters
  const [range, setRange] = useState<DateRange>("24h");
  const [nodeFilter, setNodeFilter] = useState("All");

  // Fetch historical alerts from backend
  async function loadAlerts() {
    setLoading(true);
    try {
      const filter: ReadingsFilter = { range };
      if (nodeFilter !== "All") filter.node_id = nodeFilter;

      const data = await fetchAlerts(filter, THRESHOLDS.co2Warn, THRESHOLDS.co2Danger);
      const mapped: AlertRecord[] = data.map((r, i) => ({
        id: `api-${r.id}`,
        timestamp: new Date(r.timestamp).getTime(),
        node: r.node_id,
        sensor: "CO2",
        type: r.alert_type === "danger" ? "co2_danger" : "co2_high",
        triggered: r.co2,
        threshold: r.threshold,
        status: "resolved" as const,
      }));
      setApiAlerts(mapped);
    } catch (err) {
      console.error("[Alerts] Failed to load:", err);
      toast.error("Failed to load alerts. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  // Real-time alerts from live WebSocket data
  const liveAlerts: AlertRecord[] = recentReadings
    .filter((r) => r.co2 >= THRESHOLDS.co2Warn)
    .map((r, i) => ({
      id: `live-${i}`,
      timestamp: new Date(r.timestamp).getTime(),
      node: r.node_id,
      sensor: "CO2",
      type: r.co2 >= THRESHOLDS.co2Danger ? "co2_danger" : "co2_high",
      triggered: r.co2,
      threshold:
        r.co2 >= THRESHOLDS.co2Danger
          ? `> ${THRESHOLDS.co2Danger} ppm`
          : `> ${THRESHOLDS.co2Warn} ppm`,
      status: "active" as const,
    }));

  // Combine live + historical, live first
  const allAlerts = [...liveAlerts.reverse(), ...apiAlerts];

  // Apply node filter
  const filteredAlerts =
    nodeFilter === "All" ? allAlerts : allAlerts.filter((a) => a.node === nodeFilter);

  // Chart data for selected alert context
  const contextChartData = recentReadings
    .filter((r) => (selected ? r.node_id === selected.node : true))
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: r.co2 }))
    .sort((a, b) => a.t - b.t);

  // Export alerts as CSV
  function handleExportAlerts() {
    const filter: ReadingsFilter = { range };
    if (nodeFilter !== "All") filter.node_id = nodeFilter;
    exportCSV(filter);
    toast.success("Downloading alerts CSV...");
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Threshold breaches, sensor faults, and offline nodes.
          </p>
        </div>
        <button
          onClick={handleExportAlerts}
          className="border border-border text-xs px-3 py-2 rounded-sm hover:bg-muted flex items-center gap-1.5"
        >
          <Download className="h-3 w-3" />
          Export alerts
        </button>
      </header>

      <div className="border border-border rounded-sm p-4 flex flex-wrap gap-3 bg-card">
        <FilterSelect
          label="Date range"
          value={range}
          onChange={(v) => setRange(v as DateRange)}
          options={[
            { label: "10 min", value: "10min" },
            { label: "1 hour", value: "1h" },
            { label: "12 hours", value: "12h" },
            { label: "24 hours", value: "24h" },
            { label: "7 days", value: "7d" },
            { label: "30 days", value: "30d" },
          ]}
        />
        <FilterSelect
          label="Node"
          value={nodeFilter}
          onChange={setNodeFilter}
          options={[
            { label: "All", value: "All" },
            { label: "Inlet", value: "inlet" },
            { label: "Outlet", value: "outlet" },
            { label: "Solenoid valves", value: "solenoid_valves" },
          ]}
        />
        <FilterSelect
          label="Alert type"
          value="All"
          onChange={() => {}}
          options={[
            { label: "All", value: "All" },
            { label: "CO2 high (warning)", value: "co2_high" },
            { label: "CO2 danger", value: "co2_danger" },
          ]}
        />
        <button
          onClick={() => {
            loadAlerts();
          }}
          disabled={loading}
          className="self-end bg-foreground text-background text-xs font-medium px-4 py-2 rounded-sm hover:bg-foreground/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-border rounded-sm bg-card divide-y divide-border">
          {filteredAlerts.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading alerts...
                </div>
              ) : (
                "No alerts for the selected filters. All readings within thresholds."
              )}
            </div>
          ) : (
            filteredAlerts.slice(0, 50).map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className={cn(
                  "w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-muted/40 transition-colors",
                  selected?.id === a.id && "bg-muted/60",
                )}
              >
                {a.status === "active" ? (
                  <CircleDot
                    className={cn(
                      "h-4 w-4 shrink-0",
                      a.type === "co2_danger" ? "text-red-500" : "text-yellow-500",
                    )}
                  />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {a.type === "co2_danger" ? "CO2 DANGER" : "CO2 high"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.node} · {a.sensor}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Triggered <span className="font-mono">{a.triggered.toFixed(0)}</span> ppm ·
                    threshold {a.threshold}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={cn(
                      "text-xs font-medium",
                      a.status === "active" ? "text-red-500" : "text-muted-foreground",
                    )}
                  >
                    {a.status === "active" ? "Active" : "Resolved"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(a.timestamp, { addSuffix: true })}
                  </div>
                </div>
                {isAdmin && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.info("Open threshold editor");
                    }}
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Edit threshold
                  </span>
                )}
              </button>
            ))
          )}
        </section>

        <aside className="border border-border rounded-sm bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">Detail</h2>
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select an alert to see context.</p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs space-y-1">
                <Row
                  label="Type"
                  value={selected.type === "co2_danger" ? "CO2 DANGER" : "CO2 high"}
                />
                <Row label="Node" value={selected.node} />
                <Row label="Sensor" value={selected.sensor} />
                <Row label="When" value={format(selected.timestamp, "yyyy-MM-dd HH:mm:ss")} />
                <Row label="Value" value={`${selected.triggered.toFixed(0)} ppm`} />
                <Row label="Threshold" value={selected.threshold} />
                <Row label="Status" value={selected.status} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Live context (recent readings)
                </div>
                {contextChartData.length > 0 ? (
                  <TimeSeriesChart
                    height={160}
                    series={[{ name: "CO2", data: contextChartData }]}
                    thresholds={[
                      { value: THRESHOLDS.co2Warn, label: "Warning" },
                      { value: THRESHOLDS.co2Danger, label: "Danger" },
                    ]}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[160px] text-xs text-muted-foreground border border-dashed border-border rounded-sm">
                    No recent live data for this node
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
