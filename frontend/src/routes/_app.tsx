import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/monitor/Sidebar";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: () => (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  ),
});

function Gate() {
  const { user, ready, error, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && !user && !error) navigate({ to: "/auth", replace: true });
  }, [ready, user, error, navigate]);

  if (error)
    return (
      <main className="p-8">
        <p role="alert">{error}</p>
        <button className="underline mt-3" onClick={() => void refresh()}>
          Retry
        </button>
      </main>
    );

  if (!ready || !user) return null;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
