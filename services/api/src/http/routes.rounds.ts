import type { FastifyInstance } from "fastify";
import { recentResolvedRounds, getBetsForRound } from "../db/repo/rounds.js";
import { getUserById } from "../db/repo/users.js";

export async function registerRoundRoutes(app: FastifyInstance) {
  app.get("/rounds/recent", async () => {
    const rounds = recentResolvedRounds(25);
    return rounds.map((r) => {
      const winner = r.winner_user_id ? getUserById(r.winner_user_id) : null;
      const bets = getBetsForRound(r.id);
      return {
        roundId: r.id,
        startedAt: r.started_at,
        resolvedAt: r.resolved_at,
        potNano: r.pot_nano,
        winnerUserId: r.winner_user_id,
        winnerUsername: winner?.username ?? null,
        winnerPayoutNano: r.winner_payout_nano,
        rakeNano: r.rake_nano,
        serverSeedHex: r.server_seed_hex,
        serverSeedHash: r.server_seed_hash,
        clientSeedsHex: bets.map((b) => b.client_seed_hex),
        trajectorySeedHex: r.trajectory_seed_hex,
      };
    });
  });
}
