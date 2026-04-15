// Orbiting-ball animation (Portals-style).
//
// The ball spawns at a deterministic position inside the arena, then orbits
// around the centre with decelerating angular velocity. Its orbit radius slowly
// grows, so the ball eventually lands on the perimeter — the wedge containing
// that landing point is the winner.
//
// Server runs the simulation to determine the authoritative landing point;
// client replays the same seeded simulation for byte-identical animation.

import { ARENA, type PlayerEntry } from "./game.js";
import { Xoshiro256ss } from "./prng.js";
import { hexToBuf } from "./fair.js";
import { buildWedges, arcToPoint, type Point, type Wedge, PERIMETER_LEN } from "./wedges.js";

export interface BallState {
  /** Polar coords from arena centre. */
  radius: number;
  angle: number;
  omega: number; // angular velocity (rad/s, +ve = clockwise)
}

export interface TrajectoryStep {
  x: number;
  y: number;
  angle: number; // angular position (rad), used for the highlight rotation
  t: number;     // ms since start
}

export interface TrajectoryResult {
  start: BallState;
  steps: TrajectoryStep[];
  /** Final landing point on the perimeter. */
  resting: Point;
  durationMs: number;
}

const HALF = ARENA.HALF_SIDE;
const DT = ARENA.SIM_DT_MS / 1000;
const MAX_STEPS = Math.ceil(ARENA.MAX_SIM_MS / ARENA.SIM_DT_MS);

// Spin tuning — gives a 6-9s decelerating orbit that ends at the perimeter.
const INITIAL_OMEGA_MIN = 14;   // rad/sec (≈ 2.2 rev/sec)
const INITIAL_OMEGA_MAX = 22;   // rad/sec (≈ 3.5 rev/sec)
const FRICTION = 0.55;           // angular velocity multiplier per second
const STOP_OMEGA = 0.20;
const INITIAL_RADIUS_MIN = 0.15;
const INITIAL_RADIUS_MAX = 0.35;
const RADIUS_GROWTH_PER_SEC = 0.18; // base growth, scaled inversely with omega so it accelerates as ball slows
const MAX_RADIUS = HALF * 0.96;     // cap before we project to the square edge

export function initBallFromSeed(seedHex: string): BallState {
  const rng = new Xoshiro256ss(hexToBuf(seedHex));
  const dir = rng.nextFloat() < 0.5 ? -1 : 1;
  return {
    radius: rng.range(INITIAL_RADIUS_MIN, INITIAL_RADIUS_MAX),
    angle: rng.range(0, Math.PI * 2),
    omega: rng.range(INITIAL_OMEGA_MIN, INITIAL_OMEGA_MAX) * dir,
  };
}

/** Spawn point used by the renderer to position the ball before the spin starts. */
export function initSpawnFromSeed(seedHex: string): Point {
  const start = initBallFromSeed(seedHex);
  return polarToSquarePoint(start.radius, start.angle);
}

export function simulateTrajectory(seedHex: string): TrajectoryResult {
  const start = initBallFromSeed(seedHex);
  const state: BallState = { ...start };
  const steps: TrajectoryStep[] = [];

  const decay = Math.exp(Math.log(FRICTION) * DT);

  for (let i = 0; i < MAX_STEPS; i++) {
    state.angle += state.omega * DT;
    state.omega *= decay;
    // Slower the spin gets, faster the ball spirals outward.
    const speedFactor = 1 + (1 - Math.min(1, Math.abs(state.omega) / INITIAL_OMEGA_MAX)) * 1.2;
    state.radius = Math.min(MAX_RADIUS, state.radius + RADIUS_GROWTH_PER_SEC * speedFactor * DT);

    const p = polarToSquarePoint(state.radius, state.angle);
    steps.push({ x: p.x, y: p.y, angle: state.angle, t: (i + 1) * ARENA.SIM_DT_MS });

    // Stop conditions: omega tiny AND radius near edge.
    if (Math.abs(state.omega) < STOP_OMEGA && state.radius >= MAX_RADIUS - 0.01) break;
  }

  // Final landing: project to the square perimeter so it lies on a wedge edge.
  const last = steps[steps.length - 1] ?? { x: 0, y: 0, angle: 0, t: 0 };
  const finalAngle = last.angle;
  const dx = Math.cos(finalAngle);
  const dy = Math.sin(finalAngle);
  const k = Math.min(
    Math.abs(HALF / dx || Infinity),
    Math.abs(HALF / dy || Infinity),
  );
  const resting: Point = { x: dx * k, y: dy * k };
  // Replace the final step so animation lands exactly on the resting point.
  if (steps.length > 0) {
    steps[steps.length - 1] = { x: resting.x, y: resting.y, angle: finalAngle, t: last.t };
  }

  return { start, steps, resting, durationMs: last.t };
}

/** Polar to a point clamped within the square arena (radius is along the ray). */
function polarToSquarePoint(radius: number, angle: number): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // How far along this ray until we hit the square edge?
  const maxR = Math.min(
    Math.abs(HALF / dx || Infinity),
    Math.abs(HALF / dy || Infinity),
  );
  const r = Math.min(radius, maxR);
  return { x: dx * r, y: dy * r };
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
  const SIDE = HALF * 2;
  const eps = 1e-6;
  let arc: number;
  if (Math.abs(p.y + HALF) < eps) arc = p.x + HALF;
  else if (Math.abs(p.x - HALF) < eps) arc = SIDE + (p.y + HALF);
  else if (Math.abs(p.y - HALF) < eps) arc = SIDE * 2 + (HALF - p.x);
  else if (Math.abs(p.x + HALF) < eps) arc = SIDE * 3 + (HALF - p.y);
  else {
    const ax = Math.abs(p.x);
    const ay = Math.abs(p.y);
    const k = HALF / Math.max(ax, ay);
    return wedgeContainingPoint({ x: p.x * k, y: p.y * k }, wedges);
  }
  arc = ((arc % PERIMETER_LEN) + PERIMETER_LEN) % PERIMETER_LEN;
  for (const w of wedges) {
    if (arc >= w.startArc - eps && arc < w.endArc + eps) return w;
  }
  return wedges[wedges.length - 1]!;
}

export { arcToPoint };
