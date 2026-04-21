// Unified bet feed across Arena rounds, Mining rounds, and singleplayer
// house-game plays. Powers the HistoryModal's "Recent / Biggest / Luckiest /
// My Bets" tabs so they're no longer Arena-only.

import { db } from "../sqlite.js";
import { getUserById } from "./users.js";

export type BetSource = "arena" | "mining" | "house";

export interface UnifiedBet {
  source: BetSource;
  /** Display game name: "Arena" | "Mining" | "Dice" | "Limbo" | … */
  game: string;
  /** Stable composite id: `${source}:${rowId}`. */
  id: string;
  userId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  betNano: string;
  payoutNano: string;
  /** payout / bet. 0 = loss. */
  multiplier: number;
  /** Win probability at time of play (if known), else 0. */
  chance: number;
  createdAt: number;
}

interface ArenaRow {
  bet_id: number;
  round_id: number;
  user_id: string;
  amount_nano: string;
  created_at: number;
  resolved_at: number | null;
  winner_user_id: string | null;
  winner_payout_nano: string | null;
  pot_nano: string;
}
interface MiningBetRow {
  id: number;
  round_id: number;
  user_id: string;
  amount_nano: string;
  created_at: number;
  resolved_at: number | null;
  winner_user_id: string | null;
  winner_payout_nano: string | null;
  pot_nano: string;
}
interface HouseRow {
  id: number;
  user_id: string;
  game: string;
  bet_nano: string;
  payout_nano: string;
  multiplier: number;
  outcome_json: string;
  created_at: number;
}

function arenaRowsFor(sql: string, params: unknown[]): ArenaRow[] {
  return db.prepare(sql).all(...params) as ArenaRow[];
}
function miningRowsFor(sql: string, params: unknown[]): MiningBetRow[] {
  return db.prepare(sql).all(...params) as MiningBetRow[];
}
function houseRowsFor(sql: string, params: unknown[]): HouseRow[] {
  return db.prepare(sql).all(...params) as HouseRow[];
}

function toUnifiedArena(b: ArenaRow): UnifiedBet {
  const u = getUserById(b.user_id);
  const won = b.winner_user_id === b.user_id;
  const bet = BigInt(b.amount_nano);
  const payout = won ? BigInt(b.winner_payout_nano ?? "0") : 0n;
  const mult = won && bet > 0n ? Number(payout) / Number(bet) : 0;
  const pot = BigInt(b.pot_nano || "0");
  const chance = pot > 0n ? Number(bet) / Number(pot) : 0;
  return {
    source: "arena",
    game: "Arena",
    id: `arena:${b.bet_id}`,
    userId: b.user_id,
    username: u?.username ?? null,
    firstName: u?.first_name ?? null,
    photoUrl: u?.photo_url ?? null,
    betNano: b.amount_nano,
    payoutNano: payout.toString(),
    multiplier: mult,
    chance,
    createdAt: b.resolved_at ?? b.created_at,
  };
}
function toUnifiedMining(b: MiningBetRow): UnifiedBet {
  const u = getUserById(b.user_id);
  const won = b.winner_user_id === b.user_id;
  const bet = BigInt(b.amount_nano);
  const payout = won ? BigInt(b.winner_payout_nano ?? "0") : 0n;
  const mult = won && bet > 0n ? Number(payout) / Number(bet) : 0;
  const pot = BigInt(b.pot_nano || "0");
  const chance = pot > 0n ? Number(bet) / Number(pot) : 0;
  return {
    source: "mining",
    game: "Mining",
    id: `mining:${b.id}`,
    userId: b.user_id,
    username: u?.username ?? null,
    firstName: u?.first_name ?? null,
    photoUrl: u?.photo_url ?? null,
    betNano: b.amount_nano,
    payoutNano: payout.toString(),
    multiplier: mult,
    chance,
    createdAt: b.resolved_at ?? b.created_at,
  };
}
function toUnifiedHouse(p: HouseRow): UnifiedBet {
  const u = getUserById(p.user_id);
  // For dice/limbo, the chance is derivable from params but cheaper to read
  // from the outcome (e.g. limbo target for the frontend is fine).
  let chance = 0;
  try {
    const _outcome = JSON.parse(p.outcome_json);
    // Derive chance = 0.99 / multiplier where applicable (dice/limbo win).
    if (p.multiplier > 0) chance = 0.99 / p.multiplier;
    void _outcome;
  } catch { /* ignore */ }
  return {
    source: "house",
    game: prettyGame(p.game),
    id: `house:${p.id}`,
    userId: p.user_id,
    username: u?.username ?? null,
    firstName: u?.first_name ?? null,
    photoUrl: u?.photo_url ?? null,
    betNano: p.bet_nano,
    payoutNano: p.payout_nano,
    multiplier: p.multiplier,
    chance,
    createdAt: p.created_at,
  };
}
function prettyGame(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/** Recent bets across every game, newest first. */
export function recentBets(limit: number): UnifiedBet[] {
  const half = Math.ceil(limit / 2);
  const arena = arenaRowsFor(
    `SELECT b.id AS bet_id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM bets b JOIN rounds r ON r.id = b.round_id
       WHERE r.status='RESOLVED'
       ORDER BY r.resolved_at DESC LIMIT ?`, [half * 2],
  ).map(toUnifiedArena);
  const mining = miningRowsFor(
    `SELECT b.id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM mining_bets b JOIN mining_rounds r ON r.id = b.round_id
       WHERE r.status='RESOLVED'
       ORDER BY r.resolved_at DESC LIMIT ?`, [half * 2],
  ).map(toUnifiedMining);
  const house = houseRowsFor(
    `SELECT id, user_id, game, bet_nano, payout_nano, multiplier, outcome_json, created_at
       FROM house_game_plays
       WHERE game != 'swashbooze'
       ORDER BY created_at DESC LIMIT ?`, [half * 2],
  ).map(toUnifiedHouse);

  return [...arena, ...mining, ...house]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Biggest wins (by absolute profit) — house edge means a loss = 0 profit. */
export function biggestBets(limit: number): UnifiedBet[] {
  const arena = arenaRowsFor(
    `SELECT b.id AS bet_id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM bets b JOIN rounds r ON r.id = b.round_id
       WHERE r.status='RESOLVED' AND r.winner_user_id = b.user_id
       ORDER BY CAST(r.winner_payout_nano AS INTEGER) DESC LIMIT ?`, [limit],
  ).map(toUnifiedArena);
  const mining = miningRowsFor(
    `SELECT b.id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM mining_bets b JOIN mining_rounds r ON r.id = b.round_id
       WHERE r.status='RESOLVED' AND r.winner_user_id = b.user_id
       ORDER BY CAST(r.winner_payout_nano AS INTEGER) DESC LIMIT ?`, [limit],
  ).map(toUnifiedMining);
  const house = houseRowsFor(
    `SELECT id, user_id, game, bet_nano, payout_nano, multiplier, outcome_json, created_at
       FROM house_game_plays
       WHERE game != 'swashbooze'
         AND CAST(payout_nano AS INTEGER) > CAST(bet_nano AS INTEGER)
       ORDER BY (CAST(payout_nano AS INTEGER) - CAST(bet_nano AS INTEGER)) DESC LIMIT ?`, [limit],
  ).map(toUnifiedHouse);

  const profit = (b: UnifiedBet) => BigInt(b.payoutNano) - BigInt(b.betNano);
  return [...arena, ...mining, ...house]
    .sort((a, b) => (profit(a) < profit(b) ? 1 : profit(a) > profit(b) ? -1 : 0))
    .slice(0, limit);
}

/** Luckiest wins (highest multiplier). */
export function luckiestBets(limit: number): UnifiedBet[] {
  const arena = recentBets(200).filter((b) => b.source === "arena" && b.multiplier > 1);
  const mining = recentBets(200).filter((b) => b.source === "mining" && b.multiplier > 1);
  const house = houseRowsFor(
    `SELECT id, user_id, game, bet_nano, payout_nano, multiplier, outcome_json, created_at
       FROM house_game_plays
       WHERE game != 'swashbooze' AND multiplier > 1
       ORDER BY multiplier DESC LIMIT ?`, [limit],
  ).map(toUnifiedHouse);

  return [...arena, ...mining, ...house]
    .sort((a, b) => b.multiplier - a.multiplier)
    .slice(0, limit);
}

/** Just this user's bets, newest first. */
export function userBets(userId: string, limit: number): UnifiedBet[] {
  const arena = arenaRowsFor(
    `SELECT b.id AS bet_id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM bets b JOIN rounds r ON r.id = b.round_id
       WHERE b.user_id = ? AND r.status='RESOLVED'
       ORDER BY r.resolved_at DESC LIMIT ?`, [userId, limit],
  ).map(toUnifiedArena);
  const mining = miningRowsFor(
    `SELECT b.id, b.round_id, b.user_id, b.amount_nano, b.created_at,
            r.resolved_at, r.winner_user_id, r.winner_payout_nano, r.pot_nano
       FROM mining_bets b JOIN mining_rounds r ON r.id = b.round_id
       WHERE b.user_id = ? AND r.status='RESOLVED'
       ORDER BY r.resolved_at DESC LIMIT ?`, [userId, limit],
  ).map(toUnifiedMining);
  const house = houseRowsFor(
    `SELECT id, user_id, game, bet_nano, payout_nano, multiplier, outcome_json, created_at
       FROM house_game_plays
       WHERE user_id = ? AND game != 'swashbooze'
       ORDER BY created_at DESC LIMIT ?`, [userId, limit],
  ).map(toUnifiedHouse);

  return [...arena, ...mining, ...house]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Aggregate stats for the profile sheet. */
export interface ProfileStats {
  totalPlays: number;
  totalWagerNano: string;
  totalPayoutNano: string;
  netNano: string;
  wins: number;
  losses: number;
  biggestWinNano: string;
  biggestMultiplier: number;
  perGame: { game: string; plays: number; wagerNano: string; netNano: string }[];
}

export function profileStats(userId: string): ProfileStats {
  const bets = userBets(userId, 1000);
  let wager = 0n, payout = 0n, wins = 0, losses = 0;
  let bigWin = 0n;
  let bigMult = 0;
  const perGameMap = new Map<string, { plays: number; wager: bigint; net: bigint }>();
  for (const b of bets) {
    const wagerN = BigInt(b.betNano);
    const payoutN = BigInt(b.payoutNano);
    wager += wagerN;
    payout += payoutN;
    const won = payoutN > wagerN;
    if (won) wins++; else losses++;
    const profit = payoutN - wagerN;
    if (profit > bigWin) bigWin = profit;
    if (b.multiplier > bigMult) bigMult = b.multiplier;
    const existing = perGameMap.get(b.game) ?? { plays: 0, wager: 0n, net: 0n };
    existing.plays++;
    existing.wager += wagerN;
    existing.net += profit;
    perGameMap.set(b.game, existing);
  }
  return {
    totalPlays: bets.length,
    totalWagerNano: wager.toString(),
    totalPayoutNano: payout.toString(),
    netNano: (payout - wager).toString(),
    wins,
    losses,
    biggestWinNano: bigWin.toString(),
    biggestMultiplier: bigMult,
    perGame: Array.from(perGameMap.entries())
      .map(([game, s]) => ({
        game,
        plays: s.plays,
        wagerNano: s.wager.toString(),
        netNano: s.net.toString(),
      }))
      .sort((a, b) => b.plays - a.plays),
  };
}
