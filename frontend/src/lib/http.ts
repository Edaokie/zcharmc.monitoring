// Browser HTTP uses the same-origin proxy. Session cookies are HttpOnly.
export const API_PROXY = "/backend";
let csrfToken: string | null = null;
let csrfRequest: Promise<void> | null = null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function setCsrfToken(token: string) {
  csrfToken = token;
}
async function ensureCsrf() {
  if (csrfToken) return;
  csrfRequest ??= fetch(`${API_PROXY}/api/auth/session`, {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) throw new ApiError(response.status, "Could not start a secure session.");
      const data = await response.json();
      if (typeof data.csrf_token !== "string") throw new Error("Invalid session response.");
      csrfToken = data.csrf_token;
    })
    .finally(() => {
      csrfRequest = null;
    });
  await csrfRequest;
}
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    await ensureCsrf();
    headers.set("X-CSRFToken", csrfToken!);
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_PROXY}${path}`, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data?.error ?? data?.detail ?? (data ? Object.values(data).flat().join(" ") : null);
    throw new ApiError(response.status, String(message || `Request failed (${response.status}).`));
  }
  return data as T;
}
