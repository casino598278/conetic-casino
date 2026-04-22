// Cosmic Lines — classic 5-reel × 3-row, 10 paylines.
// Left-aligned runs: a line pays when 3+ matching symbols start on reel 0.
// Wild (`W`) substitutes for any regular symbol (not scatter).
// Scatter (`S`) pays anywhere: 3+ scatters = free-spins round at x3 multiplier.
//
// The paytable + weights were hand-tuned to land close to 96% RTP in
// simulation (see cosmicLines.test.ts). Bet = 10 lines × stake/10, so the
// multiplier the engine sees is (total_win / total_bet).

import { spinFloats, spinGrid, type ReelStrip, type Symbol } from "./reels.js";

export const COSMIC_COLS = 5;
export const COSMIC_ROWS = 3;
export const COSMIC_LINES = 10;
/** One HMAC stream covers: base spin (15) + up to 10 free spins × 15 = 165. */
const MAX_FLOATS = COSMIC_COLS * COSMIC_ROWS * 11;

/** Symbols: ordered by rarity ascending (A = premium, cherry = low). */
export const COSMIC_SYMBOLS = [
  "cherry",   // low
  "lemon",
  "bell",
  "star",
  "seven",    // high
  "W",        // wild
  "S",        // scatter
] as const;

/** Paytable[symbol] = [pay_for_3, pay_for_4, pay_for_5] line-multipliers.
 *  A "line multiplier" is paid relative to per-line stake. Because the player
 *  pays `bet` split across 10 lines, a line-mult of 5× with 1 hit = 0.5× of
 *  the total bet. Scatter pays are total-bet multipliers. */
const LINE_PAYS: Record<string, [number, number, number]> = {
  cherry: [2, 5, 15],
  lemon:  [2, 5, 20],
  bell:   [5, 20, 75],
  star:   [10, 40, 150],
  seven:  [25, 100, 500],
  W:      [10, 40, 150], // wild pays like star when it stands alone on a line
};

/** Scatter pays: key = scatter count, value = total-bet multiplier. */
const SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 10, 5: 100 };

const FREE_SPINS_AWARDED = 10;
const FREE_SPIN_MULT = 3;

/** 10 fixed paylines, each (col, row) from reel 0 to reel 4. Standard shapes. */
const PAYLINES: [number, number][][] = [
  [[0,1],[1,1],[2,1],[3,1],[4,1]], // middle row
  [[0,0],[1,0],[2,0],[3,0],[4,0]], // top row
  [[0,2],[1,2],[2,2],[3,2],[4,2]], // bottom row
  [[0,0],[1,1],[2,2],[3,1],[4,0]], // V
  [[0,2],[1,1],[2,0],[3,1],[4,2]], // ^
  [[0,1],[1,0],[2,0],[3,0],[4,1]], // upper zigzag
  [[0,1],[1,2],[2,2],[3,2],[4,1]], // lower zigzag
  [[0,0],[1,0],[2,1],[3,2],[4,2]], // diag down
  [[0,2],[1,2],[2,1],[3,0],[4,0]], // diag up
  [[0,1],[1,2],[2,1],[3,0],[4,1]], // W
];

/** Reel strips — heavily weighted toward low symbols, rare wilds and scatters.
 *  Same strip on every reel keeps the math simple and the RTP stable. */
const STRIP: ReelStrip = {
  symbols: ["cherry", "lemon", "bell", "star", "seven", "W", "S"],
  weights: [ 30,       28,      18,     11,     5,       3,  5 ],
};
const STRIPS: ReelStrip[] = Array.from({ length: COSMIC_COLS }, () => STRIP);

export type CosmicSymbol = (typeof COSMIC_SYMBOLS)[number];

export interface CosmicParams {
  /** No player choice beyond stake — but keep the shape for parity with other games. */
  lines?: number; // always 10; accepted for future expansion
}

export interface CosmicLineWin {
  lineIndex: number;
  symbol: Symbol;
  count: number;        // 3..5
  multiplier: number;   // line-mult
}

export interface CosmicSpinResult {
  grid: Symbol[][];            // [col][row]
  lineWins: CosmicLineWin[];
  scatterCount: number;
  scatterPay: number;          // total-bet multiplier (0 if none)
  freeSpinAwarded: number;     // how many free spins this spin unlocked
  multiplier: number;          // total payout this spin (in total-bet units)
}

export interface CosmicOutcome {
  baseSpin: CosmicSpinResult;
  freeSpins: CosmicSpinResult[]; // empty unless baseSpin awarded free spins
  win: boolean;
}

export function validateCosmicParams(params: unknown): params is CosmicParams {
  if (params == null || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.lines != null && p.lines !== COSMIC_LINES) return false;
  return true;
}

/** Resolve one 5×3 spin — fills lineWins/scatterPay/multiplier. */
function resolveSpin(grid: Symbol[][], freeSpinMultiplier = 1): CosmicSpinResult {
  const lineWins: CosmicLineWin[] = [];
  let lineMultTotal = 0; // sum of line-mults (still need /lines for bet-frac)

  for (let i = 0; i < PAYLINES.length; i++) {
    const line = PAYLINES[i]!;
    // Identify the base symbol (first non-wild, or W if line is all wilds).
    let base: Symbol | null = null;
    for (const [c, r] of line) {
      const s = grid[c]![r]!;
      if (s === "S") { base = null; break; } // scatters never form line wins
      if (s !== "W") { base = s; break; }
    }
    if (base === null) continue;
    // Count from the left how many cells match base (wilds match anything).
    let count = 0;
    for (const [c, r] of line) {
      const s = grid[c]![r]!;
      if (s === base || s === "W") count++;
      else break;
    }
    if (count < 3) continue;
    const pay = LINE_PAYS[base];
    if (!pay) continue;
    const mult = pay[count - 3]!;
    if (mult <= 0) continue;
    lineWins.push({ lineIndex: i, symbol: base, count, multiplier: mult });
    lineMultTotal += mult;
  }

  // Each line-mult is paid relative to per-line stake (= bet / LINES).
  // So the total-bet fraction is sum(line_mults) / LINES.
  const linesFrac = lineMultTotal / COSMIC_LINES;

  // Scatter count across entire grid.
  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (s === "S") scatterCount++;
  const scatterPay = SCATTER_PAYS[scatterCount] ?? 0;
  const freeSpinAwarded = scatterCount >= 3 ? FREE_SPINS_AWARDED : 0;

  const multiplier = (linesFrac + scatterPay) * freeSpinMultiplier;

  return {
    grid,
    lineWins,
    scatterCount,
    scatterPay: scatterPay * freeSpinMultiplier,
    freeSpinAwarded,
    multiplier,
  };
}

export async function playCosmicLines(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  _params: CosmicParams,
): Promise<CosmicOutcome> {
  const floats = await spinFloats(serverSeedHex, clientSeedHex, nonce, MAX_FLOATS);
  const base = resolveSpin(spinGrid(STRIPS, COSMIC_COLS, COSMIC_ROWS, floats, 0));
  const freeSpins: CosmicSpinResult[] = [];
  let offset = COSMIC_COLS * COSMIC_ROWS;
  if (base.freeSpinAwarded > 0) {
    for (let i = 0; i < base.freeSpinAwarded; i++) {
      const g = spinGrid(STRIPS, COSMIC_COLS, COSMIC_ROWS, floats, offset);
      offset += COSMIC_COLS * COSMIC_ROWS;
      // Free spins do NOT retrigger (classic rule) — resolveSpin still reports
      // freeSpinAwarded, but we ignore it here.
      freeSpins.push(resolveSpin(g, FREE_SPIN_MULT));
    }
  }
  const total = base.multiplier + freeSpins.reduce((a, s) => a + s.multiplier, 0);
  return {
    baseSpin: base,
    freeSpins,
    win: total > 0,
  };
}

/** Total payout multiplier (total-bet units) for an outcome. */
export function cosmicMultiplier(outcome: CosmicOutcome): number {
  return outcome.baseSpin.multiplier + outcome.freeSpins.reduce((a, s) => a + s.multiplier, 0);
}

/** Paytable for UI preview. */
export function cosmicPaytable(): { symbol: Symbol; pays: [number, number, number] }[] {
  return Object.entries(LINE_PAYS).map(([symbol, pays]) => ({ symbol, pays }));
}

export function cosmicScatterPays(): Record<number, number> {
  return { ...SCATTER_PAYS };
}
