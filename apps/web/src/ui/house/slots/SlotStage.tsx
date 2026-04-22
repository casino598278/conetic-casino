import { useEffect, useRef } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
  type Ticker,
} from "pixi.js";
import type { SlotVariant } from "@conetic/shared";
import { SYMBOL_ASSET_URLS, specFor } from "./symbols";
import {
  tween,
  delay,
  easeOutBack,
  easeOutBounce,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
} from "./tween";

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

// ─── sizing ─────────────────────────────────────────────────────────────────
const CELL_PX = 96;        // logical px per cell (scaled by devicePixelRatio)
const CELL_GAP = 4;
const PAD = 8;
// Reels "roll" during spin by cycling through a tall symbol strip — rollers
// are kept in a vertical Container that is translated Y during the spin.
const SPIN_STRIP_LEN = 8;  // symbols shown in the rolling blur

/** Cached textures, loaded once per mount. Indexed by SymbolAssetKey. */
type TexCache = Partial<Record<keyof typeof SYMBOL_ASSET_URLS, Texture>>;

interface CellState {
  container: Container;
  sprite: Sprite;
  glow: Graphics;
  col: number;
  row: number;
  symbol: string;
}

interface StageInternals {
  app: Application;
  host: HTMLDivElement;
  grid: Container;
  badgeLayer: Container;
  cells: CellState[][];   // cells[col][row]
  textures: TexCache;
  cellSize: number;
  cols: number;
  rows: number;
  lastToken: number;
  running: boolean;
  /** Abort flag flipped on unmount/new-spin so running tweens bail out. */
  aborted: boolean;
}

/**
 * SlotStage — a Pixi-rendered slot reel grid. React owns the outcome; Pixi
 * owns the pixels. Plays the variant-specific animation sequence on every
 * bump of `playToken` and reports progress via `onEvent`.
 *
 * One stage handles all four slot variants: the animation choreography
 * branches on `variant` at the sequencing level, but the low-level
 * primitives (drop-in, pop, pulse, reel-spin) are shared.
 */
export function SlotStage({
  variant, cols, rows, outcome, playToken, onComplete, onEvent,
}: SlotStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const internalsRef = useRef<StageInternals | null>(null);

  // Mount Pixi + preload sprites once per (cols, rows) change. If the user
  // navigates between variants with different grid sizes we tear down and
  // rebuild — simpler than resizing.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const cellSize = CELL_PX;
    const stageW = cols * cellSize + (cols - 1) * CELL_GAP + PAD * 2;
    const stageH = rows * cellSize + (rows - 1) * CELL_GAP + PAD * 2;

    const app = new Application();
    app
      .init({
        width: stageW,
        height: stageH,
        background: 0x0f1014,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      .then(async () => {
        if (cancelled) return;
        host.appendChild(app.canvas);
        app.canvas.style.width = "100%";
        app.canvas.style.height = "auto";
        app.canvas.style.display = "block";
        app.canvas.style.borderRadius = "12px";

        // Preload every symbol texture. Some variants only need a subset but
        // the total payload is ~17 KB of SVG so we load them all and cache.
        const loaded = await Assets.load(Object.values(SYMBOL_ASSET_URLS));
        if (cancelled) return;
        const textures: TexCache = {};
        for (const [k, url] of Object.entries(SYMBOL_ASSET_URLS)) {
          textures[k as keyof typeof SYMBOL_ASSET_URLS] = (loaded as Record<string, Texture>)[url];
        }

        // Grid container — centred with PAD inside the stage.
        const grid = new Container();
        grid.position.set(PAD, PAD);
        app.stage.addChild(grid);

        // Build the empty cell matrix.
        const cells: CellState[][] = [];
        for (let c = 0; c < cols; c++) {
          cells[c] = [];
          for (let r = 0; r < rows; r++) {
            const cont = new Container();
            cont.position.set(
              c * (cellSize + CELL_GAP) + cellSize / 2,
              r * (cellSize + CELL_GAP) + cellSize / 2,
            );

            // cell backdrop
            const bg = new Graphics()
              .roundRect(-cellSize / 2, -cellSize / 2, cellSize, cellSize, 10)
              .fill({ color: 0x1a1d24 })
              .stroke({ color: 0x2a2e35, width: 1 });
            cont.addChild(bg);

            // glow ring shown on wins (hidden by default)
            const glow = new Graphics()
              .roundRect(-cellSize / 2 + 2, -cellSize / 2 + 2, cellSize - 4, cellSize - 4, 10)
              .stroke({ color: 0xf5b544, width: 3 });
            glow.alpha = 0;
            cont.addChild(glow);

            const sprite = new Sprite();
            sprite.anchor.set(0.5);
            sprite.width = cellSize * 0.82;
            sprite.height = cellSize * 0.82;
            cont.addChild(sprite);

            grid.addChild(cont);
            cells[c]!.push({ container: cont, sprite, glow, col: c, row: r, symbol: "" });
          }
        }

        // Badge layer sits on top for big-win splash effects.
        const badgeLayer = new Container();
        app.stage.addChild(badgeLayer);

        internalsRef.current = {
          app, host, grid, badgeLayer, cells, textures, cellSize,
          cols, rows, lastToken: -1, running: false, aborted: false,
        };

        // Paint an initial random board so the stage isn't empty on first load.
        paintRandomBoard(internalsRef.current, variant);
      })
      .catch((err) => console.error("[SlotStage] init failed", err));

    return () => {
      cancelled = true;
      const it = internalsRef.current;
      if (it) it.aborted = true;
      internalsRef.current = null;
      app.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  // Every time playToken bumps with a non-null outcome, play the sequence.
  useEffect(() => {
    const it = internalsRef.current;
    if (!it || it.lastToken === playToken || !outcome) return;
    it.lastToken = playToken;
    it.aborted = false;
    it.running = true;
    playSequence(it, variant, outcome, onEvent ?? (() => {})).then(() => {
      it.running = false;
      onComplete();
      onEvent?.({ kind: "done" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken, outcome]);

  return <div ref={hostRef} className="slots-stage-host" />;
}

// ─── cell helpers ───────────────────────────────────────────────────────────

function setCell(it: StageInternals, col: number, row: number, symbol: string) {
  const cell = it.cells[col]?.[row];
  if (!cell) return;
  cell.symbol = symbol;
  const spec = specFor(symbol);
  const tex = it.textures[spec.asset] ?? Texture.EMPTY;
  cell.sprite.texture = tex;
  cell.sprite.tint = spec.tint;
  cell.sprite.alpha = 1;
  cell.sprite.scale.set(bestScale(it.cellSize, tex));
  cell.glow.alpha = 0;
}

function bestScale(cellSize: number, tex: Texture): number {
  if (!tex || !tex.width) return 1;
  const target = cellSize * 0.82;
  return target / tex.width;
}

// Paint a random grid as the idle background (before any spin).
function paintRandomBoard(it: StageInternals, variant: SlotVariant) {
  const pool = variantPool(variant);
  for (let c = 0; c < it.cols; c++) {
    for (let r = 0; r < it.rows; r++) {
      setCell(it, c, r, pool[(c * 7 + r * 3) % pool.length]!);
    }
  }
}

function variantPool(variant: SlotVariant): string[] {
  switch (variant) {
    case "cosmicLines": return ["cherry", "lemon", "bell", "star", "seven", "W"];
    case "fruitStorm":  return ["grape", "apple", "plum", "pear", "banana", "cherry"];
    case "gemClusters": return ["red", "orange", "yellow", "green", "teal", "purple", "pink"];
    case "luckySevens": return ["cherry", "lemon", "bell", "bar", "7"];
  }
}

// ─── sequence: top-level dispatcher ────────────────────────────────────────

async function playSequence(
  it: StageInternals,
  variant: SlotVariant,
  outcome: any,
  emit: (e: SlotEvent) => void,
): Promise<void> {
  emit({ kind: "spin-start" });
  switch (variant) {
    case "cosmicLines": return playCosmicLines(it, outcome, emit);
    case "fruitStorm":  return playFruitStorm(it, outcome, emit);
    case "gemClusters": return playGemClusters(it, outcome, emit);
    case "luckySevens": return playLuckySevens(it, outcome, emit);
  }
}

// ─── cosmic lines: classic reel spin ────────────────────────────────────────

async function playCosmicLines(
  it: StageInternals,
  outcome: any,
  emit: (e: SlotEvent) => void,
): Promise<void> {
  const finalGrid: string[][] = outcome.baseSpin.grid;
  await spinReels(it, finalGrid, emit);
  if (it.aborted) return;
  // Highlight scatters first, then paylines.
  const scatters: Array<[number, number]> = [];
  for (let c = 0; c < it.cols; c++) {
    for (let r = 0; r < it.rows; r++) {
      if (finalGrid[c]![r] === "S") scatters.push([c, r]);
    }
  }
  if (scatters.length >= 3) {
    await pulseCells(it, scatters, 0x3ecf8e, 300);
    emit({ kind: "win-pop", count: scatters.length });
  }
  for (const w of outcome.baseSpin.lineWins ?? []) {
    if (it.aborted) return;
    const line = PAYLINES_CL[w.lineIndex] ?? [];
    const hit = line.slice(0, w.count);
    await pulseCells(it, hit, 0xf5b544, 280);
    emit({ kind: "win-pop", count: w.count });
  }
  // Free-spin sequence: each free spin is a full re-spin with a gold tint.
  for (const spin of outcome.freeSpins ?? []) {
    if (it.aborted) return;
    await delay(it.app.ticker, 200);
    await spinReels(it, spin.grid, emit);
    for (const w of spin.lineWins ?? []) {
      const line = PAYLINES_CL[w.lineIndex] ?? [];
      await pulseCells(it, line.slice(0, w.count), 0xf5b544, 240);
    }
  }
  if (outcome.baseSpin.multiplier >= 20) emit({ kind: "big-win", multiplier: outcome.baseSpin.multiplier });
}

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

// Classic 5-reel column spin. Each column spins independently, accelerating
// for 200ms, cruising 300ms while the strip blurs by, then decelerating
// into the final symbols with an easeOutBack overshoot.
async function spinReels(
  it: StageInternals,
  finalGrid: string[][],
  emit: (e: SlotEvent) => void,
): Promise<void> {
  const perColStagger = 80;
  const accel = 200;
  const cruise = 300;
  const decel = 450;
  const pool = variantPoolFromGrid(finalGrid);
  const col$: Promise<void>[] = [];

  for (let c = 0; c < it.cols; c++) {
    const p = (async () => {
      await delay(it.app.ticker, c * perColStagger);
      // Cycle filler symbols for "cruise" phase.
      const fillerFrames = Math.ceil((accel + cruise) / 40);
      for (let f = 0; f < fillerFrames; f++) {
        for (let r = 0; r < it.rows; r++) {
          setCell(it, c, r, pool[(f + c + r) % pool.length]!);
        }
        await delay(it.app.ticker, 40);
      }
      // Land on final symbols with a short Y-wobble.
      for (let r = 0; r < it.rows; r++) {
        setCell(it, c, r, finalGrid[c]![r]!);
      }
      const colContainer = it.cells[c]!.map((cs) => cs.container);
      await Promise.all(colContainer.map((cont, r) => {
        const restY = r * (it.cellSize + CELL_GAP) + it.cellSize / 2;
        cont.position.y = restY - 40;
        return tween(it.app.ticker, {
          from: restY - 40,
          to: restY,
          duration: decel,
          ease: easeOutBack,
          onUpdate: (v) => { cont.position.y = v; },
        });
      }));
      emit({ kind: "reel-land", col: c });
    })();
    col$.push(p);
  }
  await Promise.all(col$);
}

function variantPoolFromGrid(grid: string[][]): string[] {
  const seen = new Set<string>();
  for (const col of grid) for (const s of col) seen.add(s);
  return [...seen];
}

// Pulse a set of cells: scale up → down, with glow ring flashing.
async function pulseCells(
  it: StageInternals,
  cells: [number, number][],
  color: number,
  duration: number,
): Promise<void> {
  await Promise.all(cells.map(([c, r]) => pulseOne(it, c, r, color, duration)));
}

async function pulseOne(
  it: StageInternals, col: number, row: number, color: number, duration: number,
): Promise<void> {
  const cell = it.cells[col]?.[row];
  if (!cell) return;
  cell.glow.tint = color;
  const baseScale = cell.sprite.scale.x;
  await tween(it.app.ticker, {
    from: 0, to: 1, duration: duration / 2, ease: easeOutCubic,
    onUpdate: (p) => {
      cell.glow.alpha = p;
      cell.sprite.scale.set(baseScale * (1 + 0.15 * p));
    },
  });
  await tween(it.app.ticker, {
    from: 1, to: 0, duration: duration / 2, ease: easeInOutCubic,
    onUpdate: (p) => {
      cell.glow.alpha = p;
      cell.sprite.scale.set(baseScale * (1 + 0.15 * p));
    },
  });
}

// ─── fruit storm: pay-anywhere tumble ───────────────────────────────────────

async function playFruitStorm(
  it: StageInternals,
  outcome: any,
  emit: (e: SlotEvent) => void,
): Promise<void> {
  await playTumbleSpin(it, outcome.baseSpin, emit);
  for (const fs of outcome.freeSpins ?? []) {
    if (it.aborted) return;
    await delay(it.app.ticker, 250);
    // Free-spin tint glow on the whole grid briefly
    await flashBorder(it, 0xffd34d, 280);
    await playTumbleSpin(it, fs, emit);
  }
  if (outcome.totalMultiplier >= 20) {
    emit({ kind: "big-win", multiplier: outcome.totalMultiplier });
  }
}

async function playTumbleSpin(
  it: StageInternals,
  spin: { tumbleSteps: { grid: string[][]; clearedPositions: [number, number][]; stepPay: number }[] },
  emit: (e: SlotEvent) => void,
): Promise<void> {
  if (!spin.tumbleSteps.length) return;
  const firstGrid = spin.tumbleSteps[0]!.grid;
  await dropIntoGrid(it, firstGrid);
  if (it.aborted) return;
  for (let step = 0; step < spin.tumbleSteps.length; step++) {
    if (it.aborted) return;
    const s = spin.tumbleSteps[step]!;
    if (s.clearedPositions.length === 0) break;
    await pulseCells(it, s.clearedPositions, 0xf5b544, 260);
    await popCells(it, s.clearedPositions);
    emit({ kind: "win-pop", count: s.clearedPositions.length });
    emit({ kind: "tumble" });
    // Refill: next step grid shows the new state (if there is one).
    const nextGrid = spin.tumbleSteps[step + 1]?.grid ?? null;
    if (nextGrid) await cascadeTo(it, s.clearedPositions, nextGrid);
  }
}

/** Dropping-in effect for an entire grid: each cell falls from above with
 *  a staggered delay, lands with easeOutBounce. */
async function dropIntoGrid(it: StageInternals, grid: string[][]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (let c = 0; c < it.cols; c++) {
    for (let r = 0; r < it.rows; r++) {
      const cell = it.cells[c]![r]!;
      setCell(it, c, r, grid[c]![r]!);
      const restY = r * (it.cellSize + CELL_GAP) + it.cellSize / 2;
      cell.container.position.y = restY - it.cellSize * (it.rows + 1);
      const stagger = c * 30 + r * 20;
      jobs.push(tween(it.app.ticker, {
        from: cell.container.position.y,
        to: restY,
        duration: 420,
        delay: stagger,
        ease: easeOutBounce,
        onUpdate: (v) => { cell.container.position.y = v; },
      }));
    }
  }
  await Promise.all(jobs);
}

/** Pop: scale up while fading alpha to 0, leaving an empty slot visually. */
async function popCells(it: StageInternals, cells: [number, number][]): Promise<void> {
  await Promise.all(cells.map(async ([c, r]) => {
    const cell = it.cells[c]?.[r];
    if (!cell) return;
    const baseScale = bestScale(it.cellSize, cell.sprite.texture);
    await tween(it.app.ticker, {
      from: 0, to: 1, duration: 220, ease: easeInCubic,
      onUpdate: (p) => {
        cell.sprite.scale.set(baseScale * (1 + 0.5 * p));
        cell.sprite.alpha = 1 - p;
        cell.glow.alpha = Math.max(0, (1 - p) * 0.6);
      },
    });
    cell.sprite.alpha = 0;
    cell.glow.alpha = 0;
  }));
}

/** After a pop, slide remaining symbols into cleared slots and drop fresh
 *  symbols from above. For simplicity we just swap textures to `nextGrid`
 *  and replay the drop animation per-column for cells that changed. */
async function cascadeTo(
  it: StageInternals, cleared: [number, number][], nextGrid: string[][],
): Promise<void> {
  // Track which columns had a clear (they need re-animation).
  const cols = new Set(cleared.map(([c]) => c));
  const jobs: Promise<void>[] = [];
  for (const c of cols) {
    for (let r = 0; r < it.rows; r++) {
      const cell = it.cells[c]![r]!;
      if (cell.symbol === nextGrid[c]![r] && cell.sprite.alpha > 0.01) continue;
      setCell(it, c, r, nextGrid[c]![r]!);
      const restY = r * (it.cellSize + CELL_GAP) + it.cellSize / 2;
      cell.container.position.y = restY - it.cellSize * (it.rows + 1);
      const stagger = r * 20;
      jobs.push(tween(it.app.ticker, {
        from: cell.container.position.y,
        to: restY,
        duration: 360,
        delay: stagger,
        ease: easeOutBounce,
        onUpdate: (v) => { cell.container.position.y = v; },
      }));
    }
  }
  // Cells in OTHER columns may still have new symbols (board re-rolls); sync them quickly.
  for (let c = 0; c < it.cols; c++) {
    if (cols.has(c)) continue;
    for (let r = 0; r < it.rows; r++) {
      if (it.cells[c]![r]!.symbol !== nextGrid[c]![r]) {
        setCell(it, c, r, nextGrid[c]![r]!);
      }
    }
  }
  await Promise.all(jobs);
}

// Brief border flash to signal free-spin mode.
async function flashBorder(it: StageInternals, color: number, ms: number): Promise<void> {
  const border = new Graphics()
    .roundRect(0, 0, it.app.screen.width, it.app.screen.height, 12)
    .stroke({ color, width: 4 });
  border.alpha = 0;
  it.badgeLayer.addChild(border);
  await tween(it.app.ticker, {
    from: 0, to: 1, duration: ms / 2, onUpdate: (p) => { border.alpha = p; },
  });
  await tween(it.app.ticker, {
    from: 1, to: 0, duration: ms / 2, onUpdate: (p) => { border.alpha = p; },
  });
  border.destroy();
}

// ─── gem clusters ───────────────────────────────────────────────────────────

async function playGemClusters(
  it: StageInternals,
  outcome: any,
  emit: (e: SlotEvent) => void,
): Promise<void> {
  const steps: { grid: string[][]; clusters: { cells: [number, number][] }[]; stepPay: number }[] = outcome.steps;
  if (!steps.length) return;
  await dropIntoGrid(it, steps[0]!.grid);
  for (let i = 0; i < steps.length; i++) {
    if (it.aborted) return;
    const s = steps[i]!;
    if (!s.clusters.length) break;
    for (const k of s.clusters) {
      await pulseCells(it, k.cells, 0xf5b544, 260);
      emit({ kind: "win-pop", count: k.cells.length });
    }
    const cleared: [number, number][] = [];
    for (const k of s.clusters) cleared.push(...k.cells);
    await popCells(it, cleared);
    emit({ kind: "tumble" });
    const nextGrid = steps[i + 1]?.grid;
    if (nextGrid) await cascadeTo(it, cleared, nextGrid);
  }
  if (outcome.multiplier >= 20) emit({ kind: "big-win", multiplier: outcome.multiplier });
}

// ─── lucky sevens ───────────────────────────────────────────────────────────

async function playLuckySevens(
  it: StageInternals,
  outcome: any,
  emit: (e: SlotEvent) => void,
): Promise<void> {
  const steps: { grid: string[][]; lockedSevens: [number, number][] }[] = outcome.steps;
  if (!steps.length) return;
  // Spin all reels into the first grid.
  await spinReels(it, steps[0]!.grid, emit);
  // For each subsequent step, keep locked sevens, re-spin the rest.
  for (let i = 1; i < steps.length; i++) {
    if (it.aborted) return;
    const step = steps[i]!;
    const locked = new Set(step.lockedSevens.map(([c, r]) => `${c},${r}`));
    // Glow the locked cells gold.
    await pulseCells(it, step.lockedSevens, 0xffd34d, 220);
    emit({ kind: "tumble" });
    // Re-spin only non-locked cells (one column at a time).
    for (let c = 0; c < it.cols; c++) {
      const jobs: Promise<void>[] = [];
      for (let r = 0; r < it.rows; r++) {
        if (locked.has(`${c},${r}`)) continue;
        const cell = it.cells[c]![r]!;
        const restY = r * (it.cellSize + CELL_GAP) + it.cellSize / 2;
        setCell(it, c, r, step.grid[c]![r]!);
        cell.container.position.y = restY - it.cellSize * (it.rows + 1);
        jobs.push(tween(it.app.ticker, {
          from: cell.container.position.y, to: restY,
          duration: 420, delay: c * 60 + r * 20,
          ease: easeOutBounce,
          onUpdate: (v) => { cell.container.position.y = v; },
        }));
      }
      await Promise.all(jobs);
    }
  }
  // Highlight final payline wins.
  const lineWins = outcome.lineWins ?? [];
  for (const w of lineWins) {
    if (it.aborted) return;
    const line = PAYLINES_LS[w.lineIndex] ?? [];
    await pulseCells(it, line, 0xf5b544, 260);
    emit({ kind: "win-pop", count: w.count });
  }
  if (outcome.jackpot) {
    emit({ kind: "big-win", multiplier: outcome.multiplier });
    // Gold wash for the jackpot.
    await flashBorder(it, 0xffd34d, 600);
  }
}

const PAYLINES_LS: [number, number][][] = [
  [[0,0],[1,0],[2,0]],
  [[0,1],[1,1],[2,1]],
  [[0,2],[1,2],[2,2]],
  [[0,0],[1,1],[2,2]],
  [[0,2],[1,1],[2,0]],
];

// Keep Ticker typing accessible for IDEs. No-op at runtime.
export type { Ticker };
