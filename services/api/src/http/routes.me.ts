import type { FastifyInstance } from "fastify";
import { MeResponse } from "@conetic/shared";
import { getUserById } from "../db/repo/users.js";
import { getBalanceNano } from "../db/repo/ledger.js";
import { requireAuth } from "../auth/authPlugin.js";

export async function registerMeRoutes(app: FastifyInstance) {
  app.register(async (scoped) => {
    await scoped.register(requireAuth);
    scoped.get("/me", async (req, reply) => {
      const user = getUserById(req.user!.sub);
      if (!user) return reply.code(404).send({ error: "user not found" });
      const balance = getBalanceNano(user.id);
      return reply.send(
        MeResponse.parse({
          id: user.id,
          tgId: user.tg_id,
          username: user.username,
          firstName: user.first_name,
          photoUrl: user.photo_url,
          balanceNano: balance.toString(),
        }),
      );
    });
  });
}
