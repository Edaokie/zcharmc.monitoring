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
import { useSocket, type SocketReading } from "@/hooks/useSocket";

import { toast } from "sonner";

const CO2_THRESHOLDS = [
  { value: THRESHOLDS.co2Warn, label: "Warning 3000" },
  { value: THRESHOLDS.co2Danger, label: "Danger 5000" },
];
const PRESSURE_THRESHOLDS = [
  { value: THRESHOLDS.pressureWarn, label: "Warn 130 psi" },
  { value: THRESHOLDS.pressureMax, label: "Max 150 psi" },
];
const PH_THRESHOLDS = [{ value: 7, label: "Neutral" }];

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function hasMeasurements(...series: SensorPoint[][]) {
  return series.some((points) => points.some((point) => point.v !== null));
}

function pressureStatus(v: number): "normal" | "warning" | "danger" {
  if (v >= THRESHOLDS.pressureMax) return "danger";
  if (v >= THRESHOLDS.pressureWarn) return "warning";
  return "normal";
}

function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [range, setRange] = useState<TimeRange>("realtime");
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

  const chartSeries = useMemo(
    () => ({
      co2: [
        { name: "Inlet CO₂", data: series.co2.inlet },
        { name: "Outlet CO₂", data: series.co2.outlet, dashed: true },
      ],
      pressure: [
        { name: "PS-01 Left Tank", data: series.pressure.ps01 },
        { name: "PS-02 Right Tank", data: series.pressure.ps02, dashed: true },
      ],
      ph: [
        { name: "Inlet pH", data: series.ph.inlet },
        { name: "Outlet pH", data: series.ph.outlet, dashed: true },
      ],
      temperature: [
        { name: "Inlet Temp", data: series.temperature.inlet },
        { name: "Outlet Temp", data: series.temperature.outlet, dashed: true },
      ],
      humidity: [
        { name: "Inlet Humidity", data: series.humidity.inlet },
        { name: "Outlet Humidity", data: series.humidity.outlet, dashed: true },
      ],
      pm25: [
        { name: "Inlet PM2.5", data: series.pm25.inlet },
        { name: "Outlet PM2.5", data: series.pm25.outlet, dashed: true },
      ],
      flow: [
        { name: "Inlet Flow", data: series.flow.inlet },
        { name: "Outlet Flow", data: series.flow.outlet, dashed: true },
      ],
    }),
    [series],
  );

  const hasData = hasMeasurements(series.co2.inlet, series.co2.outlet);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only monitoring · Equipment control unavailable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
      <LiveTelemetrySummary
        connected={connected}
        latestByNode={latestByNode}
        valveTimestamp={valveTimestamp}
      />

      {/* ── Hero CO₂ chart ── */}
      <Panel title="CO₂ inlet vs outlet" subtitle="Solid = Inlet · Dashed = Outlet">
        {hasData ? (
          <TimeSeriesChart
            timeWindow={historyWindow}
            height={320}
            yLabel="ppm"
            series={chartSeries.co2}
            thresholds={CO2_THRESHOLDS}
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
        {hasMeasurements(series.pressure.ps01, series.pressure.ps02) ? (
          <TimeSeriesChart
            timeWindow={historyWindow}
            height={280}
            yLabel="psi"
            series={chartSeries.pressure}
            thresholds={PRESSURE_THRESHOLDS}
          />
        ) : (
          <NoDataPlaceholder message="Waiting for pressure sensor data..." />
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* pH */}
        <Panel title="pH Level" subtitle="Neutral threshold = 7.0">
          {hasMeasurements(series.ph.inlet, series.ph.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
              yLabel="pH"
              series={chartSeries.ph}
              thresholds={PH_THRESHOLDS}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for pH data..." />
          )}
        </Panel>

        {/* Temperature */}
        <Panel title="Temperature" subtitle="Inlet solid · Outlet dashed">
          {hasMeasurements(series.temperature.inlet, series.temperature.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
              yLabel="°C"
              series={chartSeries.temperature}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for temperature data..." />
          )}
        </Panel>

        {/* Humidity */}
        <Panel title="Humidity" subtitle="Inlet solid · Outlet dashed">
          {hasMeasurements(series.humidity.inlet, series.humidity.outlet) ? (
            <TimeSeriesChart timeWindow={historyWindow} yLabel="%" series={chartSeries.humidity} />
          ) : (
            <NoDataPlaceholder message="Waiting for humidity data..." />
          )}
        </Panel>

        {/* PM2.5 */}
        <Panel title="PM2.5 Level" subtitle="Inlet vs Outlet">
          {hasMeasurements(series.pm25.inlet, series.pm25.outlet) ? (
            <TimeSeriesChart
              timeWindow={historyWindow}
              type="area"
              yLabel="µg/m³"
              series={chartSeries.pm25}
            />
          ) : (
            <NoDataPlaceholder message="Waiting for PM2.5 data..." />
          )}
        </Panel>

        {/* Flow rate */}
        <div className="lg:col-span-2">
          <Panel title="Flow rate" subtitle="Inlet vs Outlet">
            {hasMeasurements(series.flow.inlet, series.flow.outlet) ? (
              <TimeSeriesChart
                timeWindow={historyWindow}
                type="area"
                yLabel="L/min"
                series={chartSeries.flow}
              />
            ) : (
              <NoDataPlaceholder message="Waiting for flow rate data..." />
            )}
          </Panel>
        </div>
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

function LiveTelemetrySummary({
  connected,
  latestByNode,
  valveTimestamp,
}: {
  connected: boolean;
  latestByNode: Record<string, SocketReading>;
  valveTimestamp: number | null;
}) {
  // Isolate the 1-second clock tick here so charts don't re-render every second.
  const now = useNow();
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

  return (
    <>
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

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-border rounded-sm p-4 bg-card/30">
        <SensorHealthDot label="Inlet Node" lastSeen={healthTimes.inlet} now={now} />
        <SensorHealthDot label="Outlet Node" lastSeen={healthTimes.outlet} now={now} />
        <SensorHealthDot label="Solenoid Valves" lastSeen={healthTimes.solenoid_valves} now={now} />
      </section>
    </>
  );
}

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
          <AccordionTrigger>Alarm thresholds (read-only)</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 text-sm">
              <Row label="CO₂ warning (ppm)" value={THRESHOLDS.co2Warn} />
              <Row label="CO₂ danger (ppm)" value={THRESHOLDS.co2Danger} />
              <Row label="pH min" value={THRESHOLDS.phMin} />
              <Row label="pH max" value={THRESHOLDS.phMax} />
              <Row label="Pressure warn (psi)" value={THRESHOLDS.pressureWarn} />
              <Row label="Pressure max (psi)" value={THRESHOLDS.pressureMax} />
              <p className="text-xs text-muted-foreground pt-1">
                Thresholds are read-only in this release.
              </p>
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
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}
