import type { FastifyInstance } from "fastify";
import {
  biggestRounds,
  getBetsForRound,
  lastResolvedRound,
  luckiestRounds,
  recentResolvedRounds,
  roundsForUser,
  topResolvedRound,
  type RoundRow,
} from "../db/repo/rounds.js";
import { getUserById } from "../db/repo/users.js";
import { requireAuthHook } from "../auth/authPlugin.js";

interface PublicRound {
  roundId: number;
  startedAt: number;
  resolvedAt: number | null;
  potNano: string;
  winnerUserId: string | null;
  winnerUsername: string | null;
  winnerFirstName: string | null;
  winnerPhotoUrl: string | null;
  winnerPayoutNano: string | null;
  winnerStakeNano: string | null;
  /** payout / stake. 0 if unknown. */
  multiplier: number;
  /** stake / pot — winner's chance of winning. 0..1 */
  chance: number;
  rakeNano: string | null;
  serverSeedHex: string;
  serverSeedHash: string;
  trajectorySeedHex: string | null;
  clientSeedsHex: string[];
  playerCount: number;
}

function toPublic(r: RoundRow): PublicRound {
  const bets = getBetsForRound(r.id);
  const winner = r.winner_user_id ? getUserById(r.winner_user_id) : null;
  const winnerBet = bets.find((b) => b.user_id === r.winner_user_id);
  const winnerStake = winnerBet ? BigInt(winnerBet.amount_nano) : 0n;
  const payout = r.winner_payout_nano ? BigInt(r.winner_payout_nano) : 0n;
  const pot = BigInt(r.pot_nano || "0");

  const multiplier = winnerStake > 0n ? Number(payout) / Number(winnerStake) : 0;
  const chance = pot > 0n && winnerStake > 0n ? Number(winnerStake) / Number(pot) : 0;

  return {
    roundId: r.id,
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    potNano: r.pot_nano,
    winnerUserId: r.winner_user_id,
    winnerUsername: winner?.username ?? null,
    winnerFirstName: winner?.first_name ?? null,
    winnerPhotoUrl: winner?.photo_url ?? null,
    winnerPayoutNano: r.winner_payout_nano,
    winnerStakeNano: winnerBet?.amount_nano ?? null,
    multiplier,
    chance,
    rakeNano: r.rake_nano,
    serverSeedHex: r.server_seed_hex,
    serverSeedHash: r.server_seed_hash,
    trajectorySeedHex: r.trajectory_seed_hex,
    clientSeedsHex: bets.map((b) => b.client_seed_hex),
    playerCount: bets.length,
  };
}

export async function registerRoundRoutes(app: FastifyInstance) {
  app.get("/rounds/recent", async () => recentResolvedRounds(25).map(toPublic));

  app.get("/rounds/:id/bets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const roundId = parseInt(id, 10);
    if (!Number.isFinite(roundId)) return reply.code(400).send({ error: "bad id" });
    const bets = getBetsForRound(roundId);
    return bets.map((b) => {
      const u = getUserById(b.user_id);
      return {
        userId: b.user_id,
        username: u?.username ?? null,
        firstName: u?.first_name ?? null,
        photoUrl: u?.photo_url ?? null,
        amountNano: b.amount_nano,
      };
    });
  });

  app.get("/rounds/top", async () => {
    const r = topResolvedRound();
    return r ? toPublic(r) : null;
  });

  app.get("/rounds/last", async () => {
    const r = lastResolvedRound();
    return r ? toPublic(r) : null;
  });

  app.get("/rounds/biggest", async () => biggestRounds(25).map(toPublic));
  app.get("/rounds/luckiest", async () => luckiestRounds(25).map(toPublic));

  app.get("/rounds/mine", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    return roundsForUser(req.user.sub, 25).map(toPublic);
  });
}
