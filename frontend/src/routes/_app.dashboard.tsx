import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Settings2, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { StatCard } from "@/components/monitor/StatCard";
import { TimeSeriesChart } from "@/components/monitor/TimeSeriesChart";
import { ValveStatusCard } from "@/components/monitor/ValveStatusCard";
import { SensorHealthDot } from "@/components/monitor/SensorHealthDot";
import { TimeRangeControl, type TimeRange } from "@/components/monitor/TimeRangeControl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { co2Status, THRESHOLDS, type SensorPoint } from "@/lib/mock-data";
import { fetchHistory, type Reading } from "@/lib/api";
import { useSocket, type SocketReading } from "@/hooks/useSocket";

import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

// ─────────────────────────────────────────
// Convert backend readings to chart-friendly SensorPoint[]
// ─────────────────────────────────────────
function toSensorPoints(readings: Reading[], field: keyof Reading): SensorPoint[] {
  return readings
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: (r[field] as number) ?? 0 }))
    .sort((a, b) => a.t - b.t);
}

function socketToSensorPoints(arr: SocketReading[], field: string): SensorPoint[] {
  return arr.map((r) => ({
    t: new Date(r.timestamp).getTime(),
    v: (r[field as keyof SocketReading] as number) ?? 0,
  }));
}

// ─────────────────────────────────────────
// Node IDs from hardware
// ─────────────────────────────────────────
const NODES = ["inlet", "outlet", "solenoid_valves"] as const;

function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [range, setRange] = useState<TimeRange>("realtime");

  // Real-time data from WebSocket
  const { connected, latestByNode, recentByNode, valves, actuateValve, vacuums, actuateVacuum } =
    useSocket();

  // Historical data for non-realtime views
  const [historyData, setHistoryData] = useState<Record<string, Reading[]>>({});
  const [loading, setLoading] = useState(false);

  // Fetch historical data when range changes away from realtime
  useEffect(() => {
    if (range === "realtime") return;

    setLoading(true);
    Promise.all(NODES.map((nodeId) => fetchHistory(nodeId).then((data) => ({ nodeId, data }))))
      .then((results) => {
        const map: Record<string, Reading[]> = {};
        results.forEach((r) => {
          map[r.nodeId] = r.data;
        });
        setHistoryData(map);
      })
      .catch((err) => {
        console.error("[Dashboard] Failed to fetch history:", err);
        toast.error("Failed to load historical data");
      })
      .finally(() => setLoading(false));
  }, [range]);

  // ─────────────────────────────────────────
  // Unified Data Resolvers (Real-time vs History)
  // ─────────────────────────────────────────

  const co2Series = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "co2"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "co2"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "co2"),
      outlet: toSensorPoints(historyData["outlet"] || [], "co2"),
    };
  }, [range, recentByNode, historyData]);

  const phSeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "ph"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "ph"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "ph"),
      outlet: toSensorPoints(historyData["outlet"] || [], "ph"),
    };
  }, [range, recentByNode, historyData]);

  const tempSeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "temperature"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "temperature"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "temperature"),
      outlet: toSensorPoints(historyData["outlet"] || [], "temperature"),
    };
  }, [range, recentByNode, historyData]);

  const humiditySeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "humidity"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "humidity"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "humidity"),
      outlet: toSensorPoints(historyData["outlet"] || [], "humidity"),
    };
  }, [range, recentByNode, historyData]);

  const pm25Series = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "pm25"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "pm25"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "pm25"),
      outlet: toSensorPoints(historyData["outlet"] || [], "pm25"),
    };
  }, [range, recentByNode, historyData]);

  const flowSeries = useMemo(() => {
    if (range === "realtime") {
      return {
        inlet: socketToSensorPoints(recentByNode["inlet"] || [], "flow_rate"),
        outlet: socketToSensorPoints(recentByNode["outlet"] || [], "flow_rate"),
      };
    }
    return {
      inlet: toSensorPoints(historyData["inlet"] || [], "flow_rate"),
      outlet: toSensorPoints(historyData["outlet"] || [], "flow_rate"),
    };
  }, [range, recentByNode, historyData]);

  // Pressure sensors — node_id = "inlet" for PS-01 (left tank), "outlet" for PS-02 (right tank)
  const pressureSeries = useMemo(() => {
    if (range === "realtime") {
      return {
        ps01: socketToSensorPoints(recentByNode["inlet"] || [], "pressure1"),
        ps02: socketToSensorPoints(recentByNode["outlet"] || [], "pressure2"),
      };
    }
    return {
      ps01: toSensorPoints(historyData["inlet"] || [], "pressure1"),
      ps02: toSensorPoints(historyData["outlet"] || [], "pressure2"),
    };
  }, [range, recentByNode, historyData]);

  // Latest values for stat cards
  const co2In = useMemo(() => latestByNode["inlet"]?.co2 ?? 0, [latestByNode]);
  const co2Out = useMemo(() => latestByNode["outlet"]?.co2 ?? 0, [latestByNode]);
  const ps01 = useMemo(() => latestByNode["inlet"]?.pressure1 ?? 0, [latestByNode]);
  const ps02 = useMemo(() => latestByNode["outlet"]?.pressure2 ?? 0, [latestByNode]);

  const efficiency = co2In > 0 ? ((co2In - co2Out) / co2In) * 100 : 0;

  // Health times
  const healthTimes = useMemo(() => {
    return {
      inlet: latestByNode["inlet"] ? new Date(latestByNode["inlet"].timestamp).getTime() : 0,
      outlet: latestByNode["outlet"] ? new Date(latestByNode["outlet"].timestamp).getTime() : 0,
      solenoid_valves: latestByNode["solenoid_valves"]
        ? new Date(latestByNode["solenoid_valves"].timestamp).getTime()
        : 0,
    };
  }, [latestByNode]);

  const nodesOnline = useMemo(() => {
    return Object.values(healthTimes).every((t) => t > 0 && Date.now() - t < THRESHOLDS.offlineMs);
  }, [healthTimes]);

  const hasData = co2Series.inlet.length > 0 || co2Series.outlet.length > 0;

  // Pressure status helper
  function pressureStatus(v: number): "normal" | "warning" | "danger" {
    if (v >= THRESHOLDS.pressureMax) return "danger";
    if (v >= THRESHOLDS.pressureWarn) return "warning";
    return "normal";
  }

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
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm border ${
              connected
                ? "border-green-500/30 text-green-600 bg-green-500/10"
                : "border-red-500/30 text-red-500 bg-red-500/10"
            }`}
          >
            {connected ? (
              <>
                <Wifi className="h-3 w-3 animate-pulse" />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                <span>Offline</span>
              </>
            )}
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
        <div className="text-center text-sm text-muted-foreground py-4 animate-pulse">
          Loading historical data...
        </div>
      )}

      {/* ── Stat row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Adsorption efficiency"
          value={hasData ? efficiency.toFixed(1) : "—"}
          unit={hasData ? "%" : ""}
        />
        <StatCard
          label="CO₂ inlet"
          value={co2In > 0 ? co2In.toFixed(0) : "—"}
          unit={co2In > 0 ? "ppm" : ""}
          status={co2In > 0 ? co2Status(co2In) : undefined}
        />
        <StatCard
          label="PS-01 (Left Tank)"
          value={ps01 > 0 ? ps01.toFixed(1) : "—"}
          unit={ps01 > 0 ? "psi" : ""}
          status={ps01 > 0 ? pressureStatus(ps01) : undefined}
        />
        <StatCard
          label="PS-02 (Right Tank)"
          value={ps02 > 0 ? ps02.toFixed(1) : "—"}
          unit={ps02 > 0 ? "psi" : ""}
          status={ps02 > 0 ? pressureStatus(ps02) : undefined}
        />
      </section>

      {/* ── System status row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="CO₂ outlet"
          value={co2Out > 0 ? co2Out.toFixed(0) : "—"}
          unit={co2Out > 0 ? "ppm" : ""}
          status={co2Out > 0 ? co2Status(co2Out) : undefined}
        />
        <StatCard
          label="System status"
          value={!connected ? "Offline" : nodesOnline ? "Online" : "Degraded"}
          hint={
            !connected
              ? "Backend disconnected"
              : nodesOnline
                ? "All nodes reporting"
                : "One or more nodes offline"
          }
        />
      </section>

      {/* ── Sensor health ── */}
      <section className="flex items-center gap-6 border border-border rounded-sm p-4 bg-card/30">
        <SensorHealthDot label="Inlet Node" lastSeen={healthTimes.inlet || Date.now()} />
        <SensorHealthDot label="Outlet Node" lastSeen={healthTimes.outlet || Date.now()} />
        <SensorHealthDot
          label="Solenoid Valves"
          lastSeen={healthTimes.solenoid_valves || Date.now()}
        />
      </section>

      {/* ── Hero CO₂ chart ── */}
      <Panel title="CO₂ inlet vs outlet" subtitle="Solid = Inlet · Dashed = Outlet">
        {hasData ? (
          <TimeSeriesChart
            height={320}
            yLabel="ppm"
            series={[
              { name: "Inlet CO₂", data: co2Series.inlet },
              { name: "Outlet CO₂", data: co2Series.outlet, dashed: true },
            ]}
            thresholds={[
              { value: THRESHOLDS.co2Warn, label: "Warning 3000" },
              { value: THRESHOLDS.co2Danger, label: "Danger 5000" },
            ]}
          />
        ) : (
          <NoDataPlaceholder message="Waiting for real-time CO₂ data from sensors..." />
        )}
      </Panel>

      {/* ── Pressure sensors ── */}
      <Panel
        title="Pressure Sensor 01 & 02"
        subtitle="PS-01 Left Tank (solid) · PS-02 Right Tank (dashed) · Max 150 psi"
      >
        {pressureSeries.ps01.length > 0 || pressureSeries.ps02.length > 0 ? (
          <TimeSeriesChart
            height={280}
            yLabel="psi"
            series={[
              { name: "PS-01 Left Tank", data: pressureSeries.ps01 },
              { name: "PS-02 Right Tank", data: pressureSeries.ps02, dashed: true },
            ]}
            thresholds={[
              { value: THRESHOLDS.pressureWarn, label: "Warn 130 psi" },
              { value: THRESHOLDS.pressureMax, label: "Max 150 psi" },
            ]}
          />
        ) : (
          <NoDataPlaceholder message="Waiting for pressure sensor data..." />
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* pH */}
        <Panel title="pH Level" subtitle="Neutral threshold = 7.0">
          {hasData ? (
            <TimeSeriesChart
              yLabel="pH"
              series={[
                { name: "Inlet pH", data: phSeries.inlet },
                { name: "Outlet pH", data: phSeries.outlet, dashed: true },
              ]}
              thresholds={[{ value: 7, label: "Neutral" }]}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for pH data..." />
          )}
        </Panel>

        {/* Temperature & Humidity */}
        <Panel title="Temperature & humidity" subtitle="Temp solid · Humidity dashed">
          {hasData ? (
            <TimeSeriesChart
              series={[
                { name: "Inlet Temp (°C)", data: tempSeries.inlet },
                { name: "Inlet Humidity (%)", data: humiditySeries.inlet, dashed: true },
              ]}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for temperature & humidity data..." />
          )}
        </Panel>

        {/* PM2.5 */}
        <Panel title="PM2.5 Level" subtitle="Inlet vs Outlet">
          {hasData ? (
            <TimeSeriesChart
              type="area"
              yLabel="µg/m³"
              series={[
                { name: "Inlet PM2.5", data: pm25Series.inlet },
                { name: "Outlet PM2.5", data: pm25Series.outlet, dashed: true },
              ]}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for PM2.5 data..." />
          )}
        </Panel>

        {/* Flow rate */}
        <Panel title="Flow rate" subtitle="Inlet vs Outlet">
          {hasData ? (
            <TimeSeriesChart
              type="area"
              yLabel="L/min"
              series={[
                { name: "Inlet Flow", data: flowSeries.inlet },
                { name: "Outlet Flow", data: flowSeries.outlet, dashed: true },
              ]}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for flow rate data..." />
          )}
        </Panel>
      </div>

      {/* ── Solenoid Valves SV1–SV6 ── */}
      <Panel
        title="Solenoid Valves · SV1–SV6"
        subtitle={isAdmin ? "Click a valve to actuate (confirm required)" : "Read-only"}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {valves.map((v) => (
            <ValveStatusCard
              key={v.id}
              valve={v}
              isAdmin={isAdmin}
              onToggle={(id) => {
                if (!isAdmin) return;
                actuateValve(id, !v.open);
                toast.success(`Sent toggle request for ${v.label}`);
              }}
            />
          ))}
        </div>
      </Panel>

      {/* ── Vacuum Actuators ── */}
      <Panel
        title="Vacuum Actuators · Vacuum 1–3"
        subtitle={isAdmin ? "Click to toggle vacuum pump (confirm required)" : "Read-only"}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {vacuums.map((v) => (
            <ValveStatusCard
              key={v.id}
              valve={v}
              isAdmin={isAdmin}
              onToggle={(id) => {
                if (!isAdmin) return;
                actuateVacuum(id, !v.open);
                toast.success(`Sent toggle request for ${v.label}`);
              }}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ─────────────────────────────────────────
// Shared components
// ─────────────────────────────────────────

function NoDataPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground border border-dashed border-border rounded-sm bg-muted/10">
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
              <Row label="CO₂ warning (ppm)" value={THRESHOLDS.co2Warn} />
              <Row label="CO₂ danger (ppm)" value={THRESHOLDS.co2Danger} />
              <Row label="pH min" value={THRESHOLDS.phMin} />
              <Row label="pH max" value={THRESHOLDS.phMax} />
              <Row label="Pressure warn (psi)" value={THRESHOLDS.pressureWarn} />
              <Row label="Pressure max (psi)" value={THRESHOLDS.pressureMax} />
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="nodes">
          <AccordionTrigger>Node configuration</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Nodes: <span className="font-mono">inlet</span>,{" "}
                <span className="font-mono">outlet</span>,{" "}
                <span className="font-mono">solenoid_valves</span>
              </p>
              <p>
                MQTT topic: <span className="font-mono">co2monitor/#</span>
              </p>
              <p>
                Valves: <span className="font-mono">SV1–SV6</span>
              </p>
              <p>
                Vacuums: <span className="font-mono">Vacuum 1, 2, 3</span>
              </p>
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
