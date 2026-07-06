import { formatDistanceToNow } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { THRESHOLDS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function SensorHealthDot({ label, lastSeen }: { label: string; lastSeen: number }) {
  const healthy = Date.now() - lastSeen < THRESHOLDS.offlineMs;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full border border-foreground",
                healthy ? "bg-foreground" : "bg-transparent",
              )}
            />
            <span className="text-sm">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          Last seen {formatDistanceToNow(lastSeen, { addSuffix: true })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
