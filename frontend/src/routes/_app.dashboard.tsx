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
import { fetchSeries, type SeriesReading } from "@/lib/api";
import { useNow } from "@/hooks/useNow";
import { adsorptionEfficiency, freshness, measurement, sensorPoints } from "@/lib/monitoring";
import { useSocket } from "@/hooks/useSocket";

import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function hasMeasurements(...series: SensorPoint[][]) {
  return series.some((points) => points.some((point) => point.v !== null));
}

function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [range, setRange] = useState<TimeRange>("realtime");
  const now = useNow();
  const { connected, latestByNode, recentByNode, valves, valveTimestamp, vacuums } = useSocket();
  const [historyData, setHistoryData] = useState<Record<string, SeriesReading[]>>({});
  const [historyWindow, setHistoryWindow] = useState<{ min: number; max: number }>();
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => {
    if (range === "realtime") {
      setLoading(false);
      setHistoryWindow(undefined);
      return;
    }
    const controller = new AbortController();
    const end = Date.now();
    const duration = { "1m": 60_000, "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000 }[range];
    setHistoryWindow({ min: end - duration, max: end });
    setHistoryData({});
    setHistoryError(false);
    setLoading(true);
    fetchSeries(range, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        const grouped: Record<string, SeriesReading[]> = {};
        for (const row of rows) (grouped[row.node_id] ??= []).push(row);
        setHistoryData(grouped);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHistoryError(true);
        toast.error("Failed to load historical data");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, historyRefresh]);

  const series = useMemo(() => {
    const source = range === "realtime" ? recentByNode : historyData;
    const pair = (field: Parameters<typeof sensorPoints>[1]) => ({
      inlet: sensorPoints(source.inlet || [], field),
      outlet: sensorPoints(source.outlet || [], field),
    });
    return {
      co2: pair("co2"),
      ph: pair("ph"),
      temperature: pair("temperature"),
      humidity: pair("humidity"),
      pm25: pair("pm25"),
      flow: pair("flow_rate"),
      pressure: {
        ps01: sensorPoints(source.inlet || [], "pressure1"),
        ps02: sensorPoints(source.outlet || [], "pressure2"),
      },
    };
  }, [range, recentByNode, historyData]);
  const {
    co2: co2Series,
    ph: phSeries,
    temperature: tempSeries,
    humidity: humiditySeries,
    pm25: pm25Series,
    flow: flowSeries,
    pressure: pressureSeries,
  } = series;

  const co2In = measurement(latestByNode.inlet?.co2);
  const co2Out = measurement(latestByNode.outlet?.co2);
  const ps01 = measurement(latestByNode.inlet?.pressure1);
  const ps02 = measurement(latestByNode.outlet?.pressure2);
  const efficiency = adsorptionEfficiency(latestByNode.inlet, latestByNode.outlet, now);
  const healthTimes = {
    inlet: latestByNode.inlet ? Date.parse(latestByNode.inlet.timestamp) : null,
    outlet: latestByNode.outlet ? Date.parse(latestByNode.outlet.timestamp) : null,
    solenoid_valves: valveTimestamp,
  };
  const nodesFresh = Object.values(healthTimes).every((time) => freshness(time, now) === "Fresh");
  const hasData = hasMeasurements(co2Series.inlet, co2Series.outlet);

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
            Read-only monitoring · Equipment control unavailable.
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
                <span>Backend connected</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                <span>Backend disconnected</span>
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

      {historyError && range !== "realtime" && (
        <div role="alert" className="text-sm text-destructive">
          Historical data could not be loaded.{" "}
          <button className="underline" onClick={() => setHistoryRefresh((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Summary values are the latest measurements. Historical charts show period averages; gaps
        mean no measurement.
      </p>
      {/* ── Stat row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Adsorption efficiency"
          value={efficiency == null ? "No data" : efficiency.toFixed(1)}
          unit={efficiency == null ? "" : "%"}
          hint={
            efficiency == null
              ? "Needs CO₂ samples under 60 seconds old and within 10 seconds of each other"
              : "From recent paired CO₂ measurements"
          }
        />
        <StatCard
          label="CO₂ inlet"
          hint={co2In == null ? "Measurement unavailable" : freshness(healthTimes.inlet, now)}
          value={co2In == null ? "No data" : co2In.toFixed(0)}
          unit={co2In == null ? "" : "ppm"}
          status={co2In != null ? co2Status(co2In) : undefined}
        />
        <StatCard
          label="PS-01 (Left Tank)"
          hint={ps01 == null ? "Measurement unavailable" : freshness(healthTimes.inlet, now)}
          value={ps01 == null ? "No data" : ps01.toFixed(1)}
          unit={ps01 == null ? "" : "psi"}
          status={ps01 != null ? pressureStatus(ps01) : undefined}
        />
        <StatCard
          label="PS-02 (Right Tank)"
          hint={ps02 == null ? "Measurement unavailable" : freshness(healthTimes.outlet, now)}
          value={ps02 == null ? "No data" : ps02.toFixed(1)}
          unit={ps02 == null ? "" : "psi"}
          status={ps02 != null ? pressureStatus(ps02) : undefined}
        />
      </section>

      {/* ── System status row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="CO₂ outlet"
          hint={co2Out == null ? "Measurement unavailable" : freshness(healthTimes.outlet, now)}
          value={co2Out == null ? "No data" : co2Out.toFixed(0)}
          unit={co2Out == null ? "" : "ppm"}
          status={co2Out != null ? co2Status(co2Out) : undefined}
        />
        <StatCard
          label="System status"
          value={!connected ? "Disconnected" : nodesFresh ? "Fresh" : "Incomplete / stale"}
          hint={
            !connected
              ? "Backend disconnected"
              : nodesFresh
                ? "All node measurements are recent"
                : "One or more nodes have stale or missing telemetry"
          }
        />
      </section>

      {/* ── Sensor health ── */}
      <section className="flex items-center gap-6 border border-border rounded-sm p-4 bg-card/30">
        <SensorHealthDot label="Inlet Node" lastSeen={healthTimes.inlet} now={now} />
        <SensorHealthDot label="Outlet Node" lastSeen={healthTimes.outlet} now={now} />
        <SensorHealthDot label="Solenoid Valves" lastSeen={healthTimes.solenoid_valves} now={now} />
      </section>

      {/* ── Hero CO₂ chart ── */}
      <Panel title="CO₂ inlet vs outlet" subtitle="Solid = Inlet · Dashed = Outlet">
        {hasData ? (
          <TimeSeriesChart
            timeWindow={historyWindow}
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
        {hasMeasurements(pressureSeries.ps01, pressureSeries.ps02) ? (
          <TimeSeriesChart
            timeWindow={historyWindow}
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
          {hasMeasurements(phSeries.inlet, phSeries.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
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
          {hasMeasurements(tempSeries.inlet, humiditySeries.inlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
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
          {hasMeasurements(pm25Series.inlet, pm25Series.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
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
          {hasMeasurements(flowSeries.inlet, flowSeries.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
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
      <Panel title="Solenoid Valves · SV1–SV6" subtitle="Telemetry only · Control unavailable">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {valves.map((valve) => (
            <ValveStatusCard key={valve.id} valve={valve} />
          ))}
        </div>
      </Panel>

      {/* ── Vacuum Actuators ── */}
      <Panel title="Vacuum Actuators · Vacuum 1–3" subtitle="Telemetry only · Control unavailable">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {vacuums.map((valve) => (
            <ValveStatusCard key={valve.id} valve={valve} />
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
