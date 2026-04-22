import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  playDice,
  diceMultiplier,
  diceWinChance,
  validateDiceParams,
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
  playLimbo,
  limboMultiplier,
  limboWinChance,
  validateLimboParams,
  LIMBO_MIN_TARGET,
  LIMBO_MAX_TARGET,
  playKeno,
  kenoMultiplier,
  kenoMaxMultiplier,
  validateKenoParams,
  KENO_GRID,
  KENO_MIN_PICKS,
  KENO_MAX_PICKS,
  type KenoRisk,
  playCosmicLines,
  cosmicMultiplier,
  validateCosmicParams,
  playFruitStorm,
  fruitStormMultiplier,
  validateFruitStormParams,
  playGemClusters,
  gemClustersMultiplier,
  validateGemClustersParams,
  playLuckySevens,
  luckySevensMultiplier,
  validateLuckySevensParams,
  SLOT_VARIANTS,
  type SlotVariant,
} from "@conetic/shared";
import { requireAuthHook } from "../auth/authPlugin.js";
import { playHouseGame, publicSeedState, maxWinTon } from "../game/houseGameEngine.js";
import {
  getOrCreateSeeds,
  rotateSeeds,
  setClientSeed,
  getRecentPlays,
} from "../db/repo/houseGames.js";

const PlayBody = z.object({
  amountNano: z.string().regex(/^\d+$/),
});

const DicePlayBody = PlayBody.extend({
  target: z.number().min(DICE_MIN_TARGET).max(DICE_MAX_TARGET),
  over: z.boolean(),
});

const LimboPlayBody = PlayBody.extend({
  target: z.number().min(LIMBO_MIN_TARGET).max(LIMBO_MAX_TARGET),
});

const KenoPlayBody = PlayBody.extend({
  risk: z.enum(["low", "classic", "medium", "high"]),
  picks: z.array(z.number().int().min(0).max(KENO_GRID - 1))
    .min(KENO_MIN_PICKS).max(KENO_MAX_PICKS),
});

/** All four slot variants share the same bet shape (stake + empty-params
 *  object) so one schema covers them. Variant-specific params go inside
 *  `params` and are validated by each variant's own `validate…` function. */
const SlotPlayBody = PlayBody.extend({
  params: z.record(z.unknown()).optional(),
});

const RotateBody = z.object({
  clientSeedHex: z.string().length(32).regex(/^[0-9a-f]+$/).optional(),
});

const SetClientBody = z.object({
  clientSeedHex: z.string().length(32).regex(/^[0-9a-f]+$/),
});

export async function registerSingleRoutes(app: FastifyInstance) {
  app.get("/single/seed", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const seeds = getOrCreateSeeds(req.user.sub);
    return reply.send(publicSeedState(seeds));
  });

  app.post("/single/seed/rotate", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = RotateBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const rotated = rotateSeeds(req.user.sub, parsed.data.clientSeedHex);
    return reply.send({
      ...publicSeedState(rotated),
      revealedServerSeedHex: rotated.previous_server_seed_hex,
    });
  });

  app.post("/single/seed/client", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = SetClientBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const seeds = setClientSeed(req.user.sub, parsed.data.clientSeedHex);
    return reply.send(publicSeedState(seeds));
  });

  app.get("/single/limits", async () => {
    return { maxWinTon: maxWinTon() };
  });

  app.get("/single/history", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const q = req.query as { game?: string; limit?: string } | undefined;
    const limit = Math.min(200, Math.max(1, parseInt(q?.limit ?? "50", 10) || 50));
    const rows = getRecentPlays(req.user.sub, limit, q?.game);
    return reply.send({
      plays: rows.map((r) => ({
        id: r.id,
        game: r.game,
        betNano: r.bet_nano,
        payoutNano: r.payout_nano,
        multiplier: r.multiplier,
        params: JSON.parse(r.params_json),
        outcome: JSON.parse(r.outcome_json),
        serverSeedHex: r.server_seed_hex,
        serverSeedHash: r.server_seed_hash,
        clientSeedHex: r.client_seed_hex,
        nonce: r.nonce,
        createdAt: r.created_at,
      })),
    });
  });

  app.post("/single/dice/play", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = DicePlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const params = { target: parsed.data.target, over: parsed.data.over };
    const mult = diceMultiplier(params);
    const chance = diceWinChance(params);
    const result = await playHouseGame({
      userId: req.user.sub,
      game: "dice",
      betNano: BigInt(parsed.data.amountNano),
      params,
      validate: validateDiceParams,
      compute: async ({ serverSeedHex, clientSeedHex, nonce, params: p }) => {
        const outcome = await playDice(serverSeedHex, clientSeedHex, nonce, p);
        return {
          outcome,
          multiplier: outcome.win ? mult : 0,
          maxMultiplier: mult,
        };
      },
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, meta: result.meta });
    return reply.send({
      ok: true,
      outcome: result.outcome,
      multiplier: result.multiplier,
      winChance: chance,
      betNano: result.betNano,
      payoutNano: result.payoutNano,
      newBalanceNano: result.newBalanceNano,
      nonce: result.nonce,
      serverSeedHash: result.serverSeedHash,
      clientSeedHex: result.clientSeedHex,
      playId: result.playId,
    });
  });

  app.post("/single/limbo/play", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = LimboPlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const params = { target: parsed.data.target };
    const mult = limboMultiplier(params);
    const chance = limboWinChance(params);
    const result = await playHouseGame({
      userId: req.user.sub,
      game: "limbo",
      betNano: BigInt(parsed.data.amountNano),
      params,
      validate: validateLimboParams,
      compute: async ({ serverSeedHex, clientSeedHex, nonce, params: p }) => {
        const outcome = await playLimbo(serverSeedHex, clientSeedHex, nonce, p);
        return {
          outcome,
          multiplier: outcome.win ? mult : 0,
          maxMultiplier: mult,
        };
      },
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, meta: result.meta });
    return reply.send({
      ok: true,
      outcome: result.outcome,
      multiplier: result.multiplier,
      winChance: chance,
      betNano: result.betNano,
      payoutNano: result.payoutNano,
      newBalanceNano: result.newBalanceNano,
      nonce: result.nonce,
      serverSeedHash: result.serverSeedHash,
      clientSeedHex: result.clientSeedHex,
      playId: result.playId,
    });
  });

  app.post("/single/keno/play", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = KenoPlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const risk = parsed.data.risk as KenoRisk;
    const picks = parsed.data.picks;
    // Dedupe defensively — zod min/max already covers length but not uniqueness.
    const uniquePicks = Array.from(new Set(picks));
    if (uniquePicks.length !== picks.length) {
      return reply.code(400).send({ error: "invalid_params" });
    }
    const params = { risk, picks: uniquePicks };
    const maxMult = kenoMaxMultiplier(risk, uniquePicks.length);
    const result = await playHouseGame({
      userId: req.user.sub,
      game: "keno",
      betNano: BigInt(parsed.data.amountNano),
      params,
      validate: validateKenoParams,
      compute: async ({ serverSeedHex, clientSeedHex, nonce, params: p }) => {
        const outcome = await playKeno(serverSeedHex, clientSeedHex, nonce, p);
        const m = kenoMultiplier(p.risk, p.picks.length, outcome.hits);
        return {
          outcome,
          multiplier: m,
          maxMultiplier: maxMult,
        };
      },
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, meta: result.meta });
    return reply.send({
      ok: true,
      outcome: result.outcome,
      multiplier: result.multiplier,
      betNano: result.betNano,
      payoutNano: result.payoutNano,
      newBalanceNano: result.newBalanceNano,
      nonce: result.nonce,
      serverSeedHash: result.serverSeedHash,
      clientSeedHex: result.clientSeedHex,
      playId: result.playId,
    });
  });

  // Slots — four variants share one route `/single/slots/:variant/play`.
  // Variant table wires each to (play function, multiplier extractor, validator).
  type SlotHandler = {
    play: (s: string, c: string, n: number, p: any) => Promise<any>;
    multiplier: (o: any) => number;
    validate: (p: unknown) => boolean;
  };
  const slotHandlers: Record<SlotVariant, SlotHandler> = {
    cosmicLines: {
      play: playCosmicLines,
      multiplier: cosmicMultiplier,
      validate: validateCosmicParams,
    },
    fruitStorm: {
      play: playFruitStorm,
      multiplier: fruitStormMultiplier,
      validate: validateFruitStormParams,
    },
    gemClusters: {
      play: playGemClusters,
      multiplier: gemClustersMultiplier,
      validate: validateGemClustersParams,
    },
    luckySevens: {
      play: playLuckySevens,
      multiplier: luckySevensMultiplier,
      validate: validateLuckySevensParams,
    },
  };

  app.post("/single/slots/:variant/play", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const { variant } = req.params as { variant: string };
    if (!(SLOT_VARIANTS as readonly string[]).includes(variant)) {
      return reply.code(404).send({ error: "unknown_slot" });
    }
    const handler = slotHandlers[variant as SlotVariant];
    const parsed = SlotPlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const params = (parsed.data.params ?? {}) as Record<string, unknown>;
    if (!handler.validate(params)) {
      return reply.code(400).send({ error: "invalid_params" });
    }
    const result = await playHouseGame({
      userId: req.user.sub,
      game: `slots:${variant}`,
      betNano: BigInt(parsed.data.amountNano),
      params,
      validate: handler.validate as (p: unknown) => p is typeof params,
      compute: async ({ serverSeedHex, clientSeedHex, nonce, params: p }) => {
        const outcome = await handler.play(serverSeedHex, clientSeedHex, nonce, p);
        const m = handler.multiplier(outcome);
        return { outcome, multiplier: m, maxMultiplier: m };
      },
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, meta: result.meta });
    return reply.send({
      ok: true,
      variant,
      outcome: result.outcome,
      multiplier: result.multiplier,
      betNano: result.betNano,
      payoutNano: result.payoutNano,
      newBalanceNano: result.newBalanceNano,
      nonce: result.nonce,
      serverSeedHash: result.serverSeedHash,
      clientSeedHex: result.clientSeedHex,
      playId: result.playId,
    });
  });

}
