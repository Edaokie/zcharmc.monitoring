import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: () => (
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  ),
});

function LoginPage() {
  const { login, error, refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (!res.ok) {
      setErr(res.error ?? "Invalid credentials.");
      return;
    }
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="relative min-h-screen w-full bg-background flex items-center justify-center px-4 overflow-hidden">
      <BackgroundMotif />
      <div className="relative z-10 w-full max-w-[400px] border border-border bg-card rounded-sm p-8">
        <div className="mb-8">
          <div className="text-lg font-semibold tracking-tight">ZCharMC Monitor</div>
          <div className="text-xs text-muted-foreground mt-1">
            Real-time CO2 adsorption monitoring
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="username"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Django username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your account username"
              className="w-full border border-border rounded-sm px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                autoComplete="current-password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-border rounded-sm px-3 py-2 pr-9 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Ask the system administrator to create or recover your account.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}{" "}
              <button type="button" className="underline" onClick={() => void refresh()}>
                Retry connection
              </button>
            </p>
          )}

          {err && (
            <div
              role="alert"
              className="text-xs text-red-600 border border-red-600/40 bg-red-600/5 rounded-sm px-3 py-2"
            >
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-foreground text-background text-sm font-medium py-2.5 rounded-sm hover:bg-foreground/90 disabled:bg-neutral-300 disabled:text-neutral-500 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-[10px] text-muted-foreground leading-relaxed">
          Use an account registered in Django. Firmware controls require staff permissions.
        </p>
      </div>
    </div>
  );
}

function BackgroundMotif() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.04] pointer-events-none"
      viewBox="0 0 1200 800"
      preserveAspectRatio="none"
    >
      <path
        d="M0 600 L100 580 L200 560 L300 480 L400 520 L500 400 L600 440 L700 320 L800 380 L900 260 L1000 300 L1100 200 L1200 240"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M0 700 L100 680 L200 650 L300 620 L400 580 L500 540 L600 510 L700 470 L800 450 L900 400 L1000 380 L1100 340 L1200 320"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
        strokeDasharray="4 4"
      />
    </svg>
  );
}
