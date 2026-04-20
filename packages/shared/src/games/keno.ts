// Keno: 40-cell grid, player picks 1-10 cells, server draws 10 distinct cells.
// Payout multiplier looks up `(risk, picks, hits)` in a paytable.
// Stake-standard tables (Low / Classic / Medium / High) encoded verbatim.
//
// The tables are already RTP-calibrated to ~99% by Stake. We verify with a
// Monte-Carlo convergence test in the sibling .test.ts file.

import { deriveFloats } from "./houseFair.js";

export const KENO_GRID = 40;
export const KENO_DRAWS = 10;
export const KENO_MIN_PICKS = 1;
export const KENO_MAX_PICKS = 10;

export type KenoRisk = "low" | "classic" | "medium" | "high";

export interface KenoParams {
  risk: KenoRisk;
  /** 1..10 distinct cell indices in [0, 39]. */
  picks: number[];
}

export interface KenoOutcome {
  /** The 10 cells the house drew this round. */
  draws: number[];
  /** How many of the player's picks were among the draws (0..picks.length). */
  hits: number;
  win: boolean;
}

/**
 * Paytable[risk][picks - 1][hits] = payout multiplier.
 * Sourced from stake.com Keno, April 2026. Row length is `picks + 1`
 * (indices 0..picks).
 */
const PAYTABLES: Record<KenoRisk, number[][]> = {
  low: [
    // 1 pick
    [0.7, 1.85],
    // 2 picks
    [0, 2, 3.8],
    // 3 picks
    [0, 1.1, 1.38, 26],
    // 4 picks
    [0, 0, 2.2, 7.9, 90],
    // 5 picks
    [0, 0, 1.5, 4.2, 13, 300],
    // 6 picks
    [0, 0, 1.1, 2, 6.2, 100, 700],
    // 7 picks
    [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
    // 8 picks
    [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
    // 9 picks
    [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
    // 10 picks
    [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
  ],
  classic: [
    [0, 3.96],
    [0, 1.9, 4.5],
    [0, 1, 3.1, 10.4],
    [0, 0.8, 1.8, 5, 22.5],
    [0, 0.25, 1.4, 4.1, 16.5, 36],
    [0, 0, 1, 3, 8, 63, 210],
    [0, 0, 0.47, 3, 4.5, 14, 31, 350],
    [0, 0, 0, 2.2, 4, 13, 22, 55, 700],
    [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 900],
    [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 1000],
  ],
  medium: [
    [0.4, 2.75],
    [0, 1.8, 5.1],
    [0, 0, 2.8, 50],
    [0, 0, 1.7, 10, 100],
    [0, 0, 1.4, 4, 14, 390],
    [0, 0, 0, 3, 9, 180, 710],
    [0, 0, 0, 2, 7, 30, 400, 800],
    [0, 0, 0, 2, 4, 11, 67, 400, 900],
    [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000],
    [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000],
  ],
  high: [
    [0, 3.96],
    [0, 0, 17.1],
    [0, 0, 0, 81.5],
    [0, 0, 0, 10, 259],
    [0, 0, 0, 4.5, 48, 450],
    [0, 0, 0, 0, 11, 350, 710],
    [0, 0, 0, 0, 7, 90, 400, 800],
    [0, 0, 0, 0, 5, 20, 270, 600, 900],
    [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000],
    [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000],
  ],
};

export function kenoMultiplier(risk: KenoRisk, picks: number, hits: number): number {
  const row = PAYTABLES[risk][picks - 1];
  if (!row) return 0;
  return row[hits] ?? 0;
}

/** Whole paytable row for a (risk, picks) combo so the UI can show the preview. */
export function kenoPaytable(risk: KenoRisk, picks: number): number[] {
  return PAYTABLES[risk][picks - 1] ?? [];
}

/** Maximum multiplier for a (risk, picks) combo — used by max-win guard. */
export function kenoMaxMultiplier(risk: KenoRisk, picks: number): number {
  const row = PAYTABLES[risk][picks - 1];
  if (!row) return 0;
  let max = 0;
  for (const m of row) if (m > max) max = m;
  return max;
}

export function validateKenoParams(params: unknown): params is KenoParams {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.risk !== "low" && p.risk !== "classic" && p.risk !== "medium" && p.risk !== "high") {
    return false;
  }
  if (!Array.isArray(p.picks)) return false;
  if (p.picks.length < KENO_MIN_PICKS || p.picks.length > KENO_MAX_PICKS) return false;
  const seen = new Set<number>();
  for (const cell of p.picks) {
    if (typeof cell !== "number" || !Number.isInteger(cell)) return false;
    if (cell < 0 || cell >= KENO_GRID) return false;
    if (seen.has(cell)) return false;
    seen.add(cell);
  }
  return true;
}

/**
 * Deterministically draw 10 distinct cells from [0..39] using a Fisher-Yates
 * on an indexed array seeded by the HMAC float stream.
 */
export async function playKeno(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  params: KenoParams,
): Promise<KenoOutcome> {
  // We need up to 10 independent uniforms to pick 10 cells from 40.
  // deriveFloats gives us a batched stream; 10 floats is well within one HMAC.
  const uniforms = await deriveFloats(serverSeedHex, clientSeedHex, nonce, KENO_DRAWS);
  const pool = Array.from({ length: KENO_GRID }, (_, i) => i);
  const draws: number[] = [];
  for (let i = 0; i < KENO_DRAWS; i++) {
    const remaining = pool.length;
    const u = uniforms[i] ?? 0;
    const idx = Math.min(remaining - 1, Math.floor(u * remaining));
    draws.push(pool[idx]!);
    // swap-remove so the next uniform picks from the shrunk pool
    pool[idx] = pool[remaining - 1]!;
    pool.length = remaining - 1;
  }
  const picksSet = new Set(params.picks);
  let hits = 0;
  for (const d of draws) if (picksSet.has(d)) hits++;
  const mult = kenoMultiplier(params.risk, params.picks.length, hits);
  return { draws, hits, win: mult > 0 };
}
