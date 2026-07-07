import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Settings2, Wifi, WifiOff } from "lucide-react";
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
import { co2Status, generateSnapshot, THRESHOLDS, type SensorPoint } from "@/lib/mock-data";
import { fetchHistory, type Reading } from "@/lib/api";
import { useSocket } from "@/hooks/useSocket";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

// ─────────────────────────────────────────
// Convert backend readings to chart-friendly SensorPoint[]
// ─────────────────────────────────────────
function toSensorPoints(readings: Reading[], field: 'co2' | 'temperature' | 'humidity'): SensorPoint[] {
  return readings
    .map(r => ({ t: new Date(r.timestamp).getTime(), v: r[field] ?? 0 }))
    .sort((a, b) => a.t - b.t);
}

function socketToSensorPoints(
  arr: { co2: number; temperature: number; humidity: number; timestamp: string }[],
  field: 'co2' | 'temperature' | 'humidity',
): SensorPoint[] {
  return arr.map(r => ({ t: new Date(r.timestamp).getTime(), v: r[field] ?? 0 }));
}

// ─────────────────────────────────────────
// Node IDs from hardware
// ─────────────────────────────────────────
const NODES = ['inlet', 'outlet', 'solenoid_valves'] as const;

function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [range, setRange] = useState<TimeRange>("realtime");

  // Real-time data from WebSocket
  const { connected, latestByNode, recentByNode } = useSocket();

  // Historical data for non-realtime views
  const [historyData, setHistoryData] = useState<Record<string, Reading[]>>({});
  const [loading, setLoading] = useState(false);

  // Mock data fallback (for sensors not yet connected: NO2, SO2, pH, PM2.5, flow, level, valves)
  const [mockSnap] = useState(() => generateSnapshot(60, 5000));

  // Fetch historical data when range changes away from realtime
  useEffect(() => {
    if (range === "realtime") return;

    setLoading(true);
    Promise.all(
      NODES.map(nodeId =>
        fetchHistory(nodeId).then(data => ({ nodeId, data }))
      )
    )
      .then(results => {
        const map: Record<string, Reading[]> = {};
        results.forEach(r => { map[r.nodeId] = r.data; });
        setHistoryData(map);
      })
      .catch(err => {
        console.error('[Dashboard] Failed to fetch history:', err);
        toast.error('Failed to load historical data');
      })
      .finally(() => setLoading(false));
  }, [range]);

  // ─────────────────────────────────────────
  // Build chart series from real data
  // ─────────────────────────────────────────
  const co2Series = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode['inlet'] || [], 'co2'),
        outlet: socketToSensorPoints(recentByNode['outlet'] || [], 'co2'),
      };
    }
    return {
      inlet: toSensorPoints(historyData['inlet'] || [], 'co2'),
      outlet: toSensorPoints(historyData['outlet'] || [], 'co2'),
    };
  }, [range, recentByNode, historyData]);

  const tempSeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode['inlet'] || [], 'temperature'),
        outlet: socketToSensorPoints(recentByNode['outlet'] || [], 'temperature'),
      };
    }
    return {
      inlet: toSensorPoints(historyData['inlet'] || [], 'temperature'),
      outlet: toSensorPoints(historyData['outlet'] || [], 'temperature'),
    };
  }, [range, recentByNode, historyData]);

  const humiditySeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode['inlet'] || [], 'humidity'),
        outlet: socketToSensorPoints(recentByNode['outlet'] || [], 'humidity'),
      };
    }
    return {
      inlet: toSensorPoints(historyData['inlet'] || [], 'humidity'),
      outlet: toSensorPoints(historyData['outlet'] || [], 'humidity'),
    };
  }, [range, recentByNode, historyData]);

  // Latest values for stat cards
  const inletLatest = latestByNode['inlet'];
  const outletLatest = latestByNode['outlet'];
  const co2In = inletLatest?.co2 ?? 0;
  const co2Out = outletLatest?.co2 ?? 0;
  const efficiency = co2In > 0 ? ((co2In - co2Out) / co2In) * 100 : 0;

  // Health: track last-seen time per node
  const healthTimes = useMemo(() => ({
    inlet: inletLatest ? new Date(inletLatest.timestamp).getTime() : 0,
    outlet: outletLatest ? new Date(outletLatest.timestamp).getTime() : 0,
    solenoid_valves: latestByNode['solenoid_valves']
      ? new Date(latestByNode['solenoid_valves'].timestamp).getTime()
      : 0,
  }), [latestByNode, inletLatest, outletLatest]);

  const nodesOnline = useMemo(() => {
    return Object.values(healthTimes).every((t) => t > 0 && Date.now() - t < THRESHOLDS.offlineMs);
  }, [healthTimes]);

  const hasRealData = co2Series.inlet.length > 0 || co2Series.outlet.length > 0;

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
          {/* Connection status indicator */}
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm border ${
            connected
              ? 'border-green-500/30 text-green-600 bg-green-500/10'
              : 'border-red-500/30 text-red-500 bg-red-500/10'
          }`}>
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? 'Live' : 'Disconnected'}
          </div>
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

      {/* Loading indicator */}
      {loading && (
        <div className="text-center text-sm text-muted-foreground py-4">
          Loading historical data...
        </div>
      )}

      {/* Stat row — REAL DATA */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Adsorption efficiency"
          value={hasRealData ? efficiency.toFixed(1) : "—"}
          unit={hasRealData ? "%" : ""}
        />
        <StatCard
          label="CO2 inlet"
          value={co2In > 0 ? co2In.toFixed(0) : "—"}
          unit={co2In > 0 ? "ppm" : ""}
          status={co2In > 0 ? co2Status(co2In) : undefined}
        />
        <StatCard
          label="CO2 outlet"
          value={co2Out > 0 ? co2Out.toFixed(0) : "—"}
          unit={co2Out > 0 ? "ppm" : ""}
          status={co2Out > 0 ? co2Status(co2Out) : undefined}
        />
        <StatCard
          label="System status"
          value={!connected ? "Offline" : nodesOnline ? "Online" : "Degraded"}
          hint={!connected ? "Backend disconnected" : nodesOnline ? "All nodes reporting" : "One or more nodes offline"}
        />
      </section>

      {/* Sensor health — REAL DATA */}
      <section className="flex items-center gap-6 border border-border rounded-sm p-4">
        <SensorHealthDot label="Inlet" lastSeen={healthTimes.inlet || Date.now()} />
        <SensorHealthDot label="Outlet" lastSeen={healthTimes.outlet || Date.now()} />
        <SensorHealthDot label="Solenoid valves" lastSeen={healthTimes.solenoid_valves || Date.now()} />
      </section>

      {/* Hero CO2 chart — REAL DATA */}
      <Panel title="CO2 inlet vs outlet" subtitle="Solid = Inlet · Dashed = Outlet">
        {hasRealData ? (
          <TimeSeriesChart
            height={320}
            yLabel="ppm"
            series={[
              { name: "Inlet", data: co2Series.inlet },
              { name: "Outlet", data: co2Series.outlet, dashed: true },
            ]}
            thresholds={[
              { value: THRESHOLDS.co2Warn, label: "Warning 3000" },
              { value: THRESHOLDS.co2Danger, label: "Danger 5000" },
            ]}
          />
        ) : (
          <NoDataPlaceholder message="Waiting for real-time CO2 data from ESP32..." />
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NO2 — MOCK (no hardware sensor yet) */}
        <Panel title="NO2" subtitle="No sensor connected">
          <NoDataPlaceholder message="NO2 sensor not yet connected" />
        </Panel>

        {/* SO2 — MOCK (no hardware sensor yet) */}
        <Panel title="SO2" subtitle="No sensor connected">
          <NoDataPlaceholder message="SO2 sensor not yet connected" />
        </Panel>

        {/* pH — MOCK (no hardware sensor yet) */}
        <Panel title="pH" subtitle="No sensor connected">
          <NoDataPlaceholder message="pH sensor not yet connected" />
        </Panel>

        {/* Temperature & Humidity — REAL DATA */}
        <Panel title="Temperature & humidity" subtitle="Temp solid · Humidity dashed">
          {hasRealData ? (
            <TimeSeriesChart
              series={[
                { name: "Inlet temp °C", data: tempSeries.inlet },
                { name: "Inlet humidity %", data: humiditySeries.inlet, dashed: true },
              ]}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for temperature & humidity data..." />
          )}
        </Panel>

        {/* PM2.5 — MOCK (no hardware sensor yet) */}
        <Panel title="PM2.5" subtitle="No sensor connected">
          <NoDataPlaceholder message="PM2.5 sensor not yet connected" />
        </Panel>

        {/* Flow rate — MOCK (no hardware sensor yet) */}
        <Panel title="Flow rate" subtitle="No sensor connected">
          <NoDataPlaceholder message="Flow rate sensor not yet connected" />
        </Panel>
      </div>

      {/* Liquid + valves — keep UI, show placeholder for liquid, keep valve controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Liquid level" subtitle="No sensor connected">
          <div className="flex gap-6 justify-around">
            <LevelGauge label="Inlet" value={0} />
            <LevelGauge label="Outlet" value={0} />
          </div>
        </Panel>
        <div className="lg:col-span-2">
          <Panel
            title="Valve status · Solenoid valves"
            subtitle={isAdmin ? "Click a valve to actuate (confirm required)" : "Read-only"}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {mockSnap.valves.map((v) => (
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

// ─────────────────────────────────────────
// Shared components
// ─────────────────────────────────────────

function NoDataPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground border border-dashed border-border rounded-sm">
      {message}
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
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Nodes: <span className="font-mono">inlet</span>, <span className="font-mono">outlet</span>, <span className="font-mono">solenoid_valves</span></p>
              <p>MQTT topic: <span className="font-mono">co2monitor/#</span></p>
            </div>
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
