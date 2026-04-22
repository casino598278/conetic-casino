// Lucky Sevens — 3-reel × 3-row classic fruit slot with a "hold and respin"
// bonus. Le Bandit / classic AWP lineage.
// Mechanic:
//   1. Spin the 3×3 grid.
//   2. Evaluate 5 paylines (3 rows, 2 diagonals) — any 3-of-a-kind pays.
//   3. If a spin lands any 7s anywhere on the grid, the 7s LOCK and all other
//      cells re-spin ONCE. If any new 7s arrive, they also lock (one cascade).
//      Full grid of 7s pays the jackpot.
//   4. No scatters/wilds — clean classic feel. Jackpot = 1000×.
//
// RTP target: ~96%, calibrated in tests.

import { spinFloats, spinGrid, pickSymbol, type ReelStrip, type Symbol } from "./reels.js";

export const LS_COLS = 3;
export const LS_ROWS = 3;

const MAX_FLOATS = LS_COLS * LS_ROWS * 3 + 4; // base + up to 2 respin passes

export const LS_SYMBOLS = ["cherry", "lemon", "bell", "bar", "7"] as const;
export type LSSymbol = (typeof LS_SYMBOLS)[number];

/** 3-of-a-kind payouts (total-bet multipliers, paid *per line*).
 *  Tuned for ~96% RTP across 5 paylines given the STRIP weights below. */
const PAY3: Record<string, number> = {
  cherry: 0.5,
  lemon:  1,
  bell:   2.5,
  bar:    8,
  "7":    50,
};

const JACKPOT = 500;

const PAYLINES: [number, number][][] = [
  [[0,0],[1,0],[2,0]],
  [[0,1],[1,1],[2,1]],
  [[0,2],[1,2],[2,2]],
  [[0,0],[1,1],[2,2]],
  [[0,2],[1,1],[2,0]],
];

const STRIP: ReelStrip = {
  symbols: ["cherry", "lemon", "bell", "bar", "7"],
  weights: [ 34,       28,      20,     12,    6 ],
};
const STRIPS: ReelStrip[] = Array.from({ length: LS_COLS }, () => STRIP);

export interface LuckySevensParams {
  /** Placeholder for future wager options. */
}

export interface LSSpinStep {
  grid: Symbol[][];
  lockedSevens: [number, number][]; // cells holding a 7 going into this step
}

export interface LuckySevensOutcome {
  steps: LSSpinStep[];           // 1 step if no 7s hit, 2 if one respin, 3 if chain
  lineWins: { lineIndex: number; symbol: Symbol; count: number; pay: number }[];
  jackpot: boolean;
  multiplier: number;
  win: boolean;
}

export function validateLuckySevensParams(params: unknown): params is LuckySevensParams {
  return params != null && typeof params === "object";
}

function evalLines(grid: Symbol[][]): LuckySevensOutcome["lineWins"] {
  const wins: LuckySevensOutcome["lineWins"] = [];
  for (let i = 0; i < PAYLINES.length; i++) {
    const line = PAYLINES[i]!;
    const syms = line.map(([c, r]) => grid[c]![r]!);
    if (syms[0] === syms[1] && syms[1] === syms[2]) {
      const pay = PAY3[syms[0]!] ?? 0;
      if (pay > 0) wins.push({ lineIndex: i, symbol: syms[0]!, count: 3, pay });
    }
  }
  return wins;
}

function collectSevens(grid: Symbol[][]): [number, number][] {
  const out: [number, number][] = [];
  for (let c = 0; c < LS_COLS; c++) {
    for (let r = 0; r < LS_ROWS; r++) {
      if (grid[c]![r] === "7") out.push([c, r]);
    }
  }
  return out;
}

/** Produce a new grid where locked cells keep their symbol and the rest
 *  are redrawn from their column's reel strip using successive floats. */
function respinGrid(
  prev: Symbol[][],
  locked: [number, number][],
  floats: number[],
  offsetRef: { i: number },
): Symbol[][] {
  const lockedSet = new Set(locked.map(([c, r]) => `${c},${r}`));
  const next: Symbol[][] = [];
  for (let c = 0; c < LS_COLS; c++) {
    const col: Symbol[] = [];
    for (let r = 0; r < LS_ROWS; r++) {
      if (lockedSet.has(`${c},${r}`)) {
        col.push(prev[c]![r]!);
      } else {
        col.push(pickSymbol(STRIPS[c]!, floats[offsetRef.i++] ?? 0));
      }
    }
    next.push(col);
  }
  return next;
}

export async function playLuckySevens(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  _params: LuckySevensParams,
): Promise<LuckySevensOutcome> {
  const floats = await spinFloats(serverSeedHex, clientSeedHex, nonce, MAX_FLOATS);
  const offsetRef = { i: LS_COLS * LS_ROWS };
  const baseGrid = spinGrid(STRIPS, LS_COLS, LS_ROWS, floats, 0);
  const steps: LSSpinStep[] = [{ grid: baseGrid, lockedSevens: [] }];

  let grid = baseGrid;
  // Up to two respin passes while new 7s keep appearing.
  for (let pass = 0; pass < 2; pass++) {
    const sevens = collectSevens(grid);
    if (sevens.length === 0) break;
    // If all 9 cells are 7s already, no need to respin.
    if (sevens.length === LS_COLS * LS_ROWS) break;
    const next = respinGrid(grid, sevens, floats, offsetRef);
    steps.push({ grid: next, lockedSevens: sevens });
    // Stop if the respin didn't produce any new 7s.
    const newSevens = collectSevens(next);
    if (newSevens.length === sevens.length) { grid = next; break; }
    grid = next;
  }

  const sevensFinal = collectSevens(grid);
  const jackpot = sevensFinal.length === LS_COLS * LS_ROWS;
  const lineWins = evalLines(grid);
  const lineTotal = lineWins.reduce((a, w) => a + w.pay, 0);
  const multiplier = jackpot ? JACKPOT : lineTotal;

  return {
    steps,
    lineWins,
    jackpot,
    multiplier,
    win: multiplier > 0,
  };
}

export function luckySevensMultiplier(outcome: LuckySevensOutcome): number {
  return outcome.multiplier;
}

export function luckySevensPaytable(): { symbol: Symbol; pay3: number }[] {
  return Object.entries(PAY3).map(([symbol, pay3]) => ({ symbol, pay3 }));
}

export function luckySevensJackpot(): number {
  return JACKPOT;
}
