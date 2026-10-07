import { formatDistanceToNow } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { THRESHOLDS } from "@/lib/mock-data";
import { freshness } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

export function SensorHealthDot({
  label,
  lastSeen,
  now,
}: {
  label: string;
  lastSeen: number | null;
  now: number;
}) {
  const status = freshness(lastSeen, now, THRESHOLDS.offlineMs);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full border border-foreground",
                status === "Fresh" ? "bg-foreground" : "bg-transparent",
              )}
            />
            <span className="text-sm">
              {label} · {status}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {lastSeen == null
            ? "No telemetry received"
            : `Last measurement ${formatDistanceToNow(lastSeen, { addSuffix: true })}`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
