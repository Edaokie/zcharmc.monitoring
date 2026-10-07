import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CircleDot, Download, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fetchAlerts, type DateRange } from "@/lib/api";
import { useSocket } from "@/hooks/useSocket";
import { useNow } from "@/hooks/useNow";
import { alertsForReading, filterAlerts, alertsCSV, type AlertRecord } from "@/lib/alerts";
import { sensorPoints } from "@/lib/monitoring";

export const Route = createFileRoute("/_app/alerts")({ component: AlertsPage });

function AlertsPage() {
  const { recentReadings } = useSocket();
  const now = useNow();
  const [apiAlerts, setApiAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>("24h");
  const [node, setNode] = useState("All");
  const [type, setType] = useState("All");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setApiAlerts([]);
    fetchAlerts({ range, ...(node === "All" ? {} : { node_id: node }) })
      .then((rows) => {
        if (active) setApiAlerts(rows.flatMap(alertsForReading));
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        toast.error("Failed to load recorded alerts");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, node, refresh]);

  const records = useMemo(
    () => [...apiAlerts, ...recentReadings.flatMap(alertsForReading)],
    [apiAlerts, recentReadings],
  );
  const filtered = filterAlerts(records, range, node, type, now);
  const selected = filtered.find((record) => record.id === selectedId);
  const context = selected
    ? sensorPoints(
        recentReadings.filter((row) => row.node_id === selected.node),
        selected.sensor,
      )
    : [];

  function exportShown() {
    const url = URL.createObjectURL(
      new Blob([alertsCSV(filtered)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "recorded-alerts.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recorded CO₂, pH, and level threshold breaches.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Acknowledgement and resolution are not tracked. History includes breaches from the
            latest 100 matching readings.
          </p>
        </div>
        <button
          onClick={exportShown}
          disabled={loading || filtered.length === 0}
          className="border border-border text-xs px-3 py-2 rounded-sm hover:bg-muted flex items-center gap-1.5 disabled:opacity-50"
        >
          <Download className="h-3 w-3" />
          Export shown alerts
        </button>
      </header>
      <div className="border border-border rounded-sm p-4 flex flex-wrap gap-3 bg-card">
        <FilterSelect
          label="Date range"
          value={range}
          onChange={(value) => setRange(value as DateRange)}
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
          value={node}
          onChange={setNode}
          options={[
            { label: "All", value: "All" },
            { label: "Inlet", value: "inlet" },
            { label: "Outlet", value: "outlet" },
          ]}
        />
        <FilterSelect
          label="Alert type"
          value={type}
          onChange={setType}
          options={[
            { label: "All", value: "All" },
            { label: "CO₂ warning", value: "co2_high" },
            { label: "CO₂ danger", value: "co2_danger" },
            { label: "pH", value: "ph" },
            { label: "Level", value: "level" },
          ]}
        />
        <button
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
          className="self-end bg-foreground text-background text-xs font-medium px-4 py-2 rounded-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Recorded alerts could not be loaded. Live events may still appear; use Refresh to retry.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-border rounded-sm bg-card divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {loading
                ? "Loading recorded alerts…"
                : error
                  ? "Alert history unavailable"
                  : "No recorded breaches for the selected filters."}
            </div>
          ) : (
            filtered.map((record) => (
              <button
                key={record.id}
                onClick={() => setSelectedId(record.id)}
                className={cn(
                  "w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-muted/40",
                  selectedId === record.id && "bg-muted/60",
                )}
              >
                <CircleDot
                  className={cn(
                    "h-4 w-4 shrink-0",
                    record.severity === "danger" ? "text-red-500" : "text-yellow-500",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    {record.label} · {record.severity}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {record.node} · {record.triggered.toFixed(record.sensor === "co2" ? 0 : 2)}{" "}
                    {record.unit}
                  </div>
                  <div className="text-xs text-muted-foreground">{record.threshold}</div>
                </div>
                <div className="text-right shrink-0 text-xs text-muted-foreground">
                  <div>Recorded</div>
                  <div>{formatDistanceToNow(record.timestamp, { addSuffix: true })}</div>
                </div>
              </button>
            ))
          )}
        </section>
        <aside className="border border-border rounded-sm bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">Detail</h2>
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Select a recorded breach to see context.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs space-y-1">
                <Row label="Sensor" value={selected.label} />
                <Row label="Node" value={selected.node} />
                <Row label="When" value={format(selected.timestamp, "yyyy-MM-dd HH:mm:ss")} />
                <Row label="Value" value={`${selected.triggered} ${selected.unit}`} />
                <Row label="Threshold" value={selected.threshold} />
                <Row label="Status" value="Recorded · Resolution not tracked" />
              </div>
              <p className="text-xs text-muted-foreground">Recent live context for this sensor</p>
              {context.some((point) => point.v != null) ? (
                <TimeSeriesChart
                  height={160}
                  yLabel={selected.unit}
                  series={[{ name: selected.label, data: context }]}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No recent live data for this sensor.
                </p>
              )}
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
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
