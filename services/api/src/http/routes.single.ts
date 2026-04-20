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
  playSwashBooze,
  swashBoozeMaxMultiplier,
  swashBoozeStakeMultiplier,
  validateSwashBoozeParams,
  type SwashBoozeParams,
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

const SwashPlayBody = PlayBody.extend({
  mode: z.enum(["spin", "buy"]),
  ante: z.boolean().optional(),
});

const KenoPlayBody = PlayBody.extend({
  risk: z.enum(["low", "classic", "medium", "high"]),
  picks: z.array(z.number().int().min(0).max(KENO_GRID - 1))
    .min(KENO_MIN_PICKS).max(KENO_MAX_PICKS),
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

  app.post("/single/swashbooze/play", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = SwashPlayBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    const params: SwashBoozeParams = {
      mode: parsed.data.mode,
      ante: parsed.data.ante ?? false,
    };

    // Ante bet + bonus buy are mutually exclusive.
    if (params.mode === "buy" && params.ante) {
      return reply.code(400).send({ error: "ante_disabled_with_buy" });
    }

    // Stake multiplier: 1× normal, 1.25× with ante, 100× on buy. Charged
    // server-side so the client just sends its base bet regardless of mode.
    const baseBetNano = BigInt(parsed.data.amountNano);
    const stakeMult = swashBoozeStakeMultiplier(params);
    // Use 10_000-scaled integer math so 1.25× stays exact.
    const scaledMult = BigInt(Math.round(stakeMult * 10_000));
    const effectiveStake = (baseBetNano * scaledMult) / 10_000n;

    const maxMult = swashBoozeMaxMultiplier(params.mode);
    const result = await playHouseGame({
      userId: req.user.sub,
      game: "swashbooze",
      betNano: effectiveStake,
      params,
      validate: validateSwashBoozeParams,
      compute: async ({ serverSeedHex, clientSeedHex, nonce, params: p }) => {
        const outcome = await playSwashBooze(serverSeedHex, clientSeedHex, nonce, p);
        return { outcome, multiplier: outcome.multiplier, maxMultiplier: maxMult };
      },
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, meta: result.meta });
    return reply.send({
      ok: true,
      outcome: result.outcome,
      multiplier: result.multiplier,
      // Echo the actual amount debited (spin = 1×, buy = 100×) so the client
      // can display the correct "spent" figure regardless of mode.
      betNano: result.betNano,
      baseBetNano: baseBetNano.toString(),
      mode: params.mode,
      ante: !!params.ante,
      payoutNano: result.payoutNano,
      newBalanceNano: result.newBalanceNano,
      nonce: result.nonce,
      serverSeedHash: result.serverSeedHash,
      clientSeedHex: result.clientSeedHex,
      playId: result.playId,
    });
  });
}
