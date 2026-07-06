import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { StatCard } from "@/components/monitor/StatCard";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { LevelGauge } from "@/components/monitor/LevelGauge";
import { ValveStatusCard } from "@/components/monitor/ValveStatusCard";
import { SensorHealthDot } from "@/components/monitor/SensorHealthDot";
import { TimeRangeControl, type TimeRange } from "@/components/monitor/TimeRangeControl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { co2Status, generateSnapshot, THRESHOLDS } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [range, setRange] = useState<TimeRange>("realtime");
  const [snap, setSnap] = useState(() => generateSnapshot(60, 5000));

  // Simulated live stream. Replace with: socket.on('sensor_data', ...)
  useEffect(() => {
    if (range !== "realtime") {
      const params = rangeParams(range);
      setSnap(generateSnapshot(params.count, params.interval));
      return;
    }
    const id = setInterval(() => setSnap(generateSnapshot(60, 5000)), 3000);
    return () => clearInterval(id);
  }, [range]);

  const co2InLast = last(snap.co2.node1);
  const co2OutLast = last(snap.co2.node2);
  const efficiency = ((co2InLast - co2OutLast) / co2InLast) * 100;

  const nodesOnline = useMemo(() => {
    return Object.values(snap.health).every((t) => Date.now() - t < THRESHOLDS.offlineMs);
  }, [snap]);

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Admin view — actuation enabled." : "Read-only monitoring view."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeControl value={range} onChange={setRange} />
          {isAdmin && (
            <Sheet>
              <SheetTrigger className="border border-border rounded-sm p-2 hover:bg-muted">
                <Settings2 className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent className="w-[400px] sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Admin settings</SheetTitle>
                </SheetHeader>
                <ThresholdSettingsPanel />
              </SheetContent>
            </Sheet>
          )}
        </div>
      </header>

      {/* Stat row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Adsorption efficiency"
          value={efficiency.toFixed(1)}
          unit="%"
        />
        <StatCard
          label="CO2 inlet (N1)"
          value={co2InLast.toFixed(0)}
          unit="ppm"
          status={co2Status(co2InLast)}
        />
        <StatCard
          label="CO2 outlet (N2)"
          value={co2OutLast.toFixed(0)}
          unit="ppm"
          status={co2Status(co2OutLast)}
        />
        <StatCard
          label="System status"
          value={nodesOnline ? "Online" : "Degraded"}
          hint={nodesOnline ? "All nodes reporting" : "One or more nodes offline"}
        />
      </section>

      {/* Sensor health */}
      <section className="flex items-center gap-6 border border-border rounded-sm p-4">
        <SensorHealthDot label="Node 1 · Inlet" lastSeen={snap.health.node1} />
        <SensorHealthDot label="Node 2 · Outlet" lastSeen={snap.health.node2} />
        <SensorHealthDot label="Node 3 · Actuation" lastSeen={snap.health.node3} />
      </section>

      {/* Hero CO2 chart */}
      <Panel title="CO2 inlet vs outlet" subtitle="Solid = Node 1 · Dashed = Node 2">
        <TimeSeriesChart
          height={320}
          yLabel="ppm"
          series={[
            { name: "N1 inlet", data: snap.co2.node1 },
            { name: "N2 outlet", data: snap.co2.node2, dashed: true },
          ]}
          thresholds={[
            { value: THRESHOLDS.co2Warn, label: "Warning 3000" },
            { value: THRESHOLDS.co2Danger, label: "Danger 5000" },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="NO2">
          <TimeSeriesChart
            yLabel="ppb"
            series={[
              { name: "N1", data: snap.no2.node1 },
              { name: "N2", data: snap.no2.node2, dashed: true },
            ]}
          />
        </Panel>
        <Panel title="SO2">
          <TimeSeriesChart
            yLabel="ppb"
            series={[
              { name: "N1", data: snap.so2.node1 },
              { name: "N2", data: snap.so2.node2, dashed: true },
            ]}
          />
        </Panel>
        <Panel title="pH">
          <TimeSeriesChart
            yLabel="pH"
            series={[
              { name: "N1", data: snap.ph.node1 },
              { name: "N2", data: snap.ph.node2, dashed: true },
            ]}
            thresholds={[{ value: 7, label: "Neutral" }]}
          />
        </Panel>
        <Panel title="Temperature & humidity" subtitle="Temp solid · Humidity dashed">
          <TimeSeriesChart
            series={[
              { name: "N1 temp °C", data: snap.temp.node1 },
              { name: "N1 humidity %", data: snap.humidity.node1, dashed: true },
            ]}
          />
        </Panel>
        <Panel title="PM2.5">
          <TimeSeriesChart
            type="area"
            yLabel="µg/m³"
            series={[
              { name: "N1", data: snap.pm25.node1 },
              { name: "N2", data: snap.pm25.node2, dashed: true },
            ]}
          />
        </Panel>
        <Panel title="Flow rate" subtitle={`Cumulative N1 ${cumulate(snap.flow.node1).toFixed(1)} L · N2 ${cumulate(snap.flow.node2).toFixed(1)} L`}>
          <TimeSeriesChart
            type="area"
            yLabel="L/min"
            series={[
              { name: "N1", data: snap.flow.node1 },
              { name: "N2", data: snap.flow.node2, dashed: true },
            ]}
          />
        </Panel>
      </div>

      {/* Liquid + valves */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Liquid level">
          <div className="flex gap-6 justify-around">
            <LevelGauge label="Node 1" value={snap.level.node1} />
            <LevelGauge label="Node 2" value={snap.level.node2} />
          </div>
        </Panel>
        <div className="lg:col-span-2">
          <Panel
            title="Valve status · Node 3"
            subtitle={isAdmin ? "Click a valve to actuate (confirm required)" : "Read-only"}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {snap.valves.map((v) => (
                <ValveStatusCard
                  key={v.id}
                  valve={v}
                  isAdmin={isAdmin}
                  onToggle={(id) => {
                    if (!isAdmin) return;
                    toast.success(`Valve ${id} toggle requested`);
                  }}
                />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({
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
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function ThresholdSettingsPanel() {
  return (
    <div className="mt-6">
      <Accordion type="single" collapsible>
        <AccordionItem value="thresholds">
          <AccordionTrigger>Alarm thresholds</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 text-sm">
              <Row label="CO2 warning (ppm)" value={THRESHOLDS.co2Warn} />
              <Row label="CO2 danger (ppm)" value={THRESHOLDS.co2Danger} />
              <Row label="pH min" value={THRESHOLDS.phMin} />
              <Row label="pH max" value={THRESHOLDS.phMax} />
              <Row label="Liquid level min (%)" value={THRESHOLDS.levelMin} />
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="nodes">
          <AccordionTrigger>Node configuration</AccordionTrigger>
          <AccordionContent>
            <p className="text-sm text-muted-foreground">
              Node addressing, MQTT topics, and calibration offsets go here.
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="users">
          <AccordionTrigger>User management</AccordionTrigger>
          <AccordionContent>
            <p className="text-sm text-muted-foreground">
              Invite myIIT users and assign roles (admin/client).
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        defaultValue={value}
        className="w-24 border border-border rounded-sm px-2 py-1 text-right font-mono text-sm"
      />
    </div>
  );
}

function last(arr: { v: number }[]) {
  return arr[arr.length - 1]?.v ?? 0;
}
function cumulate(arr: { v: number }[]) {
  return arr.reduce((s, p) => s + p.v, 0) / 60;
}
function rangeParams(r: TimeRange) {
  switch (r) {
    case "1m":
      return { count: 60, interval: 1000 };
    case "1h":
      return { count: 120, interval: 30_000 };
    case "6h":
      return { count: 180, interval: 2 * 60_000 };
    case "24h":
      return { count: 288, interval: 5 * 60_000 };
    default:
      return { count: 60, interval: 5000 };
  }
}
