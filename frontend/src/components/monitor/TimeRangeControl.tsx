import { cn } from "@/lib/utils";

export type TimeRange = "realtime" | "1m" | "1h" | "6h" | "24h";
const OPTIONS: { id: TimeRange; label: string }[] = [
  { id: "realtime", label: "Realtime" },
  { id: "1m", label: "1 min" },
  { id: "1h", label: "1 hr" },
  { id: "6h", label: "6 hr" },
  { id: "24h", label: "24 hr" },
];

export function TimeRangeControl({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  return (
    <div className="inline-flex border border-border rounded-sm overflow-hidden">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors border-r border-border last:border-r-0",
            value === o.id
              ? "bg-foreground text-background"
              : "bg-background text-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
