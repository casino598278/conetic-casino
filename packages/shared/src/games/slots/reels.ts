// Shared slot primitives: deterministic reel-strip sampling + symbol types.
// Every slot variant draws from a weighted reel strip using one HMAC-derived
// uniform per cell, exactly the same way keno picks cells. This keeps all
// four slot games provably fair under the same verifier.

import { deriveFloats } from "../houseFair.js";

/** A symbol ID as used by paytables. Keep short strings so outcome JSON is cheap. */
export type Symbol = string;

/** One column of the virtual reel. weights[i] = relative frequency of symbols[i]. */
export interface ReelStrip {
  symbols: Symbol[];
  weights: number[]; // positive numbers, any scale
}

/**
 * Pick a symbol deterministically from a reel strip given a uniform u ∈ [0,1).
 * Standard weighted-sample (cumulative-sum walk). O(n) per draw is fine for
 * the ~10 symbol alphabets we use.
 */
export function pickSymbol(strip: ReelStrip, u: number): Symbol {
  let total = 0;
  for (const w of strip.weights) total += w;
  let threshold = u * total;
  for (let i = 0; i < strip.symbols.length; i++) {
    threshold -= strip.weights[i]!;
    if (threshold < 0) return strip.symbols[i]!;
  }
  // Floating-point slack guard — return last symbol.
  return strip.symbols[strip.symbols.length - 1]!;
}

/**
 * Spin a rectangular grid. `strips[col]` is used for every cell in column col
 * (so heavy symbols stay on a single reel like a real slot). Returns a
 * `cols × rows` array indexed `grid[col][row]` (row 0 = top).
 *
 * `uniforms` must have at least `cols * rows` floats. Any extra are ignored —
 * callers producing floats for tumbles / respins just pass a larger stream.
 */
export function spinGrid(
  strips: ReelStrip[],
  cols: number,
  rows: number,
  uniforms: number[],
  offset = 0,
): Symbol[][] {
  const grid: Symbol[][] = [];
  for (let c = 0; c < cols; c++) {
    const col: Symbol[] = [];
    for (let r = 0; r < rows; r++) {
      const u = uniforms[offset + c * rows + r] ?? 0;
      col.push(pickSymbol(strips[c]!, u));
    }
    grid.push(col);
  }
  return grid;
}

/**
 * Convenience: derive enough uniforms for `n` cells worth of draws. Used by
 * slots that might tumble / respin up to some cap — callers request the
 * worst-case count so one HMAC stream covers the whole play.
 */
export async function spinFloats(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  n: number,
): Promise<number[]> {
  return deriveFloats(serverSeedHex, clientSeedHex, nonce, n);
}

/** Shallow copy of a grid so callers can mutate freely during tumbles. */
export function cloneGrid(grid: Symbol[][]): Symbol[][] {
  return grid.map((col) => col.slice());
}
