// Public TON→USD price endpoint, cached 60 s so a spam of client calls doesn't
// hammer CoinGecko. No auth required — rate is not user-specific.
//
// Strategy: fetch once per minute from CoinGecko's free simple-price endpoint.
// If the fetch fails, serve the last-good cached value with its stale timestamp
// so the client can render something instead of flashing "—".
//
// Security: we do not forward any client data to CoinGecko; one server-side
// poll per minute, response size is a few bytes.

import type { FastifyInstance } from "fastify";

interface PriceCache {
  usdPerTon: number;
  fetchedAt: number;
  stale: boolean;
}

const CACHE_TTL_MS = 60_000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd";

let cache: PriceCache | null = null;
let inflight: Promise<void> | null = null;

async function refreshCache(): Promise<void> {
  // De-dupe concurrent refresh attempts; they all await the same promise.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(COINGECKO_URL, {
        // Fail fast if CoinGecko is slow so we don't stall /api/price responses.
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const data = (await res.json()) as { "the-open-network"?: { usd?: number } };
      const usd = data["the-open-network"]?.usd;
      if (typeof usd !== "number" || usd <= 0) throw new Error("bad response shape");
      cache = { usdPerTon: usd, fetchedAt: Date.now(), stale: false };
    } catch (err) {
      // Preserve last-good value on error; mark it stale so the client knows.
      if (cache) cache.stale = true;
      else {
        // First call + failure: fall back to a conservative static rate so
        // the UI still renders *something*. 2.5 USD/TON is a reasonable baseline.
        cache = { usdPerTon: 2.5, fetchedAt: Date.now(), stale: true };
      }
      console.warn("[price] CoinGecko refresh failed:", (err as Error).message);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function registerPriceRoutes(app: FastifyInstance) {
  // Warm the cache at boot so the first request doesn't wait.
  refreshCache().catch(() => { /* already logged inside */ });

  app.get("/price", async () => {
    const now = Date.now();
    if (!cache || now - cache.fetchedAt >= CACHE_TTL_MS) {
      await refreshCache();
    }
    const c = cache!;
    return {
      usdPerTon: c.usdPerTon,
      fetchedAt: c.fetchedAt,
      stale: c.stale,
    };
  });
}
