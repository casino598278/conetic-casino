// Gem Clusters — 7×7 cluster-pays slot (NetEnt "Starburst XXXtreme" /
// "Aloha Cluster Pays" style).
// Mechanic:
//   1. Spin a 7×7 grid.
//   2. Find clusters of 5+ orthogonally-connected same-symbol cells.
//   3. Each cluster pays by (symbol, size). Paying cells clear. Tumble.
//   4. No wilds/scatters in v1 — simple clean mechanic so each slot plays
//      noticeably different.
//
// RTP target: ~96%, calibrated by simulation.

import { spinFloats, spinGrid, cloneGrid, pickSymbol, type ReelStrip, type Symbol } from "./reels.js";

export const GC_COLS = 7;
export const GC_ROWS = 7;

const MAX_TUMBLES = 8;
const MAX_FLOATS = GC_COLS * GC_ROWS * (MAX_TUMBLES + 1) + 4;

export const GC_SYMBOLS = ["red", "orange", "yellow", "green", "teal", "purple", "pink"] as const;
export type GCSymbol = (typeof GC_SYMBOLS)[number];

/** Cluster-size → multiplier, per symbol. Larger clusters pay exponentially
 *  more — matches the Aloha Cluster Pays school. Size ≥ 5 required to pay. */
const PAY: Record<string, Partial<Record<number, number>>> = {
  // Premium (rare-weight) symbols pay the most.
  pink:   { 5: 5,    7: 20,   10: 100,  15: 500, 20: 2000 },
  purple: { 5: 3,    7: 12,   10: 60,   15: 300, 20: 1200 },
  teal:   { 5: 2,    7: 8,    10: 40,   15: 200, 20: 800 },
  green:  { 5: 1,    7: 4,    10: 20,   15: 100, 20: 400 },
  yellow: { 5: 0.6,  7: 2.5,  10: 12,   15: 60,  20: 240 },
  orange: { 5: 0.4,  7: 1.5,  10: 8,    15: 40,  20: 160 },
  red:    { 5: 0.2,  7: 1,    10: 5,    15: 25,  20: 100 },
};

/** Reel strip — approximately even with premiums rarer. Same strip per col. */
const STRIP: ReelStrip = {
  symbols: ["red", "orange", "yellow", "green", "teal", "purple", "pink"],
  weights: [ 22,    19,       17,       15,      13,     9,        5 ],
};
const STRIPS: ReelStrip[] = Array.from({ length: GC_COLS }, () => STRIP);

export interface GemClustersParams {
  /** No player choice — stake only. */
}

export interface GCCluster {
  symbol: Symbol;
  cells: [number, number][]; // (col, row)
  pay: number;                // total-bet multiplier for this cluster
}

export interface GCStep {
  grid: Symbol[][];
  clusters: GCCluster[];
  stepPay: number;
}

export interface GemClustersOutcome {
  steps: GCStep[];
  multiplier: number;
  win: boolean;
}

export function validateGemClustersParams(params: unknown): params is GemClustersParams {
  return params != null && typeof params === "object";
}

/** Lookup cluster pay from its size; pay scales with largest threshold hit. */
function clusterPay(symbol: Symbol, size: number): number {
  const table = PAY[symbol];
  if (!table) return 0;
  let best = 0;
  for (const kStr of Object.keys(table)) {
    const k = Number(kStr);
    if (size >= k && (table[k] ?? 0) > best) best = table[k]!;
  }
  return best;
}

/** Flood-fill to find orthogonal same-symbol clusters across the whole grid. */
function findClusters(grid: Symbol[][]): GCCluster[] {
  const visited = Array.from({ length: GC_COLS }, () => new Array<boolean>(GC_ROWS).fill(false));
  const clusters: GCCluster[] = [];
  for (let c = 0; c < GC_COLS; c++) {
    for (let r = 0; r < GC_ROWS; r++) {
      if (visited[c]![r]) continue;
      const sym = grid[c]![r]!;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[c, r]];
      while (stack.length) {
        const [cc, rr] = stack.pop()!;
        if (cc < 0 || cc >= GC_COLS || rr < 0 || rr >= GC_ROWS) continue;
        if (visited[cc]![rr]) continue;
        if (grid[cc]![rr] !== sym) continue;
        visited[cc]![rr] = true;
        cells.push([cc, rr]);
        stack.push([cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]);
      }
      if (cells.length >= 5) {
        const pay = clusterPay(sym, cells.length);
        if (pay > 0) clusters.push({ symbol: sym, cells, pay });
      }
    }
  }
  return clusters;
}

function tumbleRefill(
  grid: Symbol[][],
  cleared: [number, number][],
  floats: number[],
  offsetRef: { i: number },
): Symbol[][] {
  const next = cloneGrid(grid);
  const isCleared = Array.from({ length: GC_COLS }, () => new Array<boolean>(GC_ROWS).fill(false));
  for (const [c, r] of cleared) isCleared[c]![r] = true;
  for (let c = 0; c < GC_COLS; c++) {
    const kept: Symbol[] = [];
    for (let r = GC_ROWS - 1; r >= 0; r--) {
      if (!isCleared[c]![r]) kept.push(next[c]![r]!);
    }
    kept.reverse();
    const needed = GC_ROWS - kept.length;
    const fresh: Symbol[] = [];
    for (let k = 0; k < needed; k++) {
      fresh.push(pickSymbol(STRIPS[c]!, floats[offsetRef.i++] ?? 0));
    }
    const rebuilt = [...fresh, ...kept];
    for (let r = 0; r < GC_ROWS; r++) next[c]![r] = rebuilt[r]!;
  }
  return next;
}

export async function playGemClusters(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  _params: GemClustersParams,
): Promise<GemClustersOutcome> {
  const floats = await spinFloats(serverSeedHex, clientSeedHex, nonce, MAX_FLOATS);
  let grid = spinGrid(STRIPS, GC_COLS, GC_ROWS, floats, 0);
  const offsetRef = { i: GC_COLS * GC_ROWS };
  const steps: GCStep[] = [];
  let total = 0;

  for (let t = 0; t <= MAX_TUMBLES; t++) {
    const clusters = findClusters(grid);
    if (clusters.length === 0) {
      if (t === 0) steps.push({ grid, clusters: [], stepPay: 0 });
      break;
    }
    const stepPay = clusters.reduce((a, k) => a + k.pay, 0);
    steps.push({ grid, clusters, stepPay });
    total += stepPay;
    // Clear all cluster cells and tumble.
    const cleared: [number, number][] = [];
    for (const k of clusters) cleared.push(...k.cells);
    grid = tumbleRefill(grid, cleared, floats, offsetRef);
  }
  return { steps, multiplier: total, win: total > 0 };
}

export function gemClustersMultiplier(outcome: GemClustersOutcome): number {
  return outcome.multiplier;
}

export function gemClustersPaytable(): { symbol: Symbol; pays: Partial<Record<number, number>> }[] {
  return Object.entries(PAY).map(([symbol, pays]) => ({ symbol, pays }));
}
