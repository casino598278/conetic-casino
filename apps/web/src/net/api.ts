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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  // Retry on 502/503 (deploy in progress) up to 3 times with short backoff.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api${path}`, { ...init, headers });
      if (res.status === 502 || res.status === 503) {
        lastErr = new Error(`API ${path}: ${res.status}`);
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${path} failed: ${res.status} ${text}`);
      }
      return (await res.json()) as T;
    } catch (err: any) {
      if (err?.message?.includes("502") || err?.message?.includes("503")) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`API ${path} failed after retries`);
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
