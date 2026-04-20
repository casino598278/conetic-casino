// Shared engine for single-player vs. house games.
// Every game calls playHouseGame() with a `compute` function that produces
// (outcome, multiplier) from the deterministic seed triple.

import { config } from "../config.js";
import { txn } from "../db/sqlite.js";
import { credit, debit, getBalanceNano, InsufficientBalanceError } from "../db/repo/ledger.js";
import { getHouseUserId } from "../db/repo/users.js";
import { addWager } from "../db/repo/leaderboard.js";
import {
  consumeNonce,
  insertPlay,
  type HouseSeedRow,
} from "../db/repo/houseGames.js";

const NANO = 1_000_000_000n;
const BET_RATE_WINDOW_MS = 5_000;
const BET_RATE_MAX = 10;
const betRateMap = new Map<string, number[]>();

function checkBetRate(userId: string): boolean {
  const now = Date.now();
  const stamps = betRateMap.get(userId) ?? [];
  const recent = stamps.filter((t) => now - t < BET_RATE_WINDOW_MS);
  if (recent.length >= BET_RATE_MAX) return false;
  recent.push(now);
  betRateMap.set(userId, recent);
  return true;
}

function tonToNano(ton: number): bigint {
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

export type PlayError =
  | "rate_limited"
  | "below_min"
  | "above_max"
  | "insufficient_balance"
  | "invalid_params"
  | "max_win_exceeded"
  | "daily_limit";

export interface PlayResult<Outcome> {
  ok: true;
  outcome: Outcome;
  multiplier: number;
  betNano: string;
  payoutNano: string;
  newBalanceNano: string;
  nonce: number;
  serverSeedHex: string;        // revealed after play
  serverSeedHash: string;        // the hash that was committed before the play
  clientSeedHex: string;
  nextServerSeedHash: string;    // same as serverSeedHash (seed only rotates on demand)
  playId: number;
}

export interface PlayFailure {
  ok: false;
  error: PlayError;
  meta?: Record<string, unknown>;
}

export interface ComputeInput<Params> {
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: number;
  params: Params;
}

export interface ComputeOutput<Outcome> {
  outcome: Outcome;
  /** Payout multiplier. 0 = loss, 1 = push (refund bet), >1 = profit. */
  multiplier: number;
  /** Theoretical worst-case multiplier for THIS params combo. Used for max-win guard. */
  maxMultiplier: number;
}

export async function playHouseGame<Params, Outcome>(args: {
  userId: string;
  game: string;
  betNano: bigint;
  params: Params;
  validate: (params: unknown) => params is Params;
  compute: (input: ComputeInput<Params>) => Promise<ComputeOutput<Outcome>>;
}): Promise<PlayResult<Outcome> | PlayFailure> {
  const { userId, game, betNano, params, validate, compute } = args;

  if (!validate(params)) return { ok: false, error: "invalid_params" };
  if (!checkBetRate(userId)) return { ok: false, error: "rate_limited" };
  if (betNano <= 0n) return { ok: false, error: "invalid_params" };

  // All betting limits removed per owner's direction. Rate-limit + balance
  // check (enforced by the debit below) are the only guards left.
  const { seeds, nonceUsed } = consumeNonce(userId);

  const result = await compute({
    serverSeedHex: seeds.server_seed_hex,
    clientSeedHex: seeds.client_seed_hex,
    nonce: nonceUsed,
    params,
  });

  const { outcome, multiplier, maxMultiplier: _ignore } = result;
  void _ignore;

  const payoutNano = multiplier > 0 ? mulBigInt(betNano, multiplier) : 0n;

  let playRow;
  try {
    playRow = txn(() => {
      debit({ userId, amountNano: betNano, reason: "bet" });
      if (payoutNano > 0n) {
        credit({ userId, amountNano: payoutNano, reason: "win" });
      }
      // House "takes" the loss for accounting. On TON chain, the house ledger
      // is just a synthetic user — this mirrors how PvP rake/refund works.
      addWager(userId, betNano);
      return insertPlay({
        user_id: userId,
        game,
        bet_nano: betNano.toString(),
        payout_nano: payoutNano.toString(),
        multiplier,
        params_json: JSON.stringify(params),
        outcome_json: JSON.stringify(outcome),
        server_seed_hex: seeds.server_seed_hex,
        server_seed_hash: seeds.server_seed_hash,
        client_seed_hex: seeds.client_seed_hex,
        nonce: nonceUsed,
        created_at: Date.now(),
      });
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) return { ok: false, error: "insufficient_balance" };
    throw err;
  }

  // House bookkeeping — not visible to players; drives /admin/house-stats later.
  // Net to house = bet - payout. Negative means house paid more than it took.
  // The house ledger is a synthetic accounting user and is allowed to go negative.
  const houseId = getHouseUserId();
  const houseDelta = betNano - payoutNano;
  if (houseDelta !== 0n) {
    txn(() => {
      if (houseDelta > 0n) {
        credit({ userId: houseId, amountNano: houseDelta, reason: "rake" });
      } else {
        debit({ userId: houseId, amountNano: -houseDelta, reason: "bet", allowNegative: true });
      }
    });
  }

  const newBalance = getBalanceNano(userId);

  return {
    ok: true,
    outcome,
    multiplier,
    betNano: betNano.toString(),
    payoutNano: payoutNano.toString(),
    newBalanceNano: newBalance.toString(),
    nonce: nonceUsed,
    serverSeedHex: seeds.server_seed_hex,
    serverSeedHash: seeds.server_seed_hash,
    clientSeedHex: seeds.client_seed_hex,
    nextServerSeedHash: seeds.server_seed_hash,
    playId: playRow.id,
  };
}

/** Multiply a nano bigint by a float multiplier, rounded down. */
function mulBigInt(nano: bigint, mult: number): bigint {
  if (!Number.isFinite(mult) || mult <= 0) return 0n;
  // Scale multiplier to 9 decimal fixed-point to stay in bigint math.
  const scaled = BigInt(Math.round(mult * 1_000_000_000));
  return (nano * scaled) / 1_000_000_000n;
}

/** Expose for testing. */
export { mulBigInt, tonToNano };

export function maxWinTon(): number {
  return config.MAX_WIN_TON;
}

/** Publicly-exposed seed state (what the client can see). */
export function publicSeedState(seeds: HouseSeedRow) {
  return {
    serverSeedHash: seeds.server_seed_hash,
    previousServerSeedHex: seeds.previous_server_seed_hex,
    clientSeedHex: seeds.client_seed_hex,
    nextNonce: seeds.nonce,
  };
}
