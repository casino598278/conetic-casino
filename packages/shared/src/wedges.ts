// Square-perimeter wedge math.
//
// The arena is a square centered at (0,0) with half-side `h`. Perimeter length = 8h.
// Players sorted by userId (stable). Each gets an arc-length slice of the perimeter
// proportional to their stake. A wedge is the polygon from (0,0) walking the perimeter
// from arcStart to arcEnd, inserting a vertex at every corner crossed.

import { ARENA, PlayerEntry } from "./game.js";

export interface Wedge {
  userId: string;
  startArc: number;       // [0, P)
  endArc: number;         // (startArc, P]
  fraction: number;       // stake / pot
  polygon: Point[];       // [center, ...perimeterVertices]
  centroid: Point;        // for avatar placement
}

export interface Point {
  x: number;
  y: number;
}

const HALF = ARENA.HALF_SIDE;
const SIDE = HALF * 2;
const PERIMETER = SIDE * 4;

/**
 * Map an arc-length s in [0, PERIMETER) to a perimeter point.
 * Origin = top-left corner (-h, -h). Walks clockwise.
 *   side 0: top edge,    s in [0, SIDE),  point = (-h + s, -h)
 *   side 1: right edge,  s in [SIDE, 2S), point = (h, -h + (s - SIDE))
 *   side 2: bottom edge, s in [2S, 3S),   point = (h - (s - 2S), h)
 *   side 3: left edge,   s in [3S, 4S),   point = (-h, h - (s - 3S))
 */
export function arcToPoint(s: number): Point {
  const t = ((s % PERIMETER) + PERIMETER) % PERIMETER;
  if (t < SIDE) return { x: -HALF + t, y: -HALF };
  if (t < SIDE * 2) return { x: HALF, y: -HALF + (t - SIDE) };
  if (t < SIDE * 3) return { x: HALF - (t - SIDE * 2), y: HALF };
  return { x: -HALF, y: HALF - (t - SIDE * 3) };
}

/** Inverse of arcToPoint for a perimeter point. */
export function pointToArc(p: Point): number {
  const eps = 1e-9;
  if (Math.abs(p.y + HALF) < eps && p.x >= -HALF - eps && p.x <= HALF + eps) {
    return p.x + HALF;
  }
  if (Math.abs(p.x - HALF) < eps && p.y >= -HALF - eps && p.y <= HALF + eps) {
    return SIDE + (p.y + HALF);
  }
  if (Math.abs(p.y - HALF) < eps && p.x >= -HALF - eps && p.x <= HALF + eps) {
    return SIDE * 2 + (HALF - p.x);
  }
  if (Math.abs(p.x + HALF) < eps && p.y >= -HALF - eps && p.y <= HALF + eps) {
    return SIDE * 3 + (HALF - p.y);
  }
  // Not on perimeter — project to nearest edge by clamping ray from origin.
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  if (ax > ay) {
    const k = HALF / ax;
    return pointToArc({ x: p.x * k, y: p.y * k });
  } else {
    const k = HALF / ay;
    return pointToArc({ x: p.x * k, y: p.y * k });
  }
}

/** Cumulative arc-length cuts, sorted by stake-derived order. */
export function buildWedges(players: PlayerEntry[], potNano: bigint): Wedge[] {
  if (players.length === 0 || potNano === 0n) return [];

  // Stable order: by userId asc.
  const sorted = [...players].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  // Compute integer arc lengths in micro-units to avoid float drift, then scale.
  const SCALE = 1_000_000n;
  const cumNano: bigint[] = [];
  let acc = 0n;
  for (const p of sorted) {
    acc += BigInt(p.stakeNano);
    cumNano.push(acc);
  }

  const wedges: Wedge[] = [];
  let prevArc = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const cum = cumNano[i]!;
    const fraction = Number((cum * SCALE) / potNano) / Number(SCALE);
    const endArc = i === sorted.length - 1 ? PERIMETER : fraction * PERIMETER;
    const polygon = wedgePolygon(prevArc, endArc);
    const stakeFrac = Number(BigInt(p.stakeNano) * SCALE / potNano) / Number(SCALE);
    // Place avatar at the wedge's true centroid (visual centre of mass).
    const centroid = wedgeAvatarPoint(polygon, prevArc, endArc, stakeFrac);
    wedges.push({
      userId: p.userId,
      startArc: prevArc,
      endArc,
      fraction: stakeFrac,
      polygon,
      centroid,
    });
    prevArc = endArc;
  }
  return wedges;
}

/**
 * Visual centre of the wedge for avatar placement.
 *
 * Strategy: use the polygon's geometric centroid (true centre of mass), but
 * blend slightly toward the perimeter midpoint — that keeps avatars away from
 * the arena origin where all wedges meet at a point, which would cause them
 * to crowd each other.
 */
function wedgeAvatarPoint(
  polygon: Point[],
  startArc: number,
  endArc: number,
  fraction: number,
): Point {
  // Single full wedge (one player owns 100%) → arena centre.
  if (fraction >= 0.999) return { x: 0, y: 0 };

  const c = wedgeCentroid(polygon);
  const midArc = (startArc + endArc) / 2;
  const perim = arcToPoint(midArc);
  // Blend the centroid toward the perimeter midpoint by a small factor.
  // Tiny wedges blend MORE (their centroid is near the origin, push outward).
  // Big wedges blend LESS (their centroid is already a great visual centre).
  const blend = 0.25 + (1 - Math.min(1, fraction * 1.4)) * 0.25;
  return {
    x: c.x * (1 - blend) + perim.x * blend,
    y: c.y * (1 - blend) + perim.y * blend,
  };
}

/** Polygon = [center, perim(start), corners crossed..., perim(end)] */
export function wedgePolygon(startArc: number, endArc: number): Point[] {
  const pts: Point[] = [{ x: 0, y: 0 }];
  pts.push(arcToPoint(startArc));
  // corners are at multiples of SIDE
  const cornerArcs = [SIDE, SIDE * 2, SIDE * 3, SIDE * 4];
  for (const c of cornerArcs) {
    if (c > startArc + 1e-9 && c < endArc - 1e-9) {
      pts.push(arcToPoint(c));
    }
  }
  pts.push(arcToPoint(endArc));
  return pts;
}

/** Geometric centroid of a polygon. */
export function wedgeCentroid(polygon: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    // Degenerate (single-player full circle): return midway from center to perim midpoint.
    const mid = polygon[Math.floor(polygon.length / 2)] ?? { x: 0, y: 0 };
    return { x: mid.x * 0.5, y: mid.y * 0.5 };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Find which wedge contains point p. Returns null if no wedges. */
export function pointToWedge(p: Point, wedges: Wedge[]): Wedge | null {
  if (wedges.length === 0) return null;
  if (wedges.length === 1) return wedges[0]!;
  // Project ray from center to perimeter through p, take the arc.
  const arc = pointToArc(p);
  for (const w of wedges) {
    if (arc >= w.startArc - 1e-9 && arc < w.endArc + 1e-9) return w;
  }
  return wedges[wedges.length - 1]!;
}

export const PERIMETER_LEN = PERIMETER;
