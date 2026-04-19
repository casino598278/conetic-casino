// Limbo: player picks a target multiplier. Crash result = house_edge / u, where u ~ U(0,1).
// Win if result >= target. 99% RTP: P(win) = 0.99 / target, payout = target → EV = 0.99.
//
// This mirrors Stake's Limbo exactly: the on-screen "crash multiplier" is
// displayed regardless of whether you won, and the target is a payout multiplier.

import { deriveFloat, HOUSE_RTP } from "./houseFair.js";

export const LIMBO_MIN_TARGET = 1.01;
export const LIMBO_MAX_TARGET = 1_000_000;

/** Hard result cap so floats stay well within Number range and UI can format.
    Matches Stake's displayed ceiling. */
export const LIMBO_RESULT_CAP = 1_000_000;

export interface LimboParams {
  target: number;  // >= 1.01
}

export interface LimboOutcome {
  result: number;  // Actual crash multiplier, e.g. 1.47× or 812.34×
  win: boolean;
}

export function limboWinChance(params: LimboParams): number {
  const t = clamp(params.target);
  return HOUSE_RTP / t;
}

export function limboMultiplier(params: LimboParams): number {
  const t = clamp(params.target);
  return t;
}

function clamp(t: number): number {
  if (!Number.isFinite(t)) return LIMBO_MIN_TARGET;
  return Math.max(LIMBO_MIN_TARGET, Math.min(LIMBO_MAX_TARGET, t));
}

/** Deterministic crash multiplier from seeds + nonce.
 *  Formula: result = HOUSE_RTP / u, with u ∈ (2^-52, 1). */
export async function playLimbo(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  params: LimboParams,
): Promise<LimboOutcome> {
  const u = await deriveFloat(serverSeedHex, clientSeedHex, nonce);
  // u can be 0 in [0,1); guard to avoid +Infinity. Floor to 2^-52 for a deterministic max.
  const safeU = u > 2 ** -52 ? u : 2 ** -52;
  const raw = HOUSE_RTP / safeU;
  // Display-clamp to [1.00, cap]. Values < 1 are "instant crash" — player can
  // never win, since the minimum target is 1.01×.
  const result = Math.max(1, Math.min(LIMBO_RESULT_CAP, Math.floor(raw * 100) / 100));
  const t = clamp(params.target);
  const win = result >= t;
  return { result, win };
}

export function validateLimboParams(params: unknown): params is LimboParams {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (typeof p.target !== "number" || !Number.isFinite(p.target)) return false;
  if (p.target < LIMBO_MIN_TARGET || p.target > LIMBO_MAX_TARGET) return false;
  return true;
}
