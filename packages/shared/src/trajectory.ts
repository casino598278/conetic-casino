// Three-phase ball animation:
//   1. SPIN  — ball spawns at centre, a short white arrow rotates around it,
//              decelerating from a high starting omega to a low aim omega.
//   2. SHOOT — ball launches in the direction the arrow was pointing.
//              Travels with elastic wall bounces and linear damping.
//   3. LAND  — ball comes to rest; the wedge containing the resting point wins.
//
// Both client + server simulate the same trajectory from the same seed so
// the animation is deterministic. Server is authoritative on the resting point.

import { ARENA, type PlayerEntry } from "./game.js";
import { Xoshiro256ss } from "./prng.js";
import { hexToBuf } from "./fair.js";
import { buildWedges, pointToWedge, type Point, type Wedge } from "./wedges.js";

export interface TrajectoryStep {
  /** "spin" or "shoot" — controls renderer behaviour. */
  phase: "spin" | "shoot";
  /** Ball position. During SPIN this is the centre; during SHOOT it's moving. */
  x: number;
  y: number;
  /** Arrow rotation (only relevant during SPIN). */
  angle: number;
  /** ms since start. */
  t: number;
}

export interface TrajectoryResult {
  steps: TrajectoryStep[];
  /** Final landing point. */
  resting: Point;
  durationMs: number;
}

const HALF = ARENA.HALF_SIDE;
const R = ARENA.BALL_RADIUS;
const DT = ARENA.SIM_DT_MS / 1000;
const MAX_STEPS = Math.ceil(ARENA.MAX_SIM_MS / ARENA.SIM_DT_MS);

// SPIN phase: arrow rotates around centre. Short (~1s) then launches.
const SPIN_INITIAL_OMEGA_MIN = 20;  // rad/sec ≈ 3.2 rev/sec
const SPIN_INITIAL_OMEGA_MAX = 28;  // rad/sec ≈ 4.5 rev/sec
const SPIN_FRICTION = 0.10;          // aggressive decel so spin lasts ~1s
const SPIN_LAUNCH_OMEGA = 3.0;       // launch threshold

// SHOOT phase: exponential decay over the whole ~9s — very fast at start,
// smoothly slowing down with no abrupt brake. Speed at t: v0 * decay^t.
const SHOOT_SPEED_MIN = 7.5;         // logical units / sec (arena is 2 units wide)
const SHOOT_SPEED_MAX = 9.0;
const SHOOT_DAMPING = 0.62;          // per-second multiplier → reaches ~6% at 6s
const SHOOT_STOP_SPEED = 0.04;

export interface SeedDerived {
  spinAngle0: number;
  spinOmega0: number;
  shootSpeed: number;
}

export function deriveFromSeed(seedHex: string): SeedDerived {
  const rng = new Xoshiro256ss(hexToBuf(seedHex));
  const dir = rng.nextFloat() < 0.5 ? -1 : 1;
  return {
    spinAngle0: rng.range(0, Math.PI * 2),
    spinOmega0: rng.range(SPIN_INITIAL_OMEGA_MIN, SPIN_INITIAL_OMEGA_MAX) * dir,
    shootSpeed: rng.range(SHOOT_SPEED_MIN, SHOOT_SPEED_MAX),
  };
}

/** Spawn point for the ball — always centre. */
export function initSpawnFromSeed(_seedHex: string): Point {
  return { x: 0, y: 0 };
}

export function simulateTrajectory(seedHex: string): TrajectoryResult {
  const d = deriveFromSeed(seedHex);
  const steps: TrajectoryStep[] = [];

  // Derive random spawn point — reversed seed bytes give an independent PRNG stream.
  const revBuf = new Uint8Array(hexToBuf(seedHex));
  revBuf.reverse();
  const spawnRng = new Xoshiro256ss(revBuf);
  const spawnX = spawnRng.range(-HALF * 0.5, HALF * 0.5);
  const spawnY = spawnRng.range(-HALF * 0.5, HALF * 0.5);

  // --- SPIN phase ---
  let angle = d.spinAngle0;
  let omega = d.spinOmega0;
  const spinDecay = Math.exp(Math.log(SPIN_FRICTION) * DT);
  let elapsedMs = 0;
  let i = 0;

  while (i < MAX_STEPS && Math.abs(omega) > SPIN_LAUNCH_OMEGA) {
    angle += omega * DT;
    omega *= spinDecay;
    elapsedMs += ARENA.SIM_DT_MS;
    steps.push({ phase: "spin", x: spawnX, y: spawnY, angle, t: elapsedMs });
    i++;
  }

  // --- SHOOT phase ---
  // Ball launches from the same spawn position.
  const launchAngle = angle;
  let vx = Math.cos(launchAngle) * d.shootSpeed;
  let vy = Math.sin(launchAngle) * d.shootSpeed;
  let x = spawnX;
  let y = spawnY;
  const shootDecay = Math.exp(Math.log(SHOOT_DAMPING) * DT);

  while (i < MAX_STEPS) {
    x += vx * DT;
    y += vy * DT;

    // Elastic reflection off walls (clamp + flip velocity).
    if (x > HALF - R) { x = HALF - R; vx = -Math.abs(vx); }
    else if (x < -HALF + R) { x = -HALF + R; vx = Math.abs(vx); }
    if (y > HALF - R) { y = HALF - R; vy = -Math.abs(vy); }
    else if (y < -HALF + R) { y = -HALF + R; vy = Math.abs(vy); }

    // Exponential deceleration: fast at start, smoothly slowing, no hard brake.
    vx *= shootDecay;
    vy *= shootDecay;

    elapsedMs += ARENA.SIM_DT_MS;
    steps.push({ phase: "shoot", x, y, angle: launchAngle, t: elapsedMs });
    i++;
    if (Math.hypot(vx, vy) < SHOOT_STOP_SPEED) break;
  }

  const last = steps[steps.length - 1] ?? { x: 0, y: 0, t: 0 };
  return { steps, resting: { x: last.x, y: last.y }, durationMs: last.t };
}

/** Determine winner: simulate, find resting point's wedge. */
export function resolveWinner(
  trajectorySeedHex: string,
  players: PlayerEntry[],
  potNano: bigint,
): { wedges: Wedge[]; winner: Wedge; result: TrajectoryResult } {
  const wedges = buildWedges(players, potNano);
  const result = simulateTrajectory(trajectorySeedHex);
  const winner = pointToWedge(result.resting, wedges);
  if (!winner) throw new Error("no wedges to resolve winner");
  return { wedges, winner, result };
}
