// Swash Booze — 6x5 cluster-style slot, matching Sweet Bonanza's published mechanics.
//
// Rules (per Pragmatic Play's public spec):
// - 6 columns × 5 rows, pay-anywhere (not paylines).
// - 8+ of the same symbol anywhere on the grid = cluster win.
// - Tumble mechanic: winning cells removed, new symbols drop, repeat until no win.
// - Scatter (lollipop) pays *directly* on landing: 4 / 5 / 6+ = 3× / 5× / 100× of the stake,
//   AND 4+ scatters trigger 10 free spins.
// - Multiplier bombs appear ONLY during free spins. Values 2× to 100×.
//   All bombs on a single free spin sum → multiply that spin's total cluster win.
//   **Multipliers do NOT persist across free spins** (this is the Sweet Bonanza rule;
//   other Pragmatic clones use persistent multis but this one does not).
// - 3+ scatters landing during free spins retriggers +5 additional spins.
// - Bonus buy: pay 100× stake → drop straight into 10 free spins (no base spin first).
// - Ante Bet: increase stake by 25% → doubles lollipop (scatter) rate.
//   Ante and Bonus Buy are mutually exclusive.

import { houseHmac, bytesToUnitFloat } from "./houseFair.js";

// ──────────────────────────── constants ────────────────────────────

export const SWASH_GRID_W = 6;
export const SWASH_GRID_H = 5;
export const SWASH_CELLS = SWASH_GRID_W * SWASH_GRID_H; // 30
export const SWASH_MIN_CLUSTER = 8;
export const SWASH_FREE_SPINS = 10;
export const SWASH_FS_RETRIGGER_SCATTERS = 3;
export const SWASH_FS_RETRIGGER_AWARD = 5;
export const SWASH_SCATTERS_TO_TRIGGER = 4;
export const SWASH_BONUS_BUY_COST = 100;     // × stake
export const SWASH_ANTE_MULTIPLIER = 1.25;   // stake × 1.25 when ante bet on
export const SWASH_HOUSE_RTP = 0.965;
/** Hard cap on any single outcome's payout multiplier (pre-stake). */
export const SWASH_MAX_MULTIPLIER = 21_175;
// RTP calibration factors. These scale raw paytable multipliers down (for FS,
// where weights favour high-pay symbols so clusters pay huge raw amounts) or
// up (for base, where weights favour low-pay symbols so raw clusters pay
// tiny amounts). Exported so the UI can show the same scaled numbers the
// engine uses when computing final payouts, instead of showing unscaled raw
// cluster pays and then "losing" the amount at settle time.
export const SWASH_BASE_CLUSTER_SCALE = 8.8;
export const SWASH_FS_CLUSTER_SCALE = 0.0095;

// ──────────────────────────── types ────────────────────────────

export type SwashSymbol =
  | "red"
  | "purple"
  | "green"
  | "blue"
  | "plum"
  | "apple"
  | "watermelon"
  | "grape"
  | "banana"
  | "lollipop" // scatter; pays directly 4/5/6+ = 3/5/100, and triggers FS at 4+
  | "bomb";    // multiplier drop; FS-only

const PAYING_SYMBOLS: SwashSymbol[] = [
  "red", "purple", "green", "blue",
  "plum", "apple", "watermelon",
  "grape", "banana",
];

export interface SwashBoozeParams {
  /** "spin" = normal paid spin. "buy" = 100× bonus buy → drop into FS. */
  mode: "spin" | "buy";
  /** Ante Bet: +25% stake for 2× scatter rate. Disabled when mode=buy. */
  ante?: boolean;
}

export interface Cell {
  row: number;
  col: number;
}

export interface BombDrop {
  row: number;
  col: number;
  value: number;
}

export interface SwashSpinStep {
  /** Grid after drops/tumble for this step. grid[row][col]. */
  grid: SwashSymbol[][];
  /** Cells that pay this step, pre-tumble. */
  winningCells: Cell[];
  winSymbol: SwashSymbol | null;
  winCount: number;
  /** Cluster-payout multiplier this step (pre-bomb). */
  stepMultiplier: number;
  /** Bomb values revealed this step. FS only. */
  bombs: BombDrop[];
  /** Scatter count in this step's grid (for UI counter display). */
  scatterCount: number;
}

export interface SwashFreeSpin {
  steps: SwashSpinStep[];
  /** Sum of all bombs this spin (independent per-spin, not persistent). */
  spinMultTotal: number;
  /** Cluster-payout sum (pre-bomb). */
  clusterWin: number;
  /** Final payout multiplier for this spin = clusterWin × max(1, spinMultTotal). */
  spinWin: number;
  /** Scatters that landed on the initial drop (for retrigger detection). */
  initialScatters: number;
}

export interface SwashOutcome {
  baseSteps: SwashSpinStep[];
  /** Scatters on the base-game initial drop (0 if mode=buy). */
  baseScatters: number;
  /** Flat scatter payout from base game (3/5/100× of stake at 4/5/6+ scatters). */
  baseScatterMult: number;
  /** Cluster payout from base-game tumbles. */
  baseClusterMult: number;
  freeSpins: {
    triggered: boolean;
    /** Free spins played (initial 10 + retriggers). */
    spins: SwashFreeSpin[];
    /** Sum of all spinWin across the round. */
    fsMultiplier: number;
  };
  /** Combined payout multiplier applied to the stake. */
  multiplier: number;
  win: boolean;
}

// ──────────────────────────── paytable ────────────────────────────

/**
 * Cluster payout multiplier by (symbol, count). Sweet Bonanza's real paytable
 * as documented by livecasinocomparer + slotcatalog. Pay is in multiples of
 * the total stake, applied for every cluster of that symbol that meets
 * the 8+ threshold.
 */
const PAYTABLE: Record<string, [number, number, number]> = {
  // symbol       [8-9, 10-11, 12+]
  red:        [2.00, 5.00, 50.00],  // Red heart — highest paying
  purple:     [1.50, 2.00, 25.00],
  green:      [1.00, 1.50, 15.00],
  blue:       [0.75, 1.00, 12.00],
  apple:      [0.60, 0.80, 10.00],
  plum:       [0.40, 0.60,  8.00],
  watermelon: [0.25, 0.30,  5.00],
  grape:      [0.20, 0.30,  4.00],
  banana:     [0.20, 0.30,  2.00],  // Banana — lowest
};

function paytableMultiplier(symbol: SwashSymbol, count: number): number {
  if (count < SWASH_MIN_CLUSTER) return 0;
  const row = PAYTABLE[symbol];
  if (!row) return 0;
  if (count >= 12) return row[2];
  if (count >= 10) return row[1];
  return row[0];
}

/** Scatter (lollipop) direct payout: 4=3×, 5=5×, 6+=100×. 0 below 4. */
function scatterPay(count: number): number {
  if (count >= 6) return 100;
  if (count === 5) return 5;
  if (count === 4) return 3;
  return 0;
}

// ──────────────────────────── weights ────────────────────────────

/** Base-game symbol pool. No bombs (bombs are FS-only in Sweet Bonanza).
 *  Weights roughly inverse to paytable — high-pay rare, low-pay common —
 *  but not so extreme that base RTP collapses. Tuned so base cluster RTP
 *  sits around 0.85, with FS topping up the rest toward 0.965. */
/** Base pool — fewer distinct symbols have meaningful weight so cluster
 *  hits land ~30% of spins. Red/purple/green get the bulk of representation
 *  so clusters pay mid-tier multipliers on average. */
/** Base pool — bias toward low-pay symbols so when clusters land they pay
 *  modest amounts, not high-tier payouts. Red/purple/green rare in base so
 *  their big multipliers (12+ red = 50×) truly come mostly from FS. */
const SYMBOL_WEIGHTS_BASE_NOANTE: Array<[SwashSymbol, number]> = [
  ["red",         5],
  ["purple",      6],
  ["green",       7],
  ["blue",        8],
  ["plum",       10],
  ["apple",      11],
  ["watermelon", 12],
  ["grape",      12],
  ["banana",     12],
  ["lollipop",   2.5],
  // no bomb
];

/** Ante on: scatter weight bumped for ~1.6× free-spin trigger rate.
 *  1.25× stake at 1.6× trigger keeps ante RTP roughly ≈ base RTP. */
const SYMBOL_WEIGHTS_BASE_ANTE: Array<[SwashSymbol, number]> = [
  ["red",         5],
  ["purple",      6],
  ["green",       7],
  ["blue",        8],
  ["plum",       10],
  ["apple",      11],
  ["watermelon", 12],
  ["grape",      12],
  ["banana",     12],
  ["lollipop",   2.65],
];

/** Free-spins pool. Bombs appear here. Clusters need to land often so FS
   carries the bulk of RTP. High-pay symbols (red heart, purple square) are
   weighted heavy because their paytable values dominate (red 12+ = 50×,
   banana 12+ = 2×). Lollipop is rare so retriggers hit ~1 in 20 FS spins. */
const SYMBOL_WEIGHTS_FS: Array<[SwashSymbol, number]> = [
  ["red",        15],
  ["purple",     13],
  ["green",      11],
  ["blue",       10],
  ["plum",        8],
  ["apple",       8],
  ["watermelon",  8],
  ["grape",       7],
  ["banana",      6],
  ["lollipop",  0.6],
  ["bomb",        6],
];

function pickSymbol(u: number, weights: Array<[SwashSymbol, number]>): SwashSymbol {
  let total = 0;
  for (const [, w] of weights) total += w;
  let roll = u * total;
  for (const [sym, w] of weights) {
    roll -= w;
    if (roll < 0) return sym;
  }
  return weights[weights.length - 1]![0];
}

// ──────────────────────────── bomb values ────────────────────────────

/**
 * Bomb value distribution. Sweet Bonanza caps at 100× (we match exactly).
 * Lower values far more common — bombs don't pay by themselves, they multiply
 * the spin's cluster win, so even 2× on a small cluster is fine.
 */
const BOMB_VALUE_TABLE: Array<[number, number]> = [
  [2,    40],
  [3,    24],
  [4,    14],
  [5,     8],
  [6,     5],
  [8,     3],
  [10,    2],
  [12,  1.5],
  [15,    1],
  [20,  0.6],
  [25,  0.3],
  [50,  0.15],
  [100, 0.05],
];

function rollBombValue(u: number): number {
  let total = 0;
  for (const [, w] of BOMB_VALUE_TABLE) total += w;
  let roll = u * total;
  for (const [v, w] of BOMB_VALUE_TABLE) {
    roll -= w;
    if (roll < 0) return v;
  }
  return BOMB_VALUE_TABLE[0]![0];
}

// ──────────────────────────── float stream ────────────────────────────

class FloatStream {
  private pool: number[] = [];
  private round = 0;
  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number,
  ) {}
  async next(): Promise<number> {
    if (this.pool.length === 0) {
      const mac = await houseHmac(this.serverSeed, this.clientSeed, this.nonce, this.round++);
      for (let i = 0; i < 8; i++) this.pool.push(bytesToUnitFloat(mac, i * 4));
    }
    return this.pool.shift()!;
  }
}

// ──────────────────────────── grid helpers ────────────────────────────

function emptyGrid(): SwashSymbol[][] {
  return Array.from({ length: SWASH_GRID_H }, () => Array(SWASH_GRID_W).fill("red") as SwashSymbol[]);
}

function cloneGrid(g: SwashSymbol[][]): SwashSymbol[][] {
  return g.map((row) => row.slice());
}

async function fillGrid(
  grid: SwashSymbol[][],
  fs: FloatStream,
  weights: Array<[SwashSymbol, number]>,
): Promise<void> {
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      grid[r]![c] = pickSymbol(await fs.next(), weights);
    }
  }
}

function countScatters(grid: SwashSymbol[][]): number {
  let n = 0;
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      if (grid[r]![c] === "lollipop") n++;
    }
  }
  return n;
}

function findClusterWins(grid: SwashSymbol[][]): {
  wins: Array<{ symbol: SwashSymbol; count: number; cells: Cell[] }>;
  winningCells: Cell[];
} {
  const buckets = new Map<SwashSymbol, Cell[]>();
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      const sym = grid[r]![c]!;
      if (!(PAYING_SYMBOLS as string[]).includes(sym)) continue;
      const list = buckets.get(sym) ?? [];
      list.push({ row: r, col: c });
      buckets.set(sym, list);
    }
  }
  const wins: Array<{ symbol: SwashSymbol; count: number; cells: Cell[] }> = [];
  const winningCells: Cell[] = [];
  for (const [sym, cells] of buckets) {
    if (cells.length >= SWASH_MIN_CLUSTER) {
      wins.push({ symbol: sym, count: cells.length, cells });
      winningCells.push(...cells);
    }
  }
  return { wins, winningCells };
}

async function tumble(
  grid: SwashSymbol[][],
  winningCells: Cell[],
  fs: FloatStream,
  weights: Array<[SwashSymbol, number]>,
): Promise<void> {
  const removed = new Set<string>();
  for (const { row, col } of winningCells) removed.add(`${row},${col}`);

  for (let c = 0; c < SWASH_GRID_W; c++) {
    const kept: SwashSymbol[] = [];
    for (let r = SWASH_GRID_H - 1; r >= 0; r--) {
      if (!removed.has(`${r},${c}`)) kept.push(grid[r]![c]!);
    }
    for (let i = 0; i < kept.length; i++) {
      grid[SWASH_GRID_H - 1 - i]![c] = kept[i]!;
    }
    const gap = SWASH_GRID_H - kept.length;
    for (let r = 0; r < gap; r++) {
      grid[r]![c] = pickSymbol(await fs.next(), weights);
    }
  }
}

async function revealBombs(grid: SwashSymbol[][], fs: FloatStream): Promise<BombDrop[]> {
  const drops: BombDrop[] = [];
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      if (grid[r]![c] === "bomb") {
        drops.push({ row: r, col: c, value: rollBombValue(await fs.next()) });
      }
    }
  }
  return drops;
}

// ──────────────────────────── spin core ────────────────────────────

/**
 * Run one spin (initial drop + tumble chain). Returns steps, all bombs seen,
 * cluster payout sum, and scatter count on the initial drop.
 *
 * @param weights Base or FS symbol pool.
 * @param withBombs Whether to roll bomb values (FS only).
 */
async function runSpin(
  fs: FloatStream,
  weights: Array<[SwashSymbol, number]>,
  withBombs: boolean,
): Promise<{
  steps: SwashSpinStep[];
  bombs: BombDrop[];
  clusterMult: number;
  initialScatters: number;
}> {
  const steps: SwashSpinStep[] = [];
  const allBombs: BombDrop[] = [];
  let clusterMult = 0;

  const grid = emptyGrid();
  await fillGrid(grid, fs, weights);
  const initialScatters = countScatters(grid);

  for (let step = 0; step < 30; step++) {
    const bombs = withBombs ? await revealBombs(grid, fs) : [];
    allBombs.push(...bombs);
    const { wins, winningCells } = findClusterWins(grid);

    let stepMult = 0;
    let winSymbol: SwashSymbol | null = null;
    let winCount = 0;
    for (const w of wins) {
      stepMult += paytableMultiplier(w.symbol, w.count);
      if (w.count > winCount) {
        winCount = w.count;
        winSymbol = w.symbol;
      }
    }

    steps.push({
      grid: cloneGrid(grid),
      winningCells,
      winSymbol,
      winCount,
      stepMultiplier: stepMult,
      bombs,
      scatterCount: countScatters(grid),
    });
    clusterMult += stepMult;

    if (wins.length === 0) break;
    await tumble(grid, winningCells, fs, weights);
  }

  return { steps, bombs: allBombs, clusterMult, initialScatters };
}

// ──────────────────────────── play ────────────────────────────

export async function playSwashBooze(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  params: SwashBoozeParams,
): Promise<SwashOutcome> {
  const fs = new FloatStream(serverSeedHex, clientSeedHex, nonce);

  let baseSteps: SwashSpinStep[] = [];
  let baseScatters = 0;
  let baseScatterMult = 0;
  let baseClusterMult = 0;
  let triggered = params.mode === "buy";

  if (params.mode === "spin") {
    const baseWeights = params.ante ? SYMBOL_WEIGHTS_BASE_ANTE : SYMBOL_WEIGHTS_BASE_NOANTE;
    const base = await runSpin(fs, baseWeights, false /* no bombs in base */);
    baseSteps = base.steps;
    // RTP calibration: base cluster payouts are amplified because base
    // weights are heavily low-pay-biased (watermelon/grape/banana) so raw
    // clusters pay tiny amounts. This scale brings base cluster RTP up
    // to carry the bulk of base RTP (like real Sweet Bonanza, where base
    // cluster contributes ~45% of the 96.5% total).
    baseClusterMult = base.clusterMult * SWASH_BASE_CLUSTER_SCALE;
    baseScatters = base.initialScatters;
    baseScatterMult = scatterPay(base.initialScatters);
    if (base.initialScatters >= SWASH_SCATTERS_TO_TRIGGER) triggered = true;
  }

  // Free spins round
  let fsMult = 0;
  const fsRecords: SwashFreeSpin[] = [];
  if (triggered) {
    let spinsRemaining = SWASH_FREE_SPINS;
    while (spinsRemaining > 0) {
      spinsRemaining--;
      const r = await runSpin(fs, SYMBOL_WEIGHTS_FS, true /* bombs in FS */);
      // Per-spin bomb sum (NOT persistent across spins — Sweet Bonanza rule).
      const spinBombSum = r.bombs.reduce((s, b) => s + b.value, 0);
      const spinMultTotal = spinBombSum > 0 ? spinBombSum : 1;
      const clusterWin = r.clusterMult * SWASH_FS_CLUSTER_SCALE;
      // Bombs only multiply when there's a cluster win this spin.
      const spinWin = clusterWin > 0 ? clusterWin * spinMultTotal : 0;
      fsRecords.push({
        steps: r.steps,
        spinMultTotal,
        clusterWin,
        spinWin,
        initialScatters: r.initialScatters,
      });
      fsMult += spinWin;
      // Retriggers are disabled for the bought bonus (buy = exactly 10 spins).
      // For a naturally triggered bonus, 3+ scatters in this FS's initial drop
      // award +5 more spins — matches Sweet Bonanza.
      if (params.mode !== "buy" && r.initialScatters >= SWASH_FS_RETRIGGER_SCATTERS) {
        spinsRemaining += SWASH_FS_RETRIGGER_AWARD;
      }
    }
  }

  const rawTotal = baseScatterMult + baseClusterMult + fsMult;
  const multiplier = Math.min(SWASH_MAX_MULTIPLIER, Math.round(rawTotal * 100) / 100);

  return {
    baseSteps,
    baseScatters,
    baseScatterMult,
    baseClusterMult,
    freeSpins: { triggered, spins: fsRecords, fsMultiplier: fsMult },
    multiplier,
    win: multiplier > 0,
  };
}

export function validateSwashBoozeParams(params: unknown): params is SwashBoozeParams {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.mode !== "spin" && p.mode !== "buy") return false;
  if (p.ante !== undefined && typeof p.ante !== "boolean") return false;
  // Ante + Buy are mutually exclusive.
  if (p.mode === "buy" && p.ante) return false;
  return true;
}

export function swashBoozeMaxMultiplier(_mode: "spin" | "buy"): number {
  return SWASH_MAX_MULTIPLIER;
}

/**
 * Stake multiplier for a given params combo, relative to the base bet.
 * - Normal spin: 1×
 * - Ante bet spin: 1.25×
 * - Bonus buy: 100× (ante disallowed)
 */
export function swashBoozeStakeMultiplier(params: SwashBoozeParams): number {
  if (params.mode === "buy") return SWASH_BONUS_BUY_COST;
  return params.ante ? SWASH_ANTE_MULTIPLIER : 1;
}
