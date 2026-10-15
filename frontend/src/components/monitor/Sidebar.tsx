import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Bell, LogOut, Cpu } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/alerts", label: "Alerts", icon: Bell },
] as const;

export function Sidebar() {
  const { user, logout } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="w-14 sm:w-[220px] shrink-0 border-r border-border bg-background flex flex-col h-screen sticky top-0">
      <div className="p-3 sm:p-5 border-b border-border">
        <Cpu className="h-6 w-6 sm:hidden" aria-label="ZCharMC Monitor" />
        <div className="hidden sm:block font-semibold tracking-tight text-sm">ZCharMC Monitor</div>
        <div className="hidden sm:block text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
          CO2 adsorption
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {LINKS.map((l) => {
          const active = path.startsWith(l.to);
          const Icon = l.icon;
          return (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "flex items-center gap-3 px-2 sm:px-3 py-2 rounded-sm text-sm transition-colors",
                active
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{l.label}</span>
            </Link>
          );
        })}
        {user?.can_manage_firmware && (
          <Link
            to="/firmware"
            className={cn(
              "flex items-center gap-3 px-2 sm:px-3 py-2 rounded-sm text-sm",
              path.startsWith("/firmware")
                ? "bg-muted font-semibold"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <Cpu className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Firmware</span>
          </Link>
        )}
      </nav>

      <div className="p-1 sm:p-3 border-t border-border">
        {user && (
          <div className="flex items-center justify-between gap-2">
            <div className="hidden sm:block min-w-0">
              <div className="text-xs font-medium truncate">{user.name}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {user.role}
              </div>
            </div>
            <button
              onClick={() =>
                void logout().catch(() => toast.error("Sign out failed. Please try again."))
              }
              className="p-2 rounded-sm hover:bg-muted"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
