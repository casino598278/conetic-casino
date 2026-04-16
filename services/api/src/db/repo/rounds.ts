import { db } from "../sqlite.js";

export interface RoundRow {
  id: number;
  status: "COUNTDOWN" | "LIVE" | "RESOLVED" | "REFUNDED";
  server_seed_hex: string;
  server_seed_hash: string;
  trajectory_seed_hex: string | null;
  pot_nano: string;
  winner_user_id: string | null;
  winner_payout_nano: string | null;
  rake_nano: string | null;
  resting_x: number | null;
  resting_y: number | null;
  started_at: number;
  countdown_ends_at: number | null;
  resolved_at: number | null;
}

export interface BetRow {
  id: number;
  round_id: number;
  user_id: string;
  amount_nano: string;
  client_seed_hex: string;
  created_at: number;
}

export function createRound(input: {
  serverSeedHex: string;
  serverSeedHash: string;
  countdownEndsAt: number;
}): RoundRow {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO rounds (status, server_seed_hex, server_seed_hash, started_at, countdown_ends_at)
       VALUES ('COUNTDOWN', ?, ?, ?, ?)`,
    )
    .run(input.serverSeedHex, input.serverSeedHash, now, input.countdownEndsAt);
  return getRound(Number(info.lastInsertRowid))!;
}

export function getRound(id: number): RoundRow | null {
  return (db.prepare("SELECT * FROM rounds WHERE id = ?").get(id) as RoundRow | undefined) ?? null;
}

export function getBetsForRound(roundId: number): BetRow[] {
  return db.prepare("SELECT * FROM bets WHERE round_id = ? ORDER BY created_at ASC").all(roundId) as BetRow[];
}

/** Insert or top-up a player's bet for the round. Adds amountNano to existing stake. */
export function upsertBet(input: {
  roundId: number;
  userId: string;
  amountNano: bigint;
  clientSeedHex: string;
}): BetRow {
  const existing = db
    .prepare("SELECT * FROM bets WHERE round_id = ? AND user_id = ?")
    .get(input.roundId, input.userId) as BetRow | undefined;
  if (existing) {
    const newAmount = BigInt(existing.amount_nano) + input.amountNano;
    db.prepare(
      `UPDATE bets SET amount_nano = ? WHERE round_id = ? AND user_id = ?`,
    ).run(newAmount.toString(), input.roundId, input.userId);
    return db
      .prepare("SELECT * FROM bets WHERE round_id = ? AND user_id = ?")
      .get(input.roundId, input.userId) as BetRow;
  }
  db.prepare(
    `INSERT INTO bets (round_id, user_id, amount_nano, client_seed_hex, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(input.roundId, input.userId, input.amountNano.toString(), input.clientSeedHex, Date.now());
  return db
    .prepare("SELECT * FROM bets WHERE round_id = ? AND user_id = ?")
    .get(input.roundId, input.userId) as BetRow;
}

export function updateRoundPot(roundId: number, potNano: bigint) {
  db.prepare("UPDATE rounds SET pot_nano = ? WHERE id = ?").run(potNano.toString(), roundId);
}

export function markLive(roundId: number, trajectorySeedHex: string) {
  db.prepare("UPDATE rounds SET status = 'LIVE', trajectory_seed_hex = ? WHERE id = ?").run(
    trajectorySeedHex,
    roundId,
  );
}

export function countResolvedRounds(): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM rounds WHERE status='RESOLVED'").get() as { c: number };
  return row.c;
}

export function markResolved(input: {
  roundId: number;
  winnerUserId: string;
  winnerPayoutNano: bigint;
  rakeNano: bigint;
  restingX: number;
  restingY: number;
}) {
  db.prepare(
    `UPDATE rounds SET status='RESOLVED', winner_user_id=?, winner_payout_nano=?, rake_nano=?,
       resting_x=?, resting_y=?, resolved_at=? WHERE id=?`,
  ).run(
    input.winnerUserId,
    input.winnerPayoutNano.toString(),
    input.rakeNano.toString(),
    input.restingX,
    input.restingY,
    Date.now(),
    input.roundId,
  );
}

export function markRefunded(roundId: number) {
  db.prepare("UPDATE rounds SET status='REFUNDED', resolved_at=? WHERE id=?").run(Date.now(), roundId);
}

export function findUnresolvedRounds(): RoundRow[] {
  return db
    .prepare("SELECT * FROM rounds WHERE status IN ('COUNTDOWN','LIVE') ORDER BY id ASC")
    .all() as RoundRow[];
}

export function recentResolvedRounds(limit = 25): RoundRow[] {
  return db
    .prepare("SELECT * FROM rounds WHERE status = 'RESOLVED' ORDER BY id DESC LIMIT ?")
    .all(limit) as RoundRow[];
}

/** Round with the largest winner_payout_nano. */
export function topResolvedRound(): RoundRow | null {
  return (db
    .prepare(
      `SELECT * FROM rounds WHERE status = 'RESOLVED' AND winner_payout_nano IS NOT NULL
       ORDER BY CAST(winner_payout_nano AS INTEGER) DESC LIMIT 1`,
    )
    .get() as RoundRow | undefined) ?? null;
}

/** Most recent resolved round. */
export function lastResolvedRound(): RoundRow | null {
  return (db
    .prepare(`SELECT * FROM rounds WHERE status = 'RESOLVED' ORDER BY id DESC LIMIT 1`)
    .get() as RoundRow | undefined) ?? null;
}

/** Rounds where a specific user placed a bet (player history). */
export function roundsForUser(userId: string, limit = 25): RoundRow[] {
  return db
    .prepare(
      `SELECT r.* FROM rounds r
       INNER JOIN bets b ON b.round_id = r.id
       WHERE b.user_id = ? AND r.status = 'RESOLVED'
       ORDER BY r.id DESC LIMIT ?`,
    )
    .all(userId, limit) as RoundRow[];
}

/** Rounds sorted by multiplier (winner_payout / winner_stake). Approximate "luckiest". */
export function luckiestRounds(limit = 25): RoundRow[] {
  return db
    .prepare(
      `SELECT r.* FROM rounds r
       INNER JOIN bets b ON b.round_id = r.id AND b.user_id = r.winner_user_id
       WHERE r.status = 'RESOLVED' AND r.winner_payout_nano IS NOT NULL
       ORDER BY (CAST(r.winner_payout_nano AS REAL) / CAST(b.amount_nano AS REAL)) DESC
       LIMIT ?`,
    )
    .all(limit) as RoundRow[];
}

/** Rounds sorted by absolute pot size. */
export function biggestRounds(limit = 25): RoundRow[] {
  return db
    .prepare(
      `SELECT * FROM rounds WHERE status = 'RESOLVED'
       ORDER BY CAST(pot_nano AS INTEGER) DESC LIMIT ?`,
    )
    .all(limit) as RoundRow[];
}
