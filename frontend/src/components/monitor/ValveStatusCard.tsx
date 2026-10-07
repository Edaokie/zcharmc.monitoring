import { Circle, CircleDot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ValveState } from "@/lib/mock-data";

export function ValveStatusCard({ valve }: { valve: ValveState }) {
  return (
    <div className="border border-border rounded-sm p-4 flex flex-col gap-2 text-left w-full bg-card">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{valve.label}</span>
        {valve.open === true ? (
          <CircleDot className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className="text-lg font-semibold">
        {valve.open == null ? "No data" : valve.open ? "Open" : "Closed"}
      </span>
      <span className="text-xs text-muted-foreground">
        {valve.lastReported == null
          ? "No telemetry received"
          : `Reported ${formatDistanceToNow(valve.lastReported, { addSuffix: true })}`}
      </span>
      <span className="text-xs text-muted-foreground">Control unavailable</span>
    </div>
  );
}
