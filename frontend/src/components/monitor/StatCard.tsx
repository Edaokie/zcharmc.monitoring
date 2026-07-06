import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  unit?: string;
  status?: "normal" | "warning" | "danger";
  hint?: string;
}

export function StatCard({ label, value, unit, status = "normal", hint }: Props) {
  return (
    <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        {status !== "normal" && (
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-sm uppercase tracking-wide",
              status === "warning" && "bg-amber-400 text-black",
              status === "danger" && "bg-red-600 text-white animate-pulse",
            )}
          >
            {status}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
