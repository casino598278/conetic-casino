// Roulette-pointer animation (Portals-style).
//
// The "ball" is fixed at the arena center. A white pointer rotates around it,
// starting with high angular velocity, decelerating, and coming to rest pointing
// at one of the perimeter arcs. The wedge containing that perimeter point wins.
//
// Both client + server simulate the same trajectory from the same seed so the
// animation is deterministic — server is authoritative on the final angle.

import { ARENA, type PlayerEntry } from "./game.js";
import { Xoshiro256ss } from "./prng.js";
import { hexToBuf } from "./fair.js";
import { buildWedges, arcToPoint, type Point, type Wedge, PERIMETER_LEN } from "./wedges.js";

export interface PointerState {
  /** Angle in radians (0 = pointing along +x, increases clockwise like screen coords). */
  angle: number;
  /** Angular velocity (rad/sec) — positive = clockwise. */
  omega: number;
}

export interface TrajectoryStep extends PointerState {
  t: number; // ms since start
}

export interface TrajectoryResult {
  start: PointerState;
  steps: TrajectoryStep[];
  /** Final pointer angle (radians). */
  finalAngle: number;
  /** Perimeter point the pointer rests on. */
  resting: Point;
  durationMs: number;
}

const DT = ARENA.SIM_DT_MS / 1000;
const MAX_STEPS = Math.ceil(ARENA.MAX_SIM_MS / ARENA.SIM_DT_MS);

// Spin tuning — gives a 6-9s decelerating spin like a roulette wheel.
const INITIAL_OMEGA_MIN = 18;  // rad/sec ~= 2.9 rev/sec
const INITIAL_OMEGA_MAX = 26;  // rad/sec ~= 4.1 rev/sec
const FRICTION = 0.55;          // angular velocity multiplier per second
const STOP_OMEGA = 0.15;        // rad/sec — pointer stops below this

export function initPointerFromSeed(seedHex: string): PointerState {
  const rng = new Xoshiro256ss(hexToBuf(seedHex));
  return {
    angle: rng.range(0, Math.PI * 2),
    omega: rng.range(INITIAL_OMEGA_MIN, INITIAL_OMEGA_MAX),
  };
}

/** Derive a random spawn position inside the arena from the seed (deterministic). */
export function initSpawnFromSeed(seedHex: string): Point {
  // Reverse the seed bytes so we get an independent PRNG stream from the pointer.
  const buf = hexToBuf(seedHex);
  const reversed = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) reversed[i] = buf[buf.length - 1 - i]!;
  const rng = new Xoshiro256ss(reversed);
  // Spawn within central 70% of arena (stay clear of edges).
  const inner = ARENA.HALF_SIDE * 0.7;
  return { x: rng.range(-inner, inner), y: rng.range(-inner, inner) };
}

export function simulateTrajectory(seedHex: string): TrajectoryResult {
  const start = initPointerFromSeed(seedHex);
  const state: PointerState = { ...start };
  const steps: TrajectoryStep[] = [];

  const decay = Math.exp(Math.log(FRICTION) * DT);

  for (let i = 0; i < MAX_STEPS; i++) {
    state.angle += state.omega * DT;
    state.omega *= decay;
    steps.push({ angle: state.angle, omega: state.omega, t: (i + 1) * ARENA.SIM_DT_MS });
    if (Math.abs(state.omega) < STOP_OMEGA) break;
  }

  const last = steps[steps.length - 1] ?? { angle: start.angle, omega: 0, t: 0 };
  const finalAngle = ((last.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  // Convert pointer angle → perimeter point.
  // Angle 0 = (+1, 0), increases clockwise (Pixi screen coords y-down).
  // Cast a ray from origin out to the square edge.
  const dx = Math.cos(finalAngle);
  const dy = Math.sin(finalAngle);
  const k = Math.min(
    Math.abs(ARENA.HALF_SIDE / dx || Infinity),
    Math.abs(ARENA.HALF_SIDE / dy || Infinity),
  );
  const resting: Point = { x: dx * k, y: dy * k };

  return { start, steps, finalAngle, resting, durationMs: last.t };
}

/** Determine winner: simulate, find resting point's wedge. */
export function resolveWinner(
  trajectorySeedHex: string,
  players: PlayerEntry[],
  potNano: bigint,
): { wedges: Wedge[]; winner: Wedge; result: TrajectoryResult } {
  const wedges = buildWedges(players, potNano);
  const result = simulateTrajectory(trajectorySeedHex);
  // Find which wedge's arc contains the final resting perimeter point.
  // Convert resting point → arc length, then find containing wedge.
  const winner = wedgeContainingPoint(result.resting, wedges);
  if (!winner) throw new Error("no wedges to resolve winner");
  return { wedges, winner, result };
}

function wedgeContainingPoint(p: Point, wedges: Wedge[]): Wedge | null {
  if (wedges.length === 0) return null;
  if (wedges.length === 1) return wedges[0]!;
  // Compute arc length along perimeter from origin (top-left, clockwise).
  // wedges.ts uses pointToArc internally; replicate inline to avoid import cycle.
  const HALF = ARENA.HALF_SIDE;
  const SIDE = HALF * 2;
  const eps = 1e-6;
  let arc: number;
  if (Math.abs(p.y + HALF) < eps) arc = p.x + HALF;
  else if (Math.abs(p.x - HALF) < eps) arc = SIDE + (p.y + HALF);
  else if (Math.abs(p.y - HALF) < eps) arc = SIDE * 2 + (HALF - p.x);
  else if (Math.abs(p.x + HALF) < eps) arc = SIDE * 3 + (HALF - p.y);
  else {
    // Project to nearest edge.
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

// Re-export so callers can keep using arcToPoint
export { arcToPoint };
