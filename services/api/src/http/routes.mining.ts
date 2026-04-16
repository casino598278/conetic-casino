import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { miningEngine } from "../game/miningEngine.js";
import { requireAuthHook } from "../auth/authPlugin.js";

const PlaceBetBody = z.object({
  amountNano: z.string().regex(/^\d+$/),
  clientSeedHex: z.string().length(32).regex(/^[0-9a-f]+$/),
});

export async function registerMiningRoutes(app: FastifyInstance) {
  app.post("/mining/bet", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = PlaceBetBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const r = miningEngine.placeBet({
      userId: req.user.sub,
      amountNano: BigInt(parsed.data.amountNano),
      clientSeedHex: parsed.data.clientSeedHex,
    });
    if (!r.ok) return reply.code(409).send({ error: r.error });
    return reply.send({ ok: true, snapshot: r.snapshot });
  });
}
