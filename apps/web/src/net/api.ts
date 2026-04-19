const TOKEN_KEY = "conetic.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Thrown on non-2xx responses. `code` is the server's `error` field (e.g.
 *  "insufficient_balance") when available, otherwise the HTTP status. */
export class ApiError extends Error {
  code: string;
  status: number;
  meta?: Record<string, unknown>;
  constructor(message: string, code: string, status: number, meta?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

async function parseErrorBody(res: Response, path: string): Promise<ApiError> {
  const status = res.status;
  let code = `http_${status}`;
  let meta: Record<string, unknown> | undefined;
  try {
    const text = await res.text();
    if (text) {
      try {
        const j = JSON.parse(text) as { error?: string; meta?: Record<string, unknown> };
        if (typeof j.error === "string") code = j.error;
        if (j.meta) meta = j.meta;
      } catch {
        /* non-JSON body, keep http_<status> code */
      }
    }
  } catch {
    /* no body */
  }
  return new ApiError(`${path} → ${code}`, code, status, meta);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  // Retry only transient infra failures (502/503 during a deploy).
  // Never retry a 4xx — a 409 insufficient_balance replay would be a bug.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api${path}`, { ...init, headers });
      if (res.status === 502 || res.status === 503) {
        lastErr = new ApiError(`${path} → ${res.status}`, `http_${res.status}`, res.status);
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
        continue;
      }
      if (!res.ok) throw await parseErrorBody(res, path);
      return (await res.json()) as T;
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 502 || err.status === 503)) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new ApiError(`${path} failed after retries`, "retries_exhausted", 0);
}

export async function login(initData: string): Promise<{ token: string; user: any }> {
  const res = await fetch("/api/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  const body = await res.json();
  setToken(body.token);
  return body;
}
