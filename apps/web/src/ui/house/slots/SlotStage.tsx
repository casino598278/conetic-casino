import { useEffect, useRef, useState } from "react";
import type { SlotVariant } from "@conetic/shared";
import { SYMBOL_ASSET_URLS, specFor } from "./symbols";

// ─── DOM-based slot stage ──────────────────────────────────────────────────
//
// Previous iteration used PixiJS v8. Init/destroy had tree-shaking and
// timing bugs on the Telegram WebView that left the canvas missing on
// some devices. This version renders purely with React + CSS grid + the
// Web Animations API — no canvas, no async init race, no plugin footguns.
//
// The server-side math and outcome shapes are unchanged; this file is
// strictly the pixel layer.

export interface SlotStageProps {
  variant: SlotVariant;
  cols: number;
  rows: number;
  /** Server-returned outcome (variant-specific shape). Null = idle. */
  outcome: any | null;
  /** Bumped by the parent on every new spin so the stage knows to replay. */
  playToken: number;
  /** Called when the animation finishes (after last frame). */
  onComplete: () => void;
  /** Called at key moments so the parent can trigger haptics/sound. */
  onEvent?: (event: SlotEvent) => void;
}

export type SlotEvent =
  | { kind: "spin-start" }
  | { kind: "reel-land"; col: number }
  | { kind: "win-pop"; count: number }
  | { kind: "big-win"; multiplier: number }
  | { kind: "tumble" }
  | { kind: "done" };

/** Cell render state — grid[col][row]. */
interface Cell {
  symbol: string;
  /** "hit" pulses a gold glow; "pop" fades out on win; "drop-<ms>" applies
   *  a CSS fall animation with the given delay. */
  state?: "hit" | "pop" | "landing";
  /** Optional animation delay in ms, used for staggered drops. */
  delay?: number;
}

/** Sleep helper for sequencing. */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Variant pool — used to paint an idle grid before the first spin. */
function variantPool(variant: SlotVariant): string[] {
  switch (variant) {
    case "cosmicLines": return ["cherry", "lemon", "bell", "star", "seven", "W"];
    case "fruitStorm":  return ["grape", "apple", "plum", "pear", "banana", "cherry"];
    case "gemClusters": return ["red", "orange", "yellow", "green", "teal", "purple", "pink"];
    case "luckySevens": return ["cherry", "lemon", "bell", "bar", "7"];
  }
}

/** Paint a deterministic starting grid so the stage isn't empty before a spin. */
function idleGrid(variant: SlotVariant, cols: number, rows: number): Cell[][] {
  const pool = variantPool(variant);
  const g: Cell[][] = [];
  for (let c = 0; c < cols; c++) {
    g.push([]);
    for (let r = 0; r < rows; r++) {
      g[c]!.push({ symbol: pool[(c * 7 + r * 3) % pool.length]! });
    }
  }
  return g;
}

/** Deep-clone grid (mutation-safe for state updates). */
function cloneGrid(g: Cell[][]): Cell[][] {
  return g.map((col) => col.map((cell) => ({ ...cell })));
}

export function SlotStage({
  variant, cols, rows, outcome, playToken, onComplete, onEvent,
}: SlotStageProps) {
  const [grid, setGrid] = useState<Cell[][]>(() => idleGrid(variant, cols, rows));
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const lastTokenRef = useRef<number>(-1);
  const abortRef = useRef<boolean>(false);
  // Preload all sprite images so the first spin doesn't flash blank cells.
  // This is cheap — 15 SVGs at ~1-2KB each.
  useEffect(() => {
    for (const url of Object.values(SYMBOL_ASSET_URLS)) {
      const img = new Image();
      img.src = url;
    }
  }, []);

  // Reset the grid when variant/cols/rows change (so switching slots is clean).
  useEffect(() => {
    setGrid(idleGrid(variant, cols, rows));
    lastTokenRef.current = -1;
    abortRef.current = false;
  }, [variant, cols, rows]);

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  // Run a sequence whenever playToken advances with a non-null outcome.
  useEffect(() => {
    if (outcome == null) return;
    if (lastTokenRef.current === playToken) return;
    lastTokenRef.current = playToken;
    abortRef.current = false;

    const emit = onEvent ?? (() => {});
    emit({ kind: "spin-start" });

    const finish = () => {
      try { onComplete(); } catch { /* ignore */ }
      try { emit({ kind: "done" }); } catch { /* ignore */ }
    };

    const setGridSafe = (updater: Cell[][] | ((prev: Cell[][]) => Cell[][])) => {
      if (abortRef.current) return;
      if (typeof updater === "function") setGrid((prev) => (updater as any)(prev));
      else setGrid(updater);
    };

    (async () => {
      try {
        switch (variant) {
          case "cosmicLines":
            await runCosmicLines(outcome, cols, rows, setGridSafe, emit, abortRef);
            break;
          case "fruitStorm":
            await runTumble(outcome, cols, rows, setGridSafe, emit, abortRef, false);
            break;
          case "gemClusters":
            await runClusters(outcome, cols, rows, setGridSafe, emit, abortRef);
            break;
          case "luckySevens":
            await runLuckySevens(outcome, cols, rows, setGridSafe, emit, abortRef);
            break;
        }
      } catch (err) {
        console.error("[SlotStage] sequence failed", err);
      } finally {
        finish();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken, outcome]);

  return (
    <div
      className={`slots-dom slots-dom-${variant}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      } as React.CSSProperties}
    >
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const cell = grid[c]?.[r];
          if (!cell) return null;
          const spec = specFor(cell.symbol);
          const url = SYMBOL_ASSET_URLS[spec.asset];
          const stateClass = cell.state ? `is-${cell.state}` : "";
          const tintRgb = hexToCssColor(spec.tint);
          return (
            <div
              key={`${c}-${r}`}
              className={`slots-dom-cell ${stateClass}`}
              style={{
                gridColumn: c + 1,
                gridRow: r + 1,
                animationDelay: cell.delay ? `${cell.delay}ms` : undefined,
                // Store the tint via a CSS var so Gem Clusters can tint the
                // same gem.svg for each colour via a CSS filter.
                ["--tint" as any]: tintRgb,
              }}
            >
              <img
                src={url}
                alt={spec.label}
                className={`slots-dom-sym ${spec.asset === "gem" ? "is-tinted" : ""}`}
                draggable={false}
              />
            </div>
          );
        }),
      )}
    </div>
  );
}

/** Convert 0xRRGGBB hex → "rgb(r,g,b)" string for CSS custom-property use. */
function hexToCssColor(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r},${g},${b})`;
}

// ─── sequences ─────────────────────────────────────────────────────────────

type SetGrid = (updater: Cell[][] | ((prev: Cell[][]) => Cell[][])) => void;
type EmitFn = (e: SlotEvent) => void;
type AbortRef = { current: boolean };

const PAYLINES_CL: [number, number][][] = [
  [[0,1],[1,1],[2,1],[3,1],[4,1]],
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,2],[1,2],[2,2],[3,2],[4,2]],
  [[0,0],[1,1],[2,2],[3,1],[4,0]],
  [[0,2],[1,1],[2,0],[3,1],[4,2]],
  [[0,1],[1,0],[2,0],[3,0],[4,1]],
  [[0,1],[1,2],[2,2],[3,2],[4,1]],
  [[0,0],[1,0],[2,1],[3,2],[4,2]],
  [[0,2],[1,2],[2,1],[3,0],[4,0]],
  [[0,1],[1,2],[2,1],[3,0],[4,1]],
];
const PAYLINES_LS: [number, number][][] = [
  [[0,0],[1,0],[2,0]],
  [[0,1],[1,1],[2,1]],
  [[0,2],[1,2],[2,2]],
  [[0,0],[1,1],[2,2]],
  [[0,2],[1,1],[2,0]],
];

// Reel spin: each column staggered, filler symbols cycle, then final grid.
async function reelSpin(
  finalGrid: string[][], cols: number, rows: number, variant: SlotVariant,
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  const pool = variantPool(variant);
  const perColStagger = 120;
  const cruiseMs = 500;
  const framesPerCol = 6;

  // Phase 1: cruise — fill each column's cells with rotating symbols.
  for (let f = 0; f < framesPerCol; f++) {
    if (abortRef.current) return;
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (let c = 0; c < cols; c++) {
        if (f < (cols - c)) continue; // earlier columns start later? actually reverse order
        for (let r = 0; r < rows; r++) {
          g[c]![r] = { symbol: pool[(f + c * 2 + r) % pool.length]! };
        }
      }
      return g;
    });
    await wait(cruiseMs / framesPerCol);
  }

  // Phase 2: each column lands in sequence.
  for (let c = 0; c < cols; c++) {
    if (abortRef.current) return;
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (let r = 0; r < rows; r++) {
        g[c]![r] = { symbol: finalGrid[c]![r]!, state: "landing", delay: r * 50 };
      }
      return g;
    });
    emit({ kind: "reel-land", col: c });
    await wait(perColStagger);
  }
  // Let the landing anim finish.
  await wait(300);
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        g[c]![r]!.state = undefined;
        g[c]![r]!.delay = undefined;
      }
    }
    return g;
  });
}

// Pulse then pop a set of cells.
async function pulseAndPop(
  cells: [number, number][], setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  if (cells.length === 0) return;
  // Pulse
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (const [c, r] of cells) {
      if (g[c]?.[r]) g[c]![r]!.state = "hit";
    }
    return g;
  });
  emit({ kind: "win-pop", count: cells.length });
  await wait(450);
  if (abortRef.current) return;
  // Pop
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (const [c, r] of cells) {
      if (g[c]?.[r]) g[c]![r]!.state = "pop";
    }
    return g;
  });
  emit({ kind: "tumble" });
  await wait(300);
}

// Drop an entire grid from above with staggered delay.
async function dropGrid(
  newGrid: string[][], setGrid: SetGrid, _cols: number, _rows: number,
): Promise<void> {
  setGrid(() => {
    const g: Cell[][] = [];
    for (let c = 0; c < newGrid.length; c++) {
      g.push([]);
      for (let r = 0; r < newGrid[c]!.length; r++) {
        g[c]!.push({
          symbol: newGrid[c]![r]!,
          state: "landing",
          delay: c * 40 + r * 30,
        });
      }
    }
    return g;
  });
  // Longest stagger ≈ (cols * 40 + rows * 30) + 450 anim duration
  const maxStagger = newGrid.length * 40 + (newGrid[0]?.length ?? 1) * 30;
  await wait(maxStagger + 500);
  // Clear landing state so cells are ready for next action
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (const col of g) for (const cell of col) { cell.state = undefined; cell.delay = undefined; }
    return g;
  });
}

// Refill cleared cells from above (used in tumble mechanic).
async function refillGrid(
  nextGrid: string[][], setGrid: SetGrid,
): Promise<void> {
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (let c = 0; c < nextGrid.length; c++) {
      for (let r = 0; r < nextGrid[c]!.length; r++) {
        const cur = g[c]![r]!;
        if (cur.symbol !== nextGrid[c]![r] || cur.state === "pop") {
          g[c]![r] = {
            symbol: nextGrid[c]![r]!,
            state: "landing",
            delay: r * 30,
          };
        }
      }
    }
    return g;
  });
  const maxStagger = (nextGrid[0]?.length ?? 1) * 30;
  await wait(maxStagger + 450);
  setGrid((prev) => {
    const g = cloneGrid(prev);
    for (const col of g) for (const cell of col) { cell.state = undefined; cell.delay = undefined; }
    return g;
  });
}

async function runCosmicLines(
  outcome: any, cols: number, rows: number,
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  await reelSpin(outcome.baseSpin.grid, cols, rows, "cosmicLines", setGrid, emit, abortRef);
  if (abortRef.current) return;
  // Scatters first
  const scatters: [number, number][] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (outcome.baseSpin.grid[c]?.[r] === "S") scatters.push([c, r]);
    }
  }
  if (scatters.length >= 3) {
    await pulseAndPop(scatters, setGrid, emit, abortRef);
    // Repaint (scatters shouldn't actually vanish in lines slot)
    setGrid(() => {
      const g = cloneGrid(idleGrid("cosmicLines", cols, rows));
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          g[c]![r] = { symbol: outcome.baseSpin.grid[c]![r]! };
      return g;
    });
  }
  for (const w of outcome.baseSpin.lineWins ?? []) {
    if (abortRef.current) return;
    const line = PAYLINES_CL[w.lineIndex] ?? [];
    const hit = line.slice(0, w.count);
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const [c, r] of hit) if (g[c]?.[r]) g[c]![r]!.state = "hit";
      return g;
    });
    emit({ kind: "win-pop", count: w.count });
    await wait(400);
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const [c, r] of hit) if (g[c]?.[r]) g[c]![r]!.state = undefined;
      return g;
    });
  }
  for (const spin of outcome.freeSpins ?? []) {
    if (abortRef.current) return;
    await wait(200);
    await reelSpin(spin.grid, cols, rows, "cosmicLines", setGrid, emit, abortRef);
    for (const w of spin.lineWins ?? []) {
      if (abortRef.current) return;
      const line = PAYLINES_CL[w.lineIndex] ?? [];
      const hit = line.slice(0, w.count);
      setGrid((prev) => {
        const g = cloneGrid(prev);
        for (const [c, r] of hit) if (g[c]?.[r]) g[c]![r]!.state = "hit";
        return g;
      });
      await wait(360);
      setGrid((prev) => {
        const g = cloneGrid(prev);
        for (const [c, r] of hit) if (g[c]?.[r]) g[c]![r]!.state = undefined;
        return g;
      });
    }
  }
  if (outcome.baseSpin.multiplier >= 20) {
    emit({ kind: "big-win", multiplier: outcome.baseSpin.multiplier });
  }
}

async function runTumble(
  outcome: any, cols: number, rows: number,
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef, _isGemVariant: boolean,
): Promise<void> {
  await playTumbleSpin(outcome.baseSpin, setGrid, emit, abortRef);
  for (const fs of outcome.freeSpins ?? []) {
    if (abortRef.current) return;
    await wait(250);
    await playTumbleSpin(fs, setGrid, emit, abortRef);
  }
  if ((outcome.totalMultiplier ?? 0) >= 20) {
    emit({ kind: "big-win", multiplier: outcome.totalMultiplier });
  }
}

async function playTumbleSpin(
  spin: { tumbleSteps: { grid: string[][]; clearedPositions: [number, number][]; stepPay: number }[] },
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  if (!spin?.tumbleSteps?.length) return;
  await dropGrid(spin.tumbleSteps[0]!.grid, setGrid, 0, 0);
  for (let i = 0; i < spin.tumbleSteps.length; i++) {
    if (abortRef.current) return;
    const s = spin.tumbleSteps[i]!;
    if (!s.clearedPositions?.length) break;
    await pulseAndPop(s.clearedPositions, setGrid, emit, abortRef);
    const nextGrid = spin.tumbleSteps[i + 1]?.grid;
    if (nextGrid) await refillGrid(nextGrid, setGrid);
  }
}

async function runClusters(
  outcome: any, _cols: number, _rows: number,
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  const steps = outcome.steps ?? [];
  if (!steps.length) return;
  await dropGrid(steps[0].grid, setGrid, 0, 0);
  for (let i = 0; i < steps.length; i++) {
    if (abortRef.current) return;
    const s = steps[i];
    if (!s.clusters?.length) break;
    const cleared: [number, number][] = [];
    for (const k of s.clusters) for (const cell of k.cells) cleared.push(cell);
    await pulseAndPop(cleared, setGrid, emit, abortRef);
    const nextGrid = steps[i + 1]?.grid;
    if (nextGrid) await refillGrid(nextGrid, setGrid);
  }
  if ((outcome.multiplier ?? 0) >= 20) {
    emit({ kind: "big-win", multiplier: outcome.multiplier });
  }
}

async function runLuckySevens(
  outcome: any, cols: number, rows: number,
  setGrid: SetGrid, emit: EmitFn, abortRef: AbortRef,
): Promise<void> {
  const steps = outcome.steps ?? [];
  if (!steps.length) return;
  await reelSpin(steps[0].grid, cols, rows, "luckySevens", setGrid, emit, abortRef);
  for (let i = 1; i < steps.length; i++) {
    if (abortRef.current) return;
    const step = steps[i];
    // Pulse the locked sevens
    const locked = new Set(step.lockedSevens.map(([c, r]: [number, number]) => `${c},${r}`));
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const [c, r] of step.lockedSevens) if (g[c]?.[r]) g[c]![r]!.state = "hit";
      return g;
    });
    await wait(300);
    // Re-spin non-locked cells
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (locked.has(`${c},${r}`)) continue;
          g[c]![r] = {
            symbol: step.grid[c][r],
            state: "landing",
            delay: c * 80 + r * 40,
          };
        }
      }
      return g;
    });
    await wait(700);
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const col of g) for (const cell of col) { cell.state = undefined; cell.delay = undefined; }
      return g;
    });
    emit({ kind: "tumble" });
  }
  // Final line wins
  for (const w of outcome.lineWins ?? []) {
    if (abortRef.current) return;
    const line = PAYLINES_LS[w.lineIndex] ?? [];
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const [c, r] of line) if (g[c]?.[r]) g[c]![r]!.state = "hit";
      return g;
    });
    emit({ kind: "win-pop", count: w.count });
    await wait(500);
    setGrid((prev) => {
      const g = cloneGrid(prev);
      for (const [c, r] of line) if (g[c]?.[r]) g[c]![r]!.state = undefined;
      return g;
    });
  }
  if (outcome.jackpot) emit({ kind: "big-win", multiplier: outcome.multiplier });
}
