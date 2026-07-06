import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
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
import { generateSnapshot } from "@/lib/mock-data";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

const RANGES = ["Today", "7 days", "30 days", "Custom"] as const;
const NODES = ["All", "Node 1", "Node 2", "Node 3"];

function ReportsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("Today");
  const [node, setNode] = useState("All");
  const [snap] = useState(() => generateSnapshot(180, 60_000));

  const rows = snap.co2.node1.slice(-30).map((p, i) => ({
    t: p.t,
    node: i % 2 === 0 ? "Node 1" : "Node 2",
    sensor: "CO2",
    value: p.v.toFixed(1),
    unit: "ppm",
  }));

  const co2All = [...snap.co2.node1, ...snap.co2.node2];
  const minCo2 = Math.min(...co2All.map((p) => p.v));
  const maxCo2 = Math.max(...co2All.map((p) => p.v));

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
          <Select value={range} onChange={(v) => setRange(v as any)} options={[...RANGES]} />
        </Field>
        <Field label="Node">
          <Select value={node} onChange={setNode} options={NODES} />
        </Field>
        <Field label="Sensor">
          <Select
            value="All"
            onChange={() => {}}
            options={["All", "CO2", "NO2", "SO2", "pH", "Temp", "Humidity", "PM2.5", "Flow"]}
          />
        </Field>
        <button className="bg-foreground text-background text-xs font-medium px-4 py-2 rounded-sm hover:bg-foreground/90">
          Apply filters
        </button>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total records" value={rows.length * 40} />
        <StatCard label="Avg efficiency" value="48.7" unit="%" />
        <StatCard label="Min CO2" value={minCo2.toFixed(0)} unit="ppm" />
        <StatCard label="Max CO2" value={maxCo2.toFixed(0)} unit="ppm" />
      </section>

      <ChartCard title="CO2 history">
        <TimeSeriesChart
          height={280}
          yLabel="ppm"
          series={[
            { name: "N1 inlet", data: snap.co2.node1 },
            { name: "N2 outlet", data: snap.co2.node2, dashed: true },
          ]}
        />
      </ChartCard>

      <ChartCard title="pH history">
        <TimeSeriesChart
          yLabel="pH"
          series={[
            { name: "N1", data: snap.ph.node1 },
            { name: "N2", data: snap.ph.node2, dashed: true },
          ]}
        />
      </ChartCard>

      <section className="border border-border rounded-sm bg-card">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Records</h2>
          <div className="flex gap-2">
            <button
              onClick={() => toast.success("Exporting per-node CSV")}
              className="border border-border text-xs px-3 py-1.5 rounded-sm hover:bg-muted flex items-center gap-1.5"
            >
              <Download className="h-3 w-3" />
              Export per node
            </button>
            <button
              onClick={() => toast.success("Exporting all filtered CSV")}
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
              <TableHead>Sensor</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">
                  {format(r.t, "yyyy-MM-dd HH:mm:ss")}
                </TableCell>
                <TableCell>{r.node}</TableCell>
                <TableCell>{r.sensor}</TableCell>
                <TableCell className="text-right font-mono">{r.value}</TableCell>
                <TableCell>{r.unit}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border rounded-sm px-2 py-1.5 text-sm bg-background"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-sm bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <button className="text-muted-foreground hover:text-foreground">
          <Download className="h-4 w-4" />
        </button>
      </div>
      {children}
    </section>
  );
}
