import type { FastifyInstance } from "fastify";

const ALLOWED_HOSTS = new Set([
  "t.me",
  "telegram.org",
  "telegram.me",
  "cdn1.telesco.pe",
  "cdn2.telesco.pe",
  "cdn3.telesco.pe",
  "cdn4.telesco.pe",
  "cdn5.telesco.pe",
]);

// Tiny LRU — Telegram avatars are small (~30KB) and reused across multiple
// users in a round, so caching them server-side saves CDN hits + latency.
interface CachedAvatar {
  buf: Buffer;
  contentType: string;
  expiresAt: number;
}
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 200;
const cache = new Map<string, CachedAvatar>();

function cacheGet(key: string): CachedAvatar | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // LRU: re-insert to mark as most-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: CachedAvatar) {
  if (cache.size >= CACHE_MAX) {
    // evict oldest
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

export async function registerAvatarRoutes(app: FastifyInstance) {
  app.get("/avatar", async (req, reply) => {
    const q = req.query as { url?: string };
    if (!q.url) return reply.code(400).send({ error: "missing url" });
    let parsed: URL;
    try { parsed = new URL(q.url); }
    catch { return reply.code(400).send({ error: "bad url" }); }

    const hostOk =
      ALLOWED_HOSTS.has(parsed.host) ||
      [...ALLOWED_HOSTS].some((h) => parsed.host.endsWith("." + h) || parsed.host === h);
    if (!hostOk) return reply.code(403).send({ error: "host not allowed" });

    const cacheKey = parsed.toString();
    const hit = cacheGet(cacheKey);
    if (hit) {
      reply
        .header("content-type", hit.contentType)
        .header("cache-control", "public, max-age=86400")
        .header("x-cache", "HIT")
        .header("access-control-allow-origin", "*");
      return reply.send(hit.buf);
    }

    try {
      const upstream = await fetch(parsed.toString(), {
        headers: { "user-agent": "ConeticCasino/1.0" },
      });
      if (!upstream.ok) return reply.code(upstream.status).send({ error: "upstream failed" });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
      cacheSet(cacheKey, { buf, contentType, expiresAt: Date.now() + CACHE_TTL_MS });
      reply
        .header("content-type", contentType)
        .header("cache-control", "public, max-age=86400")
        .header("x-cache", "MISS")
        .header("access-control-allow-origin", "*");
      return reply.send(buf);
    } catch (err: any) {
      return reply.code(502).send({ error: "fetch failed", detail: err?.message });
    }
  });
}
