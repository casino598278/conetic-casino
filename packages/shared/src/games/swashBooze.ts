// Swash Booze — 6x5 cluster-style slot, 1:1 off Pragmatic Play's Sweet Bonanza.
//
// Math summary:
// - 6 columns × 5 rows, pay-anywhere (not paylines).
// - 8+ of the same symbol = win. Payout multiplier scales with count bucket.
// - Tumble mechanic: winning cells removed, new symbols drop, repeat until no win.
// - Bomb symbols place a multiplier value (2×..500×) on a random cell.
//   In the base game, bombs sum within a single spin and multiply that spin's
//   total payout. In free spins, bombs that appear become persistent for the
//   rest of the free-spins round.
// - 4+ lollipop scatters on the INITIAL grid (pre-tumble) → 10 free spins.
// - Bonus buy: pay 100× bet → drop straight into 10 free spins.
//
// Target RTP 96.5% (matches Sweet Bonanza's published 96.51%). Calibrated via
// Monte-Carlo in the sibling .test.ts. Key knobs if RTP drifts:
//   - BOMB_VALUES / BOMB_BOMB_FREQ (bomb contribution → biggest lever)
//   - SYMBOL_WEIGHTS (controls hit frequency per symbol)
//   - PAYTABLE (direct multiplier-per-count)

import { houseHmac, bytesToUnitFloat } from "./houseFair.js";

// ──────────────────────────── constants ────────────────────────────

export const SWASH_GRID_W = 6;
export const SWASH_GRID_H = 5;
export const SWASH_CELLS = SWASH_GRID_W * SWASH_GRID_H; // 30
export const SWASH_MIN_CLUSTER = 8;
export const SWASH_FREE_SPINS = 10;
export const SWASH_SCATTERS_TO_TRIGGER = 4;
export const SWASH_BONUS_BUY_COST = 100;
export const SWASH_HOUSE_RTP = 0.965;
/** Hard cap on any single outcome's payout multiplier. */
export const SWASH_MAX_MULTIPLIER = 21_100;

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
  | "lollipop" // scatter; does not pay as a cluster
  | "bomb";    // multiplier drop; does not pay as a cluster

/** Ordered list of symbols that pay as clusters (everything except lollipop/bomb). */
const PAYING_SYMBOLS: SwashSymbol[] = [
  "red", "purple", "green", "blue",
  "plum", "apple", "watermelon",
  "grape", "banana",
];

const ALL_SYMBOLS: SwashSymbol[] = [
  ...PAYING_SYMBOLS, "lollipop", "bomb",
];

export interface SwashBoozeParams {
  mode: "spin" | "buy";
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
  /** Grid state after any drops + bomb placements for this step. [row][col] */
  grid: SwashSymbol[][];
  /** Cells that pay in this step (pre-tumble). */
  winningCells: Cell[];
  winSymbol: SwashSymbol | null;
  winCount: number;
  /** Multiplier value paid by this step's cluster (before any bomb/persistent multi). */
  stepMultiplier: number;
  /** Bomb multiplier chips revealed this step. */
  bombs: BombDrop[];
}

export interface SwashFreeSpin {
  steps: SwashSpinStep[];
  /** Sum of all persistent bomb values at the time this spin resolved. */
  spinMultTotal: number;
  /** Payout multiplier for this single FS (pre-bet). */
  spinWin: number;
}

export interface SwashOutcome {
  baseSteps: SwashSpinStep[];
  freeSpins: {
    triggered: boolean;
    /** Snapshot of persistent multipliers at the START of each FS. */
    spins: SwashFreeSpin[];
    /** Total payout from free spins alone (pre-bet). */
    fsMultiplier: number;
  };
  /** Combined total payout multiplier (base + FS), pre-bet. */
  multiplier: number;
  win: boolean;
}

// ──────────────────────────── paytable ────────────────────────────

/**
 * Payout multiplier by (symbol, cluster count bucket).
 * Count buckets: 8-9, 10-11, 12+. Matches Sweet Bonanza's 3-tier scheme.
 * Values tuned to combine with symbol weights for ~96.5% RTP.
 */
const PAYTABLE: Record<string, [number, number, number]> = {
  // symbol       [8-9, 10-11, 12+]
  // Calibrated to ~96.5% base-game RTP via Monte-Carlo (see rtp-probe.mjs).
  red:        [0.18, 0.42, 1.25],
  purple:     [0.18, 0.42, 1.25],
  green:      [0.18, 0.42, 1.25],
  blue:       [0.18, 0.42, 1.25],
  plum:       [0.24, 0.62, 1.7],
  apple:      [0.29, 0.85, 2.2],
  watermelon: [0.43, 1.15, 2.9],
  grape:      [0.62, 1.70, 4.3],
  banana:     [0.95, 2.85, 7.2],
};

function paytableMultiplier(symbol: SwashSymbol, count: number): number {
  if (count < SWASH_MIN_CLUSTER) return 0;
  const row = PAYTABLE[symbol];
  if (!row) return 0;
  if (count >= 12) return row[2];
  if (count >= 10) return row[1];
  return row[0];
}

// ──────────────────────────── weights ────────────────────────────

/**
 * Weighted symbol pool for a cell drop in the BASE game.
 * High-pay symbols (banana, grape) are rare; low-pay (red/purple/green/blue)
 * are common. Scatter (lollipop) and bomb are both rare.
 */
const SYMBOL_WEIGHTS_BASE: Array<[SwashSymbol, number]> = [
  ["red",        18],
  ["purple",     18],
  ["green",      18],
  ["blue",       18],
  ["plum",       14],
  ["apple",      12],
  ["watermelon", 10],
  ["grape",       6],
  ["banana",      4],
  ["lollipop",    3],
  ["bomb",        3],
];

/**
 * Free-spins pool — slightly boosted bomb + high-pay rates. Matches the
 * "bonus round is more generous" feel of Sweet Bonanza FS.
 */
const SYMBOL_WEIGHTS_FS: Array<[SwashSymbol, number]> = [
  ["red",        16],
  ["purple",     16],
  ["green",      16],
  ["blue",       16],
  ["plum",       13],
  ["apple",      12],
  ["watermelon", 11],
  ["grape",       7],
  ["banana",      5],
  ["lollipop",    3],
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
 * Bomb multiplier distribution when a "bomb" symbol is converted to a value.
 * Lower values are far more common; high values are rare. Sum of `weight × value`
 * drives RTP contribution from bombs.
 */
const BOMB_VALUE_TABLE: Array<[number, number]> = [
  // [value, weight]. Heavy tail trimmed so a 500× drop is truly rare — at ~4%
  // bomb-symbol rate × 30 cells this would otherwise blow RTP past 2x.
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
  [250, 0.02],
  [500, 0.01],
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

/**
 * Lazy async stream of uniform floats [0, 1) seeded by (server, client, nonce).
 * Pulls a 32-byte HMAC (8 floats) per `round` increment. A slot spin typically
 * burns hundreds, so this batches automatically.
 */
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
  // Use "red" as a placeholder — every cell gets overwritten before use.
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

/**
 * Count occurrences of each paying symbol across the grid. Returns the symbol
 * with the highest count that meets the min-cluster threshold, plus the cells
 * that match it. Lollipop and bomb never pay as clusters.
 *
 * Sweet Bonanza pays ALL symbols that hit the threshold simultaneously; we do
 * the same by returning the full win-set across symbols. Caller folds into the
 * step's stepMultiplier + winningCells.
 */
function findClusterWins(grid: SwashSymbol[][]): {
  wins: Array<{ symbol: SwashSymbol; count: number; cells: Cell[] }>;
  winningCells: Cell[];
} {
  const buckets = new Map<SwashSymbol, Cell[]>();
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      const sym = grid[r]![c]!;
      if (sym === "lollipop" || sym === "bomb") continue;
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

/**
 * Tumble: remove winning cells, drop remaining symbols down within each column,
 * then fill the top of each column with new symbols from the stream.
 */
async function tumble(
  grid: SwashSymbol[][],
  winningCells: Cell[],
  fs: FloatStream,
  weights: Array<[SwashSymbol, number]>,
): Promise<void> {
  const removed = new Set<string>();
  for (const { row, col } of winningCells) removed.add(`${row},${col}`);

  for (let c = 0; c < SWASH_GRID_W; c++) {
    // Collect non-removed cells from bottom to top.
    const kept: SwashSymbol[] = [];
    for (let r = SWASH_GRID_H - 1; r >= 0; r--) {
      if (!removed.has(`${r},${c}`)) {
        kept.push(grid[r]![c]!);
      }
    }
    // Fill from bottom up.
    for (let i = 0; i < kept.length; i++) {
      grid[SWASH_GRID_H - 1 - i]![c] = kept[i]!;
    }
    // Fill the top gaps with new symbols.
    const gap = SWASH_GRID_H - kept.length;
    for (let r = 0; r < gap; r++) {
      grid[r]![c] = pickSymbol(await fs.next(), weights);
    }
  }
}

/**
 * Scan grid for "bomb" placeholder symbols, convert each to a real value, and
 * return the list of drops. Bombs themselves don't pay or tumble as clusters
 * — they're "special" cells that just contribute a multiplier to the spin.
 */
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
 * Run one full spin (initial drop + tumble chain). Returns the ordered steps,
 * the full list of bombs seen across all steps, and the cluster-payout multiplier
 * (sum of paytable hits across all tumble steps, BEFORE applying bomb multis).
 */
async function runSpin(
  fs: FloatStream,
  weights: Array<[SwashSymbol, number]>,
): Promise<{
  steps: SwashSpinStep[];
  bombs: BombDrop[];
  clusterMult: number;
  /** Scatter count on the INITIAL grid only. */
  initialScatters: number;
}> {
  const steps: SwashSpinStep[] = [];
  const allBombs: BombDrop[] = [];
  let clusterMult = 0;

  // Initial drop
  const grid = emptyGrid();
  await fillGrid(grid, fs, weights);

  // Count scatters on the initial grid (used for FS trigger).
  let initialScatters = 0;
  for (let r = 0; r < SWASH_GRID_H; r++) {
    for (let c = 0; c < SWASH_GRID_W; c++) {
      if (grid[r]![c] === "lollipop") initialScatters++;
    }
  }

  // Tumble loop
  // Safety cap — prevents pathological infinite loops in calibration mistakes.
  for (let step = 0; step < 30; step++) {
    const bombs = await revealBombs(grid, fs);
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

  // Base game — skipped when mode === "buy" (bonus buy goes straight to FS).
  let baseSteps: SwashSpinStep[] = [];
  let baseMult = 0;
  let triggered = params.mode === "buy";

  if (params.mode === "spin") {
    const base = await runSpin(fs, SYMBOL_WEIGHTS_BASE);
    baseSteps = base.steps;
    // Base-game payout rule (Sweet Bonanza): bombs apply only when the spin
    // had at least one cluster win. Sum of bomb values × cluster payout.
    // If no bombs landed, cluster payout is paid straight.
    const bombSum = base.bombs.reduce((s, b) => s + b.value, 0);
    if (base.clusterMult > 0) {
      baseMult = bombSum > 0 ? base.clusterMult * bombSum : base.clusterMult;
    }
    if (base.initialScatters >= SWASH_SCATTERS_TO_TRIGGER) triggered = true;
  }

  // Free spins
  let fsMult = 0;
  const fsSpins: SwashFreeSpin[] = [];
  if (triggered) {
    const persistent: number[] = [];
    for (let i = 0; i < SWASH_FREE_SPINS; i++) {
      const r = await runSpin(fs, SYMBOL_WEIGHTS_FS);
      // Persistent multis: FS bombs accumulate across the whole bonus round.
      for (const b of r.bombs) persistent.push(b.value);
      const spinMultTotal = persistent.reduce((s, v) => s + v, 0) || 1;
      const spinWin = r.clusterMult * spinMultTotal;
      fsSpins.push({ steps: r.steps, spinMultTotal, spinWin });
      fsMult += spinWin;
    }
  }

  const rawTotal = baseMult + fsMult;
  const multiplier = Math.min(SWASH_MAX_MULTIPLIER, Math.round(rawTotal * 100) / 100);

  return {
    baseSteps,
    freeSpins: { triggered, spins: fsSpins, fsMultiplier: fsMult },
    multiplier,
    win: multiplier > 0,
  };
}

export function validateSwashBoozeParams(params: unknown): params is SwashBoozeParams {
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  return p.mode === "spin" || p.mode === "buy";
}

/** Theoretical max payout for max-win guard. Returns the published ceiling. */
export function swashBoozeMaxMultiplier(_mode: "spin" | "buy"): number {
  return SWASH_MAX_MULTIPLIER;
}
