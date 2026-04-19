// Dice: roll 0.00–99.99, win if roll is on chosen side of target.
// 99% RTP — multiplier = 0.99 / winChance.

import { deriveFloat, HOUSE_RTP } from "./houseFair.js";

export const DICE_MIN_TARGET = 0.01;
export const DICE_MAX_TARGET = 98.99;
export const DICE_ROLL_MAX = 99.99;

export interface DiceParams {
  target: number;   // 0.01 .. 98.99
  over: boolean;    // true = win if roll > target, false = win if roll < target
}

export interface DiceOutcome {
  roll: number;     // 0.00 .. 99.99
  win: boolean;
}

export function diceWinChance(params: DiceParams): number {
  const t = clampTarget(params.target);
  const chance = params.over ? (DICE_ROLL_MAX - t) / 100 : t / 100;
  return Math.max(0, Math.min(1, chance));
}

export function diceMultiplier(params: DiceParams): number {
  const p = diceWinChance(params);
  if (p <= 0) return 0;
  return HOUSE_RTP / p;
}

function clampTarget(t: number): number {
  if (!Number.isFinite(t)) return DICE_MIN_TARGET;
  return Math.max(DICE_MIN_TARGET, Math.min(DICE_MAX_TARGET, t));
}

/** Deterministic roll from seeds + nonce. */
export async function playDice(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  params: DiceParams,
): Promise<DiceOutcome> {
  const u = await deriveFloat(serverSeedHex, clientSeedHex, nonce);
  // roll ∈ [0.00, 99.99], rounded to 2 decimals (matches Stake display).
  const roll = Math.floor(u * 10000) / 100;
  const t = clampTarget(params.target);
  const win = params.over ? roll > t : roll < t;
  return { roll, win };
}

export function validateDiceParams(params: unknown): params is DiceParams {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (typeof p.target !== "number" || !Number.isFinite(p.target)) return false;
  if (p.target < DICE_MIN_TARGET || p.target > DICE_MAX_TARGET) return false;
  if (typeof p.over !== "boolean") return false;
  return true;
}
