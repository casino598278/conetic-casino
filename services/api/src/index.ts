import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import compress from "@fastify/compress";
import { config } from "./config.js";
import { runMigrations } from "./db/sqlite.js";
import { ensureHouseUser } from "./db/repo/users.js";
import { registerAuthRoutes } from "./http/routes.auth.js";
import { registerMeRoutes } from "./http/routes.me.js";
import { registerBetRoutes } from "./http/routes.bet.js";
import { registerWalletRoutes } from "./http/routes.wallet.js";
import { registerRoundRoutes } from "./http/routes.rounds.js";
import { registerAvatarRoutes } from "./http/routes.avatar.js";
import { registerMiningRoutes } from "./http/routes.mining.js";
import { engine } from "./game/engine.js";
import { miningEngine } from "./game/miningEngine.js";
import { attachGateway } from "./ws/gateway.js";
import { startTonWatcher, stopTonWatcher } from "./wallet/ton/watcher.js";
import { startTonSender, stopTonSender } from "./wallet/ton/sender.js";
import { startBot } from "./bot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  runMigrations();
  ensureHouseUser();

  const app = Fastify({
    logger: config.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } }
      : true,
    bodyLimit: 16384, // 16KB max request body
  });

  // CORS: exact-match only. Same-origin (no header) always allowed.
  const allowedOrigins = new Set(
    [
      config.CORS_ORIGIN,
      config.PUBLIC_WEB_URL,
      "https://web.telegram.org",
      "https://desktop.telegram.org",
    ].filter(Boolean),
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute",
  });
  // gzip/brotli for static + API JSON (PixiJS bundle ~580KB → ~180KB compressed)
  await app.register(compress, { global: true, encodings: ["gzip", "deflate"] });

  // Build version: changes every restart, so the frontend can detect new deploys.
  const BUILD_ID = process.env.RENDER_GIT_COMMIT?.slice(0, 8) ?? Date.now().toString();

  app.get("/health", async () => ({ ok: true, env: config.NODE_ENV, ton: config.TON_NETWORK }));

  // API routes are namespaced under /api so the static frontend can own /.
  await app.register(
    async (api) => {
      api.get("/version", async () => ({ buildId: BUILD_ID }));
      await registerAuthRoutes(api);
      await registerMeRoutes(api);
      await registerBetRoutes(api);
      await registerWalletRoutes(api);
      await registerRoundRoutes(api);
      await registerAvatarRoutes(api);
      await registerMiningRoutes(api);
    },
    { prefix: "/api" },
  );

  attachGateway(app);

  // Serve the built frontend (apps/web/dist) when it exists.
  // In production this is the SAME process that serves the API + WS.
  const candidatePaths = [
    resolve(__dirname, "../../../apps/web/dist"),  // tsx dev (src/index.ts)
    resolve(__dirname, "../../apps/web/dist"),     // built dist/index.js
    resolve(process.cwd(), "apps/web/dist"),        // when started from repo root
    resolve(process.cwd(), "../../apps/web/dist"),  // when started from services/api
  ];
  const webRoot = candidatePaths.find((p) => existsSync(p));
  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/", wildcard: false });
    // SPA fallback: any non-API path returns index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/socket.io") || req.url.startsWith("/health")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
    app.log.info(`serving static frontend from ${webRoot}`);
  } else {
    app.log.warn(`no web build found — checked: ${candidatePaths.join(", ")}`);
  }

  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
  app.log.info(`API listening on :${config.API_PORT}`);

  engine.start();
  miningEngine.start();
  startTonWatcher();
  startTonSender();
  startBot();

  const shutdown = async () => {
    app.log.info("shutting down");
    engine.stop();
    miningEngine.stop();
    stopTonWatcher();
    stopTonSender();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
