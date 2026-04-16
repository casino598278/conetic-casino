// 2D mining race: players move around a grid collecting gems.
// Stake fraction → movement speed + vision range. All deterministic from seeds.

import { Xoshiro256ss } from "./prng.js";
import { hexToBuf, hmacSha256, bufToHex } from "./fair.js";

export const MINING = {
  GRID_SIZE: 20,
  MAX_TICKS: 150,            // 15s at 100ms per tick
  TICK_MS: 100,
  DURATION_MS: 15000,
  GEMS_ON_MAP: 15,
  TARGET_GEMS: 100,          // first-to-N wins
} as const;

export interface Point2D { x: number; y: number; }

/** Snapshot of the world at one tick. */
export interface MiningFrame {
  t: number;                    // ms since start
  players: { x: number; y: number; gems: number }[];
  gems: Point2D[];              // active gem positions
}

export interface MiningResult {
  frames: MiningFrame[];
  finalGems: number[];
  winnerIndex: number;
  tied: boolean;
  durationMs: number;
  /** How far into the simulation the winner reached TARGET_GEMS (null if ran full time). */
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

function absDist(a: Point2D, b: Point2D): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Find nearest gem within vision range (Manhattan). Returns null if none seen. */
function nearestGem(pos: Point2D, gems: Point2D[], vision: number): Point2D | null {
  let best: Point2D | null = null;
  let bestDist = Infinity;
  for (const g of gems) {
    const d = absDist(pos, g);
    if (d <= vision && d < bestDist) {
      best = g;
      bestDist = d;
    }
  }
  return best;
}

/** Step one cell toward a target (prefer the axis with greater delta). */
function stepToward(pos: Point2D, target: Point2D, rng: Xoshiro256ss): Point2D {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  // Prefer longer axis, with jitter
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

/** Random wander: step one cell in a random direction (stays on grid). */
function wander(pos: Point2D, rng: Xoshiro256ss): Point2D {
  const dirs: Point2D[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const d = dirs[rng.nextInt(4)]!;
  return {
    x: Math.max(0, Math.min(MINING.GRID_SIZE - 1, pos.x + d.x)),
    y: Math.max(0, Math.min(MINING.GRID_SIZE - 1, pos.y + d.y)),
  };
}

/**
 * Simulate a mining race.
 * @param playerSeeds  Per-player PRNG seeds (32-byte hex).
 * @param stakeFractions  Each player's stake/pot ratio (0..1). Affects speed + vision.
 * @param worldSeedHex  Seed for gem spawn positions (shared world RNG).
 */
export function simulateMining(
  playerSeeds: string[],
  stakeFractions: number[],
  worldSeedHex?: string,
): MiningResult {
  const n = playerSeeds.length;
  if (n === 0) {
    return { frames: [], finalGems: [], winnerIndex: 0, tied: false, durationMs: 0, winReachedAt: null };
  }

  // Per-player PRNG (controls their movement jitter + any rolls)
  const rngs = playerSeeds.map((s) => new Xoshiro256ss(hexToBuf(s)));
  // Shared world PRNG (controls gem positions + starting positions) so all clients see same layout
  const worldRng = new Xoshiro256ss(hexToBuf(worldSeedHex ?? playerSeeds[0]!));

  // Starting positions: spread around the map corners + center + random
  const positions: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    positions.push({
      x: worldRng.nextInt(MINING.GRID_SIZE),
      y: worldRng.nextInt(MINING.GRID_SIZE),
    });
  }

  // Initial gem layout
  const gems: Point2D[] = [];
  while (gems.length < MINING.GEMS_ON_MAP) {
    const p = { x: worldRng.nextInt(MINING.GRID_SIZE), y: worldRng.nextInt(MINING.GRID_SIZE) };
    if (!gems.some((g) => g.x === p.x && g.y === p.y) && !positions.some((pp) => pp.x === p.x && pp.y === p.y)) {
      gems.push(p);
    }
  }

  const gemCounts = new Array(n).fill(0);
  const frames: MiningFrame[] = [];

  // Speed: steps per tick. 1 → 3 based on stake fraction.
  const speeds = stakeFractions.map((f) => 1 + Math.floor(f * 2 + 0.1));
  // Vision: Manhattan radius. Bigger stake sees further.
  const visions = stakeFractions.map((f) => 4 + Math.floor(f * 16));

  let winnerIdx = 0;
  let winReachedAt: number | null = null;

  for (let t = 1; t <= MINING.MAX_TICKS; t++) {
    // Each player takes their turn
    for (let i = 0; i < n; i++) {
      const steps = speeds[i]!;
      for (let s = 0; s < steps; s++) {
        const target = nearestGem(positions[i]!, gems, visions[i]!);
        if (target) {
          positions[i] = stepToward(positions[i]!, target, rngs[i]!);
        } else {
          positions[i] = wander(positions[i]!, rngs[i]!);
        }
        // Collect gem if on its cell
        const hitIdx = gems.findIndex((g) => g.x === positions[i]!.x && g.y === positions[i]!.y);
        if (hitIdx !== -1) {
          gems.splice(hitIdx, 1);
          gemCounts[i]++;
          // Respawn a gem elsewhere (not on any player or existing gem)
          let attempts = 0;
          while (attempts++ < 50) {
            const p = { x: worldRng.nextInt(MINING.GRID_SIZE), y: worldRng.nextInt(MINING.GRID_SIZE) };
            if (gems.some((g) => g.x === p.x && g.y === p.y)) continue;
            if (positions.some((pp) => pp.x === p.x && pp.y === p.y)) continue;
            gems.push(p);
            break;
          }
        }
      }
    }
    frames.push({
      t: t * MINING.TICK_MS,
      players: positions.map((p, i) => ({ x: p.x, y: p.y, gems: gemCounts[i]! })),
      gems: [...gems],
    });

    // Check first-to-N
    if (winReachedAt === null) {
      for (let i = 0; i < n; i++) {
        if (gemCounts[i]! >= MINING.TARGET_GEMS) {
          winReachedAt = t * MINING.TICK_MS;
          winnerIdx = i;
          break;
        }
      }
      if (winReachedAt !== null) break;
    }
  }

  if (winReachedAt === null) {
    // Time ran out — highest gems wins
    let max = gemCounts[0]!;
    winnerIdx = 0;
    for (let i = 1; i < n; i++) {
      if (gemCounts[i]! > max) {
        max = gemCounts[i]!;
        winnerIdx = i;
      }
    }
  }

  const maxGems = gemCounts[winnerIdx]!;
  let tieCount = 0;
  for (const g of gemCounts) if (g === maxGems) tieCount++;

  return {
    frames,
    finalGems: gemCounts,
    winnerIndex: winnerIdx,
    tied: tieCount > 1,
    durationMs: frames.length > 0 ? frames[frames.length - 1]!.t : 0,
    winReachedAt,
  };
}
