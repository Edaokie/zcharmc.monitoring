import { Circle, CircleDot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import type { ValveState } from "@/lib/mock-data";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface Props {
  valve: ValveState;
  isAdmin: boolean;
  onToggle?: (id: string) => void;
}

export function ValveStatusCard({ valve, isAdmin, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  const body = (
    <div
      className={cn(
        "border border-border rounded-sm p-4 flex flex-col gap-2 text-left w-full bg-card",
        isAdmin && "hover:bg-muted/40 transition-colors cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {valve.label}
        </span>
        {valve.open ? (
          <CircleDot className="h-4 w-4 text-foreground" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className={cn("text-lg font-semibold", valve.open ? "text-foreground" : "text-muted-foreground")}>
        {valve.open ? "Open" : "Closed"}
      </span>
      <span className="text-xs text-muted-foreground">
        Toggled {formatDistanceToNow(valve.lastToggled, { addSuffix: true })}
      </span>
    </div>
  );

  if (!isAdmin) return body;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button type="button" className="w-full">{body}</button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {valve.open ? "Close" : "Open"} {valve.label}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will actuate physical hardware. Confirm the operation is safe before proceeding.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onToggle?.(valve.id)}>
            Confirm {valve.open ? "close" : "open"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
