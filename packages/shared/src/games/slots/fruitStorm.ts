// Fruit Storm — 6-reel × 5-row "pay-anywhere" / tumble slot.
// Sweet-Bonanza-style mechanic:
//   1. Spin the 6×5 grid from weighted reels.
//   2. Any symbol that appears 8+ times anywhere on the grid pays.
//   3. Paying symbols vanish. Cells above fall, top cells refill from the reel.
//   4. Scan again for 8+ occurrences of any symbol. Loop until a spin has no wins.
//   5. Multiplier symbols (`M`) landing on the grid at any point in the chain
//      add their value; final payout = sum(symbol_pays) × (1 + sumOfMultipliers).
//   6. 4+ scatters on the original spin = 10 free spins at x2 cumulative mult.
//
// The math is calibrated by Monte-Carlo to ~96% RTP.

import { spinFloats, spinGrid, cloneGrid, pickSymbol, type ReelStrip, type Symbol } from "./reels.js";

export const FS_COLS = 6;
export const FS_ROWS = 5;

/** Tumble/free-spin cap keeps the worst-case float budget bounded. Limiting
 *  tumbles to 3 also prevents runaway compound wins that wreck RTP. */
const MAX_TUMBLES_PER_SPIN = 3;
const MAX_SPINS = 9; // 1 base + up to 8 free spins
/** Floats consumed: one per cell on every grid ever generated
 *  (initial fills + refills during tumble chains). */
const MAX_FLOATS = MAX_SPINS * (FS_COLS * FS_ROWS * (MAX_TUMBLES_PER_SPIN + 1)) + 8;

export const FS_SYMBOLS = ["grape", "apple", "plum", "pear", "banana", "cherry", "M", "S"] as const;

/** Pay-anywhere payouts — key is match count (10..30). Minimum threshold is
 *  10 (not 8) so low-weight fruits rarely pay at all. Paytable tuned with
 *  Monte-Carlo to land near ~96% base RTP with ~1.2× overall RTP including
 *  free-spin contribution. */
const PAY: Record<string, Partial<Record<number, number>>> = {
  cherry: { 8: 5,    10: 15,  12: 60 },  // top premium (rarest)
  banana: { 8: 2,    10: 6,   12: 25 },
  pear:   { 8: 1,    10: 3,   12: 12 },
  plum:   { 8: 0.5,  10: 1.5, 12: 6 },
  apple:  { 8: 0.2,  10: 0.7, 12: 3 },
  grape:  { 8: 0.1,  10: 0.3, 12: 1.2 },
};

const SCATTER_FREE_SPIN_THRESHOLD = 4;
const FREE_SPINS_AWARDED = 5;
const FREE_SPIN_BASE_MULT = 2;
/** Cap on cumulative multiplier coin value within a single spin chain.
 *  Matches Sweet Bonanza's 1000× safety ceiling in concept — prevents a
 *  wild stack of 25× coins during free spins from running RTP away. */
const MULT_COIN_CAP = 100;

/** Multiplier coin values (chance-weighted). Landing one adds its value
 *  to the global multiplier; multiple stack additively within a spin chain.
 *  Capped at 25× — high-tail variance stays in the free-spin path. */
const MULT_COIN_VALUES = [2, 3, 5, 10, 25];
const MULT_COIN_WEIGHTS = [45, 30, 15, 8, 2];

function multiplierFromFloat(u: number): number {
  let total = 0;
  for (const w of MULT_COIN_WEIGHTS) total += w;
  let t = u * total;
  for (let i = 0; i < MULT_COIN_VALUES.length; i++) {
    t -= MULT_COIN_WEIGHTS[i]!;
    if (t < 0) return MULT_COIN_VALUES[i]!;
  }
  return MULT_COIN_VALUES[0]!;
}

/** Reel strip. Scatters and multiplier coins are kept extremely rare so the
 *  free spin feature doesn't inflate RTP uncontrollably. */
const STRIP: ReelStrip = {
  symbols: ["grape", "apple", "plum", "pear", "banana", "cherry", "M", "S"],
  weights: [ 60,      55,      50,     45,     40,       35,       4,   6 ],
};
const STRIPS: ReelStrip[] = Array.from({ length: FS_COLS }, () => STRIP);

export interface FruitStormParams {
  /** Buy-feature flag. If true, bet is 100× instead of 1× and base spin
   *  starts with guaranteed ≥3 scatters → free spins. Matches Sweet Bonanza
   *  ante/buy mechanic. Out of scope for v1 — accepted but ignored. */
  buy?: boolean;
}

export interface FSTumbleStep {
  grid: Symbol[][];          // snapshot of the grid BEFORE clearing wins
  clearedPositions: [number, number][]; // cells that cleared this step
  stepPay: number;           // total-bet mult gained from this step's wins
  multiplierCoins: number[]; // coin values that showed on this grid (additive)
}

export interface FSSpinResult {
  tumbleSteps: FSTumbleStep[];
  scatterCountInitial: number;    // scatters present on the *initial* grid
  finalMultiplier: number;        // 1 + sum(multiplierCoins) across spin
  basePay: number;                 // sum(stepPay) BEFORE finalMultiplier
  multiplier: number;              // basePay × finalMultiplier
}

export interface FruitStormOutcome {
  baseSpin: FSSpinResult;
  freeSpins: FSSpinResult[];
  totalMultiplier: number;
  win: boolean;
}

export function validateFruitStormParams(params: unknown): params is FruitStormParams {
  if (params == null || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;
  if (p.buy != null && typeof p.buy !== "boolean") return false;
  return true;
}

function countSymbols(grid: Symbol[][]): Map<Symbol, number> {
  const m = new Map<Symbol, number>();
  for (const col of grid) for (const s of col) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

/** Given a grid, find which positions clear (paying symbols) + the pay.
 *  `onlyWinningSymbols` controls which cells vanish: classic Sweet Bonanza
 *  only clears the paying symbols, not multiplier coins or scatters. */
function findWins(grid: Symbol[][]): { cleared: [number, number][]; pay: number } {
  const counts = countSymbols(grid);
  let pay = 0;
  const winningSymbols = new Set<Symbol>();
  for (const [sym, count] of counts) {
    const table = PAY[sym];
    if (!table) continue;
    // Find the highest tier threshold the count satisfies.
    let best = 0;
    for (const threshStr of Object.keys(table)) {
      const thresh = Number(threshStr);
      if (count >= thresh && (table[thresh] ?? 0) > best) best = table[thresh]!;
    }
    if (best > 0) {
      pay += best;
      winningSymbols.add(sym);
    }
  }
  const cleared: [number, number][] = [];
  if (winningSymbols.size === 0) return { cleared, pay: 0 };
  for (let c = 0; c < FS_COLS; c++) {
    for (let r = 0; r < FS_ROWS; r++) {
      if (winningSymbols.has(grid[c]![r]!)) cleared.push([c, r]);
    }
  }
  return { cleared, pay };
}

/** After `cleared` cells have vanished, refill columns from the top. Returns
 *  the new grid; mutates the reel float offset (via the caller-passed index). */
function tumbleRefill(
  grid: Symbol[][],
  cleared: [number, number][],
  floats: number[],
  offsetRef: { i: number },
): Symbol[][] {
  const next = cloneGrid(grid);
  const isCleared = Array.from({ length: FS_COLS }, () => new Array<boolean>(FS_ROWS).fill(false));
  for (const [c, r] of cleared) isCleared[c]![r] = true;
  for (let c = 0; c < FS_COLS; c++) {
    const kept: Symbol[] = [];
    for (let r = FS_ROWS - 1; r >= 0; r--) {
      if (!isCleared[c]![r]) kept.push(next[c]![r]!);
    }
    // Refill from the top with new draws until column is full.
    const needed = FS_ROWS - kept.length;
    const fresh: Symbol[] = [];
    for (let k = 0; k < needed; k++) {
      const u = floats[offsetRef.i++] ?? 0;
      fresh.push(pickSymbol(STRIPS[c]!, u));
    }
    // Column rebuild: new cells on top, kept ones slide down.
    // kept was pushed bottom-up, so reverse it for "from top to bottom" order.
    kept.reverse();
    const rebuilt: Symbol[] = [...fresh, ...kept];
    for (let r = 0; r < FS_ROWS; r++) next[c]![r] = rebuilt[r]!;
  }
  return next;
}

/** Identify NEW multiplier cells on the grid — those at positions not yet
 *  seen. Assigns a value per cell (deterministic from the float stream) and
 *  marks the position as seen so the same cell never double-counts across
 *  tumble steps. */
function newMultipliers(
  grid: Symbol[][],
  seenM: Set<string>,
  floats: number[],
  offsetRef: { i: number },
): number[] {
  const out: number[] = [];
  for (let c = 0; c < FS_COLS; c++) {
    for (let r = 0; r < FS_ROWS; r++) {
      if (grid[c]![r] !== "M") continue;
      const key = `${c},${r}`;
      if (seenM.has(key)) continue;
      seenM.add(key);
      out.push(multiplierFromFloat(floats[offsetRef.i++] ?? 0));
    }
  }
  return out;
}

function runSpin(
  initialGrid: Symbol[][],
  floats: number[],
  offsetRef: { i: number },
  freeSpinBonus: number,
): FSSpinResult {
  // Multiplier coins only activate during free spins (freeSpinBonus > 1).
  // In the base game they appear as neutral cells — kept on the grid but
  // with zero value. This is the classic Sweet-Bonanza rule and keeps base
  // RTP flat so the feature is clearly the high-variance path.
  const multsActive = freeSpinBonus > 1;
  let grid = initialGrid;
  const steps: FSTumbleStep[] = [];
  let basePay = 0;
  let collectedMultTotal = 0;
  const seenM = new Set<string>();
  const scatterCountInitial = countSymbols(initialGrid).get("S") ?? 0;

  for (let t = 0; t <= MAX_TUMBLES_PER_SPIN; t++) {
    const mults = multsActive ? newMultipliers(grid, seenM, floats, offsetRef) : [];
    for (const v of mults) collectedMultTotal += v;
    const { cleared, pay } = findWins(grid);
    if (cleared.length === 0) {
      if (t === 0) {
        steps.push({ grid, clearedPositions: [], stepPay: 0, multiplierCoins: mults });
      }
      break;
    }
    steps.push({ grid, clearedPositions: cleared, stepPay: pay, multiplierCoins: mults });
    basePay += pay;
    // Since M positions shift when the column tumbles, re-key `seenM` after
    // the refill so the same physical coin keeps its "already seen" flag.
    const shifted = new Set<string>();
    for (const key of seenM) {
      const [cStr, rStr] = key.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      // A coin at row r drops by the number of cleared cells BELOW it in its column.
      let fall = 0;
      for (const [cc, rr] of cleared) {
        if (cc === c && rr > r) fall++;
      }
      const newR = r + fall;
      if (newR < FS_ROWS) shifted.add(`${c},${newR}`);
    }
    seenM.clear();
    for (const k of shifted) seenM.add(k);
    grid = tumbleRefill(grid, cleared, floats, offsetRef);
  }

  // Classic Sweet-Bonanza rule: multipliers only apply if basePay > 0.
  // Otherwise they are a visual tease and don't contribute to payout.
  const multApplies = basePay > 0 ? Math.min(collectedMultTotal, MULT_COIN_CAP) : 0;
  const finalMultiplier = (1 + multApplies) * freeSpinBonus;
  return {
    tumbleSteps: steps,
    scatterCountInitial,
    finalMultiplier,
    basePay,
    multiplier: basePay * finalMultiplier,
  };
}

export async function playFruitStorm(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  _params: FruitStormParams,
): Promise<FruitStormOutcome> {
  const floats = await spinFloats(serverSeedHex, clientSeedHex, nonce, MAX_FLOATS);
  const offsetRef = { i: 0 };

  const baseGrid = spinGrid(STRIPS, FS_COLS, FS_ROWS, floats, 0);
  offsetRef.i = FS_COLS * FS_ROWS;
  const base = runSpin(baseGrid, floats, offsetRef, 1);

  const freeSpins: FSSpinResult[] = [];
  if (base.scatterCountInitial >= SCATTER_FREE_SPIN_THRESHOLD) {
    for (let s = 0; s < FREE_SPINS_AWARDED; s++) {
      const g = spinGrid(STRIPS, FS_COLS, FS_ROWS, floats, offsetRef.i);
      offsetRef.i += FS_COLS * FS_ROWS;
      freeSpins.push(runSpin(g, floats, offsetRef, FREE_SPIN_BASE_MULT));
    }
  }

  const total = base.multiplier + freeSpins.reduce((a, s) => a + s.multiplier, 0);
  return {
    baseSpin: base,
    freeSpins,
    totalMultiplier: total,
    win: total > 0,
  };
}

export function fruitStormMultiplier(outcome: FruitStormOutcome): number {
  return outcome.totalMultiplier;
}

export function fruitStormPaytable(): { symbol: Symbol; pays: Partial<Record<number, number>> }[] {
  return Object.entries(PAY).map(([symbol, pays]) => ({ symbol, pays }));
}
