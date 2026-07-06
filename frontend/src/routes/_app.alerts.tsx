import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Circle, CircleDot, Download } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { generateAlerts, generateSnapshot, type AlertRecord } from "@/lib/mock-data";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
});

function AlertsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [alerts] = useState<AlertRecord[]>(() => generateAlerts());
  const [selected, setSelected] = useState<AlertRecord | null>(null);
  const [snap] = useState(() => generateSnapshot(60, 60_000));

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
          onClick={() => toast.success("Exporting alerts CSV")}
          className="border border-border text-xs px-3 py-2 rounded-sm hover:bg-muted flex items-center gap-1.5"
        >
          <Download className="h-3 w-3" />
          Export alerts
        </button>
      </header>

      <div className="border border-border rounded-sm p-4 flex flex-wrap gap-3 bg-card">
        <Select label="Date range" options={["Today", "7 days", "30 days"]} />
        <Select label="Node" options={["All", "Node 1", "Node 2", "Node 3"]} />
        <Select
          label="Alert type"
          options={["All", "CO2 high", "pH out of range", "Liquid level low", "Valve fault", "Sensor offline"]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-border rounded-sm bg-card divide-y divide-border">
          {alerts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={cn(
                "w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-muted/40 transition-colors",
                selected?.id === a.id && "bg-muted/60",
              )}
            >
              {a.status === "active" ? (
                <CircleDot className="h-4 w-4 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{labelFor(a.type)}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.node.toUpperCase()} · {a.sensor}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Triggered <span className="font-mono">{a.triggered}</span> · threshold {a.threshold}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-medium">
                  {a.status === "active" ? "Active" : "Resolved"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(a.timestamp, { addSuffix: true })}
                  {a.duration && ` · ${a.duration}`}
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
          ))}
        </section>

        <aside className="border border-border rounded-sm bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">Detail</h2>
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Select an alert to see context.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs space-y-1">
                <Row label="Type" value={labelFor(selected.type)} />
                <Row label="Node" value={selected.node.toUpperCase()} />
                <Row label="Sensor" value={selected.sensor} />
                <Row
                  label="When"
                  value={format(selected.timestamp, "yyyy-MM-dd HH:mm:ss")}
                />
                <Row label="Value" value={String(selected.triggered)} />
                <Row label="Threshold" value={selected.threshold} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  ±30 min context
                </div>
                <TimeSeriesChart
                  height={160}
                  series={[{ name: selected.sensor, data: snap.co2.node1 }]}
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Select({ label, options }: { label: string; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      <select className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background">
        {options.map((o) => (
          <option key={o}>{o}</option>
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

function labelFor(t: AlertRecord["type"]) {
  return {
    co2_high: "CO2 high",
    ph_out: "pH out of range",
    level_low: "Liquid level low",
    valve_fault: "Valve fault",
    sensor_offline: "Sensor offline",
  }[t];
}
