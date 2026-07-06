import { cn } from "@/lib/utils";

export function LevelGauge({ label, value }: { label: string; value: number }) {
  const low = value < 10;
  return (
    <div className="border border-border rounded-sm p-4 flex flex-col items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="relative w-16 h-32 border border-foreground rounded-sm overflow-hidden bg-background">
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-all",
            low ? "bg-amber-400" : "bg-neutral-800",
          )}
          style={{ height: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}%</span>
    </div>
  );
}
