// Deterministic ball trajectory simulation. Server runs to authoritative resting point;
// client replays frame-by-frame for the animation. Both must produce identical output
// from the same seed.

import { ARENA, type PlayerEntry } from "./game.js";
import { Xoshiro256ss } from "./prng.js";
import { hexToBuf } from "./fair.js";
import { buildWedges, pointToWedge, type Point, type Wedge } from "./wedges.js";

const HALF = ARENA.HALF_SIDE;
const R = ARENA.BALL_RADIUS;
const DT = ARENA.SIM_DT_MS / 1000;       // seconds
const DAMPING = ARENA.DAMPING_PER_SEC;    // velocity *= e^(-(1-DAMPING)*dt) per sec
const STOP = ARENA.STOP_SPEED;
const MAX_STEPS = Math.ceil(ARENA.MAX_SIM_MS / ARENA.SIM_DT_MS);

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface TrajectoryStep extends BallState {
  t: number; // ms since start
}

export interface TrajectoryResult {
  start: BallState;
  steps: TrajectoryStep[];
  resting: Point;
  durationMs: number;
}

/** Initial ball state from a seed. */
export function initBallFromSeed(seedHex: string): BallState {
  const rng = new Xoshiro256ss(hexToBuf(seedHex));
  // Spawn within central 60% of arena to avoid immediate edge contact.
  const inner = HALF * 0.6;
  const x = rng.range(-inner, inner);
  const y = rng.range(-inner, inner);
  const angle = rng.range(0, Math.PI * 2);
  const speed = rng.range(ARENA.INITIAL_SPEED_MIN, ARENA.INITIAL_SPEED_MAX);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
}

/**
 * Run the full simulation. Returns every frame so the client animation
 * matches the server-determined resting point exactly.
 */
export function simulateTrajectory(seedHex: string): TrajectoryResult {
  const start = initBallFromSeed(seedHex);
  const ball: BallState = { ...start };
  const steps: TrajectoryStep[] = [];

  const decay = Math.exp(Math.log(DAMPING) * DT); // velocity multiplier per step

  for (let i = 0; i < MAX_STEPS; i++) {
    ball.x += ball.vx * DT;
    ball.y += ball.vy * DT;

    // Elastic reflection — clamp + flip velocity.
    if (ball.x > HALF - R) {
      ball.x = HALF - R;
      ball.vx = -Math.abs(ball.vx);
    } else if (ball.x < -HALF + R) {
      ball.x = -HALF + R;
      ball.vx = Math.abs(ball.vx);
    }
    if (ball.y > HALF - R) {
      ball.y = HALF - R;
      ball.vy = -Math.abs(ball.vy);
    } else if (ball.y < -HALF + R) {
      ball.y = -HALF + R;
      ball.vy = Math.abs(ball.vy);
    }

    ball.vx *= decay;
    ball.vy *= decay;

    steps.push({ x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, t: (i + 1) * ARENA.SIM_DT_MS });

    if (Math.hypot(ball.vx, ball.vy) < STOP) break;
  }

  const last = steps[steps.length - 1] ?? { x: start.x, y: start.y, t: 0 };
  return {
    start,
    steps,
    resting: { x: last.x, y: last.y },
    durationMs: last.t,
  };
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
