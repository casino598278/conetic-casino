import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { engine } from "../game/engine.js";
import { requireAuth } from "../auth/authPlugin.js";

const PlaceBetBody = z.object({
  amountNano: z.string().regex(/^\d+$/),
  clientSeedHex: z.string().length(32).regex(/^[0-9a-f]+$/),
});

export async function registerBetRoutes(app: FastifyInstance) {
  app.register(async (scoped) => {
    await scoped.register(requireAuth);
    scoped.post("/bet", async (req, reply) => {
      const parsed = PlaceBetBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "bad request" });
      const r = engine.placeBet({
        userId: req.user!.sub,
        amountNano: BigInt(parsed.data.amountNano),
        clientSeedHex: parsed.data.clientSeedHex,
      });
      if (!r.ok) return reply.code(409).send({ error: r.error });
      return reply.send({ ok: true, snapshot: r.snapshot });
    });
  });
}
