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
import { buildWedges, type Point, type Wedge, PERIMETER_LEN } from "./wedges.js";

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

// SHOOT phase: ball travels with elastic wall bounces, damping ramps up late.
// Tuned so the ball cruises fast for ~6s then decelerates hard over the last ~2s.
const SHOOT_SPEED_MIN = 4.0;         // logical units / sec (arena is 2 units wide)
const SHOOT_SPEED_MAX = 5.0;
const SHOOT_COAST_SEC = 6.0;         // low-friction cruise window
const SHOOT_COAST_DAMPING = 0.97;    // per-second (very light decel)
const SHOOT_BRAKE_DAMPING = 0.18;    // per-second (hard decel after coast)
const SHOOT_STOP_SPEED = 0.06;

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
    steps.push({ phase: "spin", x: 0, y: 0, angle, t: elapsedMs });
    i++;
  }

  // --- SHOOT phase ---
  const launchAngle = angle;
  let vx = Math.cos(launchAngle) * d.shootSpeed;
  let vy = Math.sin(launchAngle) * d.shootSpeed;
  let x = 0;
  let y = 0;
  const coastDecay = Math.exp(Math.log(SHOOT_COAST_DAMPING) * DT);
  const brakeDecay = Math.exp(Math.log(SHOOT_BRAKE_DAMPING) * DT);
  const shootStartMs = elapsedMs;

  while (i < MAX_STEPS) {
    x += vx * DT;
    y += vy * DT;

    // Elastic reflection off walls (clamp + flip velocity).
    if (x > HALF - R) {
      x = HALF - R;
      vx = -Math.abs(vx);
    } else if (x < -HALF + R) {
      x = -HALF + R;
      vx = Math.abs(vx);
    }
    if (y > HALF - R) {
      y = HALF - R;
      vy = -Math.abs(vy);
    } else if (y < -HALF + R) {
      y = -HALF + R;
      vy = Math.abs(vy);
    }

    // First ~6s: near-frictionless cruise. After that: hard brake.
    const shootElapsedSec = (elapsedMs - shootStartMs) / 1000;
    const decay = shootElapsedSec < SHOOT_COAST_SEC ? coastDecay : brakeDecay;
    vx *= decay;
    vy *= decay;

    elapsedMs += ARENA.SIM_DT_MS;
    steps.push({ phase: "shoot", x, y, angle: launchAngle, t: elapsedMs });
    i++;
    if (shootElapsedSec >= SHOOT_COAST_SEC && Math.hypot(vx, vy) < SHOOT_STOP_SPEED) break;
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
  const winner = wedgeContainingPoint(result.resting, wedges);
  if (!winner) throw new Error("no wedges to resolve winner");
  return { wedges, winner, result };
}

function wedgeContainingPoint(p: Point, wedges: Wedge[]): Wedge | null {
  if (wedges.length === 0) return null;
  if (wedges.length === 1) return wedges[0]!;
  // Project ray from origin through p to the perimeter, then arc-length lookup.
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  if (ax < 1e-9 && ay < 1e-9) return wedges[0]!;
  const k = HALF / Math.max(ax, ay);
  const px = p.x * k;
  const py = p.y * k;
  const SIDE = HALF * 2;
  const eps = 1e-4;
  let arc: number;
  if (Math.abs(py + HALF) < eps) arc = px + HALF;
  else if (Math.abs(px - HALF) < eps) arc = SIDE + (py + HALF);
  else if (Math.abs(py - HALF) < eps) arc = SIDE * 2 + (HALF - px);
  else if (Math.abs(px + HALF) < eps) arc = SIDE * 3 + (HALF - py);
  else return wedges[0]!;
  arc = ((arc % PERIMETER_LEN) + PERIMETER_LEN) % PERIMETER_LEN;
  for (const w of wedges) {
    if (arc >= w.startArc - eps && arc < w.endArc + eps) return w;
  }
  return wedges[wedges.length - 1]!;
}
