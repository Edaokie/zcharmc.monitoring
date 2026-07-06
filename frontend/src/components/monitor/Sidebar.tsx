import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Bell, LogOut } from "lucide-react";
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
    <aside className="w-[220px] shrink-0 border-r border-border bg-background flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-border">
        <div className="font-semibold tracking-tight text-sm">ZCharMC Monitor</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
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
                "flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors",
                active
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        {user && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{user.name}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {user.role}
              </div>
            </div>
            <button
              onClick={logout}
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
