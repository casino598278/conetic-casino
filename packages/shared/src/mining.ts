// 2D mining race with gem types. Players roam a grid, mining gems of varying value.
// Higher stake = faster movement + wider vision + prefers more valuable gems.
// All deterministic from seeds.

import { Xoshiro256ss } from "./prng.js";
import { hexToBuf, hmacSha256, bufToHex } from "./fair.js";

export const MINING = {
  GRID_SIZE: 20,
  MAX_TICKS: 150,            // 15s at 100ms per tick
  TICK_MS: 100,
  DURATION_MS: 15000,
  GEMS_ON_MAP: 15,
  TARGET_POINTS: 301,        // first-to-N points wins
  LUCK_MULTIPLIER: 10,       // how much stake influences "chase rare gems" behaviour
} as const;

export type GemType = "emerald" | "sapphire" | "amethyst" | "diamond" | "ruby";

export interface GemDef {
  type: GemType;
  value: number;
  weight: number; // spawn weight (relative probability)
  color: number;  // for rendering
}

export const GEMS: Record<GemType, GemDef> = {
  emerald:  { type: "emerald",  value: 1,   weight: 55, color: 0x6ee3a3 },
  sapphire: { type: "sapphire", value: 5,   weight: 25, color: 0x4c8aff },
  amethyst: { type: "amethyst", value: 15,  weight: 13, color: 0xb266ff },
  diamond:  { type: "diamond",  value: 40,  weight: 5,  color: 0xffffff },
  ruby:     { type: "ruby",     value: 100, weight: 2,  color: 0xff3355 },
} as const;

const GEM_TYPES: GemType[] = ["emerald", "sapphire", "amethyst", "diamond", "ruby"];
const GEM_WEIGHT_TOTAL = GEM_TYPES.reduce((s, t) => s + GEMS[t].weight, 0);

export interface Point2D { x: number; y: number; }
export interface Gem { x: number; y: number; type: GemType; }

/** One frame of the world. */
export interface MiningFrame {
  t: number;
  players: { x: number; y: number; points: number }[];
  gems: Gem[];
}

export interface MiningResult {
  frames: MiningFrame[];
  finalPoints: number[];
  winnerIndex: number;
  tied: boolean;
  durationMs: number;
  winReachedAt: number | null;
}

/** Per-player seed = HMAC(serverSeed, clientSeed:playerIdx). */
export async function deriveMiningSeed(
  serverSeedHex: string,
  clientSeedHex: string,
  playerIndex: number,
): Promise<string> {
  const mac = await hmacSha256(serverSeedHex, `${clientSeedHex}:${playerIndex}`);
  return bufToHex(mac);
}

function manhattan(a: Point2D, b: Point2D): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Spawn a random gem of a weighted random type. */
function spawnGem(rng: Xoshiro256ss, gems: Gem[], players: Point2D[]): Gem | null {
  const roll = rng.nextFloat() * GEM_WEIGHT_TOTAL;
  let acc = 0;
  let type: GemType = "emerald";
  for (const t of GEM_TYPES) {
    acc += GEMS[t].weight;
    if (roll < acc) { type = t; break; }
  }
  // Find a free cell
  for (let attempts = 0; attempts < 50; attempts++) {
    const x = rng.nextInt(MINING.GRID_SIZE);
    const y = rng.nextInt(MINING.GRID_SIZE);
    if (gems.some((g) => g.x === x && g.y === y)) continue;
    if (players.some((p) => p.x === x && p.y === y)) continue;
    return { x, y, type };
  }
  return null;
}

/**
 * Choose the best target gem for this player.
 * Score = gemValue^(1 + stakeFraction × LUCK_MULT) / (1 + distance)
 * Low staker: value^1 / distance → nearest wins (commons)
 * High staker: value^11 / distance → high-value far gem beats close low-value
 */
function pickTarget(
  pos: Point2D,
  gems: Gem[],
  vision: number,
  stakeFraction: number,
): Gem | null {
  let best: Gem | null = null;
  let bestScore = -Infinity;
  const valueExp = 1 + stakeFraction * MINING.LUCK_MULTIPLIER;
  for (const g of gems) {
    const d = manhattan(pos, g);
    if (d > vision) continue;
    const v = GEMS[g.type].value;
    const score = Math.pow(v, valueExp) / (1 + d);
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return best;
}

function stepToward(pos: Point2D, target: Point2D, rng: Xoshiro256ss): Point2D {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const preferX = absX > absY || (absX === absY && rng.nextFloat() < 0.5);
  let nx = pos.x;
  let ny = pos.y;
  if (preferX && dx !== 0) nx += Math.sign(dx);
  else if (dy !== 0) ny += Math.sign(dy);
  else if (dx !== 0) nx += Math.sign(dx);
  return {
    x: Math.max(0, Math.min(MINING.GRID_SIZE - 1, nx)),
    y: Math.max(0, Math.min(MINING.GRID_SIZE - 1, ny)),
  };
}

function wander(pos: Point2D, rng: Xoshiro256ss): Point2D {
  const dirs: Point2D[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const d = dirs[rng.nextInt(4)]!;
  return {
    x: Math.max(0, Math.min(MINING.GRID_SIZE - 1, pos.x + d.x)),
    y: Math.max(0, Math.min(MINING.GRID_SIZE - 1, pos.y + d.y)),
  };
}

/**
 * Simulate a mining race with typed gems.
 * @param playerSeeds  Per-player PRNG seeds.
 * @param stakeFractions  Each player's stake / pot (0..1).
 * @param worldSeedHex  Seed for gem placement + starting positions.
 */
export function simulateMining(
  playerSeeds: string[],
  stakeFractions: number[],
  worldSeedHex?: string,
): MiningResult {
  const n = playerSeeds.length;
  if (n === 0) {
    return { frames: [], finalPoints: [], winnerIndex: 0, tied: false, durationMs: 0, winReachedAt: null };
  }

  const rngs = playerSeeds.map((s) => new Xoshiro256ss(hexToBuf(s)));
  const worldRng = new Xoshiro256ss(hexToBuf(worldSeedHex ?? playerSeeds[0]!));

  // Starting positions
  const positions: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    positions.push({
      x: worldRng.nextInt(MINING.GRID_SIZE),
      y: worldRng.nextInt(MINING.GRID_SIZE),
    });
  }

  // Initial gem layout
  const gems: Gem[] = [];
  while (gems.length < MINING.GEMS_ON_MAP) {
    const g = spawnGem(worldRng, gems, positions);
    if (g) gems.push(g);
    else break;
  }

  const points = new Array(n).fill(0);
  const frames: MiningFrame[] = [];

  // Speed: 1-3 cells/tick based on stake fraction.
  const speeds = stakeFractions.map((f) => Math.max(1, Math.min(3, 1 + Math.floor(f * 2.5))));
  // Vision: 4-20 cell Manhattan radius.
  const visions = stakeFractions.map((f) => Math.max(4, Math.floor(4 + f * 16)));

  let winnerIdx = 0;
  let winReachedAt: number | null = null;

  for (let t = 1; t <= MINING.MAX_TICKS; t++) {
    for (let i = 0; i < n; i++) {
      const steps = speeds[i]!;
      for (let s = 0; s < steps; s++) {
        const target = pickTarget(positions[i]!, gems, visions[i]!, stakeFractions[i]!);
        if (target) {
          positions[i] = stepToward(positions[i]!, target, rngs[i]!);
        } else {
          positions[i] = wander(positions[i]!, rngs[i]!);
        }
        const hitIdx = gems.findIndex((g) => g.x === positions[i]!.x && g.y === positions[i]!.y);
        if (hitIdx !== -1) {
          const collected = gems[hitIdx]!;
          gems.splice(hitIdx, 1);
          points[i] += GEMS[collected.type].value;
          // Respawn a new gem
          const newGem = spawnGem(worldRng, gems, positions);
          if (newGem) gems.push(newGem);
        }
      }
    }
    frames.push({
      t: t * MINING.TICK_MS,
      players: positions.map((p, i) => ({ x: p.x, y: p.y, points: points[i]! })),
      gems: gems.map((g) => ({ x: g.x, y: g.y, type: g.type })),
    });

    if (winReachedAt === null) {
      for (let i = 0; i < n; i++) {
        if (points[i]! >= MINING.TARGET_POINTS) {
          winReachedAt = t * MINING.TICK_MS;
          winnerIdx = i;
          break;
        }
      }
      if (winReachedAt !== null) break;
    }
  }

  if (winReachedAt === null) {
    let max = points[0]!;
    winnerIdx = 0;
    for (let i = 1; i < n; i++) {
      if (points[i]! > max) {
        max = points[i]!;
        winnerIdx = i;
      }
    }
  }

  const maxPoints = points[winnerIdx]!;
  let tieCount = 0;
  for (const p of points) if (p === maxPoints) tieCount++;

  return {
    frames,
    finalPoints: points,
    winnerIndex: winnerIdx,
    tied: tieCount > 1,
    durationMs: frames.length > 0 ? frames[frames.length - 1]!.t : 0,
    winReachedAt,
  };
}
