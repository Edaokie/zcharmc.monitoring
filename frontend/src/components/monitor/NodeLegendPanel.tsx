import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { THRESHOLDS } from "@/lib/mock-data";
import type { ValveState } from "@/hooks/useSocket";

// Color tokens — must match TimeSeriesChart.tsx seriesColors
const NODE_COLORS = {
  inlet: "#ef4444",   // red
  outlet: "#eab308",  // yellow
  valve: "#6b7280",   // gray
} as const;

interface NodeRowProps {
  label: string;
  color: string;
  lastSeen: number;
  connected: boolean;
}

function NodeRow({ label, color, lastSeen, connected }: NodeRowProps) {
  const hasData = lastSeen > 0;
  const online = hasData && connected && Date.now() - lastSeen < THRESHOLDS.offlineMs;

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-2.5">
        {/* Color-coded dot with pulse animation when online */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {online && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
              style={{ backgroundColor: color }}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full border",
              online ? "border-transparent" : "border-current bg-transparent",
            )}
            style={online ? { backgroundColor: color } : { color }}
          />
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>

      <div className="text-right">
        <div
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wide",
            online ? "text-green-600" : hasData ? "text-red-500" : "text-muted-foreground",
          )}
        >
          {!connected ? "No WS" : online ? "Online" : hasData ? "Offline" : "Waiting"}
        </div>
        {hasData && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {formatDistanceToNow(lastSeen, { addSuffix: true })}
          </div>
        )}
      </div>
    </div>
  );
}

interface ValveRowProps {
  valve: ValveState;
}

function ValveRow({ valve }: ValveRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{valve.label}</span>
      <span
        className={cn(
          "text-[10px] font-semibold px-1.5 py-0.5 rounded-sm",
          valve.open
            ? "bg-green-500/10 text-green-600"
            : "bg-muted text-muted-foreground",
        )}
      >
        {valve.open ? "Open" : "Closed"}
      </span>
    </div>
  );
}

interface Props {
  healthTimes: {
    inlet: number;
    outlet: number;
    solenoid_valves: number;
  };
  valves: ValveState[];
  connected: boolean;
}

export function NodeLegendPanel({ healthTimes, valves, connected }: Props) {
  return (
    <aside className="w-[220px] shrink-0 sticky top-8 self-start space-y-4">

      {/* ── Color key ─────────────────────────────── */}
      <section className="border border-border rounded-sm bg-card p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Legend
        </h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: NODE_COLORS.inlet }} />
            <span className="text-xs">Inlet</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: NODE_COLORS.outlet }} />
            <span className="text-xs">Outlet</span>
          </div>
          <div className="flex items-center gap-2.5 mt-1 pt-1 border-t border-border/60">
            <span className="h-px w-6 border-t border-foreground/50 shrink-0" />
            <span className="text-xs text-muted-foreground">Solid = Inlet</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="h-px w-6 border-t border-dashed border-foreground/50 shrink-0" />
            <span className="text-xs text-muted-foreground">Dashed = Outlet</span>
          </div>
        </div>
      </section>

      {/* ── Node status ───────────────────────────── */}
      <section className="border border-border rounded-sm bg-card p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Node status
        </h2>
        <NodeRow
          label="Inlet"
          color={NODE_COLORS.inlet}
          lastSeen={healthTimes.inlet}
          connected={connected}
        />
        <NodeRow
          label="Outlet"
          color={NODE_COLORS.outlet}
          lastSeen={healthTimes.outlet}
          connected={connected}
        />
        <NodeRow
          label="Solenoid valves"
          color={NODE_COLORS.valve}
          lastSeen={healthTimes.solenoid_valves}
          connected={connected}
        />
      </section>

      {/* ── Valve states ──────────────────────────── */}
      {valves.length > 0 && (
        <section className="border border-border rounded-sm bg-card p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            Valve states
          </h2>
          {valves.map((v) => (
            <ValveRow key={v.id} valve={v} />
          ))}
        </section>
      )}
    </aside>
  );
}
