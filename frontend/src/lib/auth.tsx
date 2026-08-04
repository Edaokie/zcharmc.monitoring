import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "admin" | "client";
export interface User {
  email: string;
  name: string;
  role: Role;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  ready: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "zcharmc.auth";
const EMAIL_DOMAIN = /@myiit\.edu\.ph$/i;

// NOTE: In production, replace this mock with the Flask `/api/auth/login` call and
// store the token via httpOnly cookie set by the server. Never persist raw JWTs in
// localStorage. This mock is for UI wiring only.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore
    }
    setReady(true);
  }, []);

  const login: AuthContextValue["login"] = async (email, password) => {
    if (!EMAIL_DOMAIN.test(email)) {
      return { ok: false, error: "Email must be a @myiit.edu.ph address." };
    }
    if (!password || password.length < 4) {
      return { ok: false, error: "Invalid credentials." };
    }
    await new Promise((r) => setTimeout(r, 600));
    // Mock role assignment: emails containing "admin" get admin role.
    const role: Role = /admin/i.test(email) ? "admin" : "client";
    const u: User = { email, name: email.split("@")[0], role };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    return { ok: true };
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, ready }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
