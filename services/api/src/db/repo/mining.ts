import { db } from "../sqlite.js";

export interface MiningRoundRow {
  id: number;
  status: "WAITING" | "COUNTDOWN" | "LIVE" | "RESOLVED" | "REFUNDED";
  server_seed_hex: string;
  server_seed_hash: string;
  trajectory_seed_hex: string | null;
  pot_nano: string;
  winner_user_id: string | null;
  winner_payout_nano: string | null;
  rake_nano: string | null;
  started_at: number;
  countdown_ends_at: number | null;
  resolved_at: number | null;
}

export interface MiningBetRow {
  id: number;
  round_id: number;
  user_id: string;
  amount_nano: string;
  client_seed_hex: string;
  final_gems: number | null;
  created_at: number;
}

export function createMiningRound(input: {
  serverSeedHex: string;
  serverSeedHash: string;
  countdownEndsAt: number;
}): MiningRoundRow {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO mining_rounds (status, server_seed_hex, server_seed_hash, started_at, countdown_ends_at)
       VALUES ('WAITING', ?, ?, ?, ?)`,
    )
    .run(input.serverSeedHex, input.serverSeedHash, now, input.countdownEndsAt);
  return getMiningRound(Number(info.lastInsertRowid))!;
}

export function getMiningRound(id: number): MiningRoundRow | null {
  return (db.prepare("SELECT * FROM mining_rounds WHERE id = ?").get(id) as MiningRoundRow | undefined) ?? null;
}

export function getMiningBetsForRound(roundId: number): MiningBetRow[] {
  return db.prepare("SELECT * FROM mining_bets WHERE round_id = ? ORDER BY created_at ASC").all(roundId) as MiningBetRow[];
}

export function upsertMiningBet(input: {
  roundId: number;
  userId: string;
  amountNano: bigint;
  clientSeedHex: string;
}): MiningBetRow {
  const existing = db
    .prepare("SELECT * FROM mining_bets WHERE round_id = ? AND user_id = ?")
    .get(input.roundId, input.userId) as MiningBetRow | undefined;
  if (existing) {
    const newAmount = BigInt(existing.amount_nano) + input.amountNano;
    db.prepare("UPDATE mining_bets SET amount_nano = ? WHERE round_id = ? AND user_id = ?").run(
      newAmount.toString(),
      input.roundId,
      input.userId,
    );
    return db.prepare("SELECT * FROM mining_bets WHERE round_id = ? AND user_id = ?").get(input.roundId, input.userId) as MiningBetRow;
  }
  db.prepare(
    `INSERT INTO mining_bets (round_id, user_id, amount_nano, client_seed_hex, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(input.roundId, input.userId, input.amountNano.toString(), input.clientSeedHex, Date.now());
  return db.prepare("SELECT * FROM mining_bets WHERE round_id = ? AND user_id = ?").get(input.roundId, input.userId) as MiningBetRow;
}

export function updateMiningPot(roundId: number, potNano: bigint) {
  db.prepare("UPDATE mining_rounds SET pot_nano = ? WHERE id = ?").run(potNano.toString(), roundId);
}

export function setMiningCountdown(roundId: number, endsAt: number) {
  db.prepare("UPDATE mining_rounds SET status='COUNTDOWN', countdown_ends_at=? WHERE id=?").run(endsAt, roundId);
}

export function markMiningLive(roundId: number, trajectorySeedHex: string) {
  db.prepare("UPDATE mining_rounds SET status='LIVE', trajectory_seed_hex=? WHERE id=?").run(trajectorySeedHex, roundId);
}

export function markMiningResolved(input: {
  roundId: number;
  winnerUserId: string;
  winnerPayoutNano: bigint;
  rakeNano: bigint;
  finalGems: { userId: string; gems: number }[];
}) {
  db.transaction(() => {
    db.prepare(
      `UPDATE mining_rounds SET status='RESOLVED', winner_user_id=?, winner_payout_nano=?, rake_nano=?, resolved_at=? WHERE id=?`,
    ).run(
      input.winnerUserId,
      input.winnerPayoutNano.toString(),
      input.rakeNano.toString(),
      Date.now(),
      input.roundId,
    );
    for (const g of input.finalGems) {
      db.prepare("UPDATE mining_bets SET final_gems=? WHERE round_id=? AND user_id=?").run(
        g.gems,
        input.roundId,
        g.userId,
      );
    }
  })();
}

export function markMiningRefunded(roundId: number) {
  db.prepare("UPDATE mining_rounds SET status='REFUNDED', resolved_at=? WHERE id=?").run(Date.now(), roundId);
}

export function findUnresolvedMiningRounds(): MiningRoundRow[] {
  return db
    .prepare("SELECT * FROM mining_rounds WHERE status IN ('WAITING','COUNTDOWN','LIVE') ORDER BY id ASC")
    .all() as MiningRoundRow[];
}

export function countResolvedMiningRounds(): number {
  const r = db.prepare("SELECT COUNT(*) as c FROM mining_rounds WHERE status='RESOLVED'").get() as { c: number };
  return r.c;
}
