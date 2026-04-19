import { randomBytes, createHash } from "node:crypto";
import { db } from "../sqlite.js";

export interface HouseSeedRow {
  user_id: string;
  server_seed_hex: string;
  server_seed_hash: string;
  previous_server_seed_hex: string | null;
  client_seed_hex: string;
  nonce: number;
  created_at: number;
}

export interface HousePlayRow {
  id: number;
  user_id: string;
  game: string;
  bet_nano: string;
  payout_nano: string;
  multiplier: number;
  params_json: string;
  outcome_json: string;
  server_seed_hex: string;
  server_seed_hash: string;
  client_seed_hex: string;
  nonce: number;
  created_at: number;
}

function genServerSeed(): string {
  return randomBytes(32).toString("hex");
}
function genClientSeed(): string {
  return randomBytes(16).toString("hex");
}
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Load (or lazily create) the user's seed state. */
export function getOrCreateSeeds(userId: string): HouseSeedRow {
  const existing = db.prepare("SELECT * FROM house_game_seeds WHERE user_id = ?").get(userId) as
    | HouseSeedRow
    | undefined;
  if (existing) return existing;
  const serverSeedHex = genServerSeed();
  const row: HouseSeedRow = {
    user_id: userId,
    server_seed_hex: serverSeedHex,
    server_seed_hash: sha256Hex(serverSeedHex),
    previous_server_seed_hex: null,
    client_seed_hex: genClientSeed(),
    nonce: 0,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO house_game_seeds
      (user_id, server_seed_hex, server_seed_hash, previous_server_seed_hex, client_seed_hex, nonce, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.user_id,
    row.server_seed_hex,
    row.server_seed_hash,
    row.previous_server_seed_hex,
    row.client_seed_hex,
    row.nonce,
    row.created_at,
  );
  return row;
}

/** Rotate: reveal the current server seed, mint a new one, reset nonce. */
export function rotateSeeds(userId: string, newClientSeedHex?: string): HouseSeedRow {
  const current = getOrCreateSeeds(userId);
  const newServer = genServerSeed();
  const clientSeed = newClientSeedHex ?? genClientSeed();
  db.prepare(
    `UPDATE house_game_seeds
      SET server_seed_hex = ?, server_seed_hash = ?, previous_server_seed_hex = ?,
          client_seed_hex = ?, nonce = 0, created_at = ?
      WHERE user_id = ?`,
  ).run(
    newServer,
    sha256Hex(newServer),
    current.server_seed_hex,
    clientSeed,
    Date.now(),
    userId,
  );
  return db.prepare("SELECT * FROM house_game_seeds WHERE user_id = ?").get(userId) as HouseSeedRow;
}

/** Consume one nonce and return the seed triple used for this play. */
export function consumeNonce(userId: string): { seeds: HouseSeedRow; nonceUsed: number } {
  const seeds = getOrCreateSeeds(userId);
  const nonceUsed = seeds.nonce;
  db.prepare("UPDATE house_game_seeds SET nonce = nonce + 1 WHERE user_id = ?").run(userId);
  seeds.nonce = nonceUsed + 1;
  return { seeds, nonceUsed };
}

export function setClientSeed(userId: string, clientSeedHex: string): HouseSeedRow {
  db.prepare("UPDATE house_game_seeds SET client_seed_hex = ? WHERE user_id = ?").run(
    clientSeedHex,
    userId,
  );
  return getOrCreateSeeds(userId);
}

export function insertPlay(input: Omit<HousePlayRow, "id">): HousePlayRow {
  const res = db
    .prepare(
      `INSERT INTO house_game_plays
        (user_id, game, bet_nano, payout_nano, multiplier, params_json, outcome_json,
         server_seed_hex, server_seed_hash, client_seed_hex, nonce, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.user_id,
      input.game,
      input.bet_nano,
      input.payout_nano,
      input.multiplier,
      input.params_json,
      input.outcome_json,
      input.server_seed_hex,
      input.server_seed_hash,
      input.client_seed_hex,
      input.nonce,
      input.created_at,
    );
  return { ...input, id: res.lastInsertRowid as number };
}

export function getRecentPlays(userId: string, limit = 50, game?: string): HousePlayRow[] {
  if (game) {
    return db
      .prepare(
        `SELECT * FROM house_game_plays WHERE user_id = ? AND game = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, game, limit) as HousePlayRow[];
  }
  return db
    .prepare(`SELECT * FROM house_game_plays WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as HousePlayRow[];
}

/** Sum of (payout - bet) over a time window. Positive = player net won, negative = house won. */
export function userNetWinSince(userId: string, sinceMs: number): bigint {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CAST(payout_nano AS INTEGER) - CAST(bet_nano AS INTEGER)), 0) AS net
       FROM house_game_plays
       WHERE user_id = ? AND created_at >= ?`,
    )
    .get(userId, sinceMs) as { net: number | bigint };
  return BigInt(row.net);
}
