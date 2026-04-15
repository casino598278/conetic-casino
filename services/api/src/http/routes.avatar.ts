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

/**
 * /avatar?url=<encoded url> — proxy Telegram avatar images so the browser can
 * render them inside <canvas> without CORS errors.
 */
export async function registerAvatarRoutes(app: FastifyInstance) {
  app.get("/avatar", async (req, reply) => {
    const q = req.query as { url?: string };
    if (!q.url) return reply.code(400).send({ error: "missing url" });
    let parsed: URL;
    try {
      parsed = new URL(q.url);
    } catch {
      return reply.code(400).send({ error: "bad url" });
    }
    const hostOk =
      ALLOWED_HOSTS.has(parsed.host) ||
      [...ALLOWED_HOSTS].some((h) => parsed.host.endsWith("." + h) || parsed.host === h);
    if (!hostOk) return reply.code(403).send({ error: "host not allowed" });

    try {
      const upstream = await fetch(parsed.toString(), {
        headers: { "user-agent": "ConeticCasino/1.0" },
      });
      if (!upstream.ok) return reply.code(upstream.status).send({ error: "upstream failed" });
      const buf = Buffer.from(await upstream.arrayBuffer());
      reply
        .header("content-type", upstream.headers.get("content-type") ?? "image/jpeg")
        .header("cache-control", "public, max-age=86400")
        .header("access-control-allow-origin", "*");
      return reply.send(buf);
    } catch (err: any) {
      return reply.code(502).send({ error: "fetch failed", detail: err?.message });
    }
  });
}
