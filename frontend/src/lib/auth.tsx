import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, setCsrfToken } from "./http";

export type Role = "admin" | "client";
export interface User {
  email: string;
  name: string;
  role: Role;
  username: string;
  can_manage_firmware: boolean;
}

interface AuthContextValue {
  user: User | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  error: string | null;
  ready: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
interface SessionResponse {
  user: User | null;
  csrf_token: string;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const session = await apiRequest<SessionResponse>("/api/auth/session");
      setCsrfToken(session.csrf_token);
      setUser(session.user);
    } catch {
      setUser(null);
      setError("The account service is unavailable. Check the connection and try again.");
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem("zcharmc.auth");
    } catch {
      /* Storage restrictions do not prevent session login. */
    }
    void refresh();
  }, [refresh]);

  const login: AuthContextValue["login"] = async (username, password) => {
    try {
      const session = await apiRequest<SessionResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setCsrfToken(session.csrf_token);
      setUser(session.user);
      setError(null);
      return { ok: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : "Sign in failed." };
    }
  };

  const logout = async () => {
    const session = await apiRequest<SessionResponse>("/api/auth/logout", { method: "POST" });
    setCsrfToken(session.csrf_token);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, ready, refresh, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
