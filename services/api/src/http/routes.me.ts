import type { FastifyInstance } from "fastify";
import { MeResponse } from "@conetic/shared";
import { getUserById, setAnonMode } from "../db/repo/users.js";
import { getBalanceNano } from "../db/repo/ledger.js";
import { getLeaderboard, secondsUntilReset } from "../db/repo/leaderboard.js";
import { requireAuthHook } from "../auth/authPlugin.js";

export async function registerMeRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const user = getUserById(req.user.sub);
    if (!user) return reply.code(404).send({ error: "user not found" });
    const balance = getBalanceNano(user.id);
    return reply.send({
      ...MeResponse.parse({
        id: user.id,
        tgId: user.tg_id,
        username: user.username,
        firstName: user.first_name,
        photoUrl: user.photo_url,
        balanceNano: balance.toString(),
      }),
      anonMode: !!user.anon_mode,
      anonName: user.anon_name,
    });
  });

  app.post("/me/anon", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const body = req.body as { enabled?: boolean } | null;
    const enabled = body?.enabled ?? true;
    const user = setAnonMode(req.user.sub, enabled);
    return reply.send({ anonMode: !!user.anon_mode, anonName: user.anon_name });
  });

  app.get("/leaderboard", async () => {
    const entries = getLeaderboard(20);
    const resetIn = secondsUntilReset();
    return { entries, resetInSeconds: resetIn };
  });
}
