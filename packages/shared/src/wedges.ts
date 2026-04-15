// Corner-triangle arena layout (Portals-style).
//
// The dominant player (largest stake) owns the full arena background.
// Other players each get a corner triangle whose AREA = their stake fraction of the arena.
// Up to 4 players in corners (TL, TR, BR, BL), sorted by stake DESC.
// Extra players (5+) currently share the 4th corner or are stacked — for v1 we cap at 4
// visible corner slots and collapse the rest into the dominant region (they still win
// proportionally since the ball's landing point is mapped via perimeter arc length).

import { ARENA, PlayerEntry } from "./game.js";

export interface Wedge {
  userId: string;
  startArc: number;
  endArc: number;
  fraction: number;
  polygon: Point[];
  centroid: Point;
  /** Corner index 0..3 (TL, TR, BR, BL) or -1 if this is the dominant (fill) wedge. */
  corner: number;
}

export interface Point { x: number; y: number; }

const HALF = ARENA.HALF_SIDE;
const SIDE = HALF * 2;
const PERIMETER = SIDE * 4;
export const PERIMETER_LEN = PERIMETER;

/**
 * Map an arc-length s in [0, PERIMETER) to a perimeter point.
 * Origin = top-left corner (-h, -h). Walks clockwise.
 */
export function arcToPoint(s: number): Point {
  const t = ((s % PERIMETER) + PERIMETER) % PERIMETER;
  if (t < SIDE) return { x: -HALF + t, y: -HALF };
  if (t < SIDE * 2) return { x: HALF, y: -HALF + (t - SIDE) };
  if (t < SIDE * 3) return { x: HALF - (t - SIDE * 2), y: HALF };
  return { x: -HALF, y: HALF - (t - SIDE * 3) };
}

export function pointToArc(p: Point): number {
  const eps = 1e-9;
  if (Math.abs(p.y + HALF) < eps && p.x >= -HALF - eps && p.x <= HALF + eps) return p.x + HALF;
  if (Math.abs(p.x - HALF) < eps && p.y >= -HALF - eps && p.y <= HALF + eps) return SIDE + (p.y + HALF);
  if (Math.abs(p.y - HALF) < eps && p.x >= -HALF - eps && p.x <= HALF + eps) return SIDE * 2 + (HALF - p.x);
  if (Math.abs(p.x + HALF) < eps && p.y >= -HALF - eps && p.y <= HALF + eps) return SIDE * 3 + (HALF - p.y);
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const k = HALF / Math.max(ax, ay);
  return pointToArc({ x: p.x * k, y: p.y * k });
}

/**
 * Build corner-triangle wedges. Dominant player gets the full arena as a
 * "background" wedge; the next 3 players get corner triangles.
 * The WIN region mapping uses perimeter arc length so the ball's landing
 * point maps back to a wedge proportional to stake — matching the
 * visible triangle AREA for corners, and the remaining perimeter for the
 * dominant player.
 */
export function buildWedges(players: PlayerEntry[], potNano: bigint): Wedge[] {
  if (players.length === 0 || potNano === 0n) return [];

  // Sort by userId first (stable for reproducibility), then we'll rank by stake DESC.
  const byStake = [...players].sort((a, b) => {
    const sa = BigInt(a.stakeNano);
    const sb = BigInt(b.stakeNano);
    if (sa !== sb) return sb > sa ? 1 : -1;
    return a.userId < b.userId ? -1 : 1;
  });

  const SCALE = 1_000_000n;
  const fractionOf = (p: PlayerEntry) =>
    Number((BigInt(p.stakeNano) * SCALE) / potNano) / Number(SCALE);

  // Single player: full arena.
  if (byStake.length === 1) {
    const p = byStake[0]!;
    return [{
      userId: p.userId,
      startArc: 0,
      endArc: PERIMETER,
      fraction: 1,
      polygon: squarePolygon(),
      centroid: { x: 0, y: 0 },
      corner: -1,
    }];
  }

  // Assign corners to all non-dominant players (top 4 by stake after dominant).
  // Remaining players (rank > 4) fall back to sharing the dominant region.
  const dominant = byStake[0]!;
  const dominantFrac = fractionOf(dominant);

  // Corner order: TL, TR, BR, BL
  const CORNERS = [
    { cx: -HALF, cy: -HALF, signX: 1,  signY: 1,  arcStart: 0 },               // TL
    { cx:  HALF, cy: -HALF, signX: -1, signY: 1,  arcStart: SIDE },             // TR
    { cx:  HALF, cy:  HALF, signX: -1, signY: -1, arcStart: SIDE * 2 },          // BR
    { cx: -HALF, cy:  HALF, signX: 1,  signY: -1, arcStart: SIDE * 3 },          // BL
  ];

  // Players 1..4 (by stake rank) take the 4 corners. Player 0 (dominant) is the background.
  const wedges: Wedge[] = [];
  // The dominant wedge fills the whole arena perimeter; corner wedges overwrite pieces of it.
  wedges.push({
    userId: dominant.userId,
    startArc: 0,
    endArc: PERIMETER,
    fraction: dominantFrac,
    polygon: squarePolygon(),
    centroid: { x: 0, y: 0 },
    corner: -1,
  });

  const cornerPlayers = byStake.slice(1, 5);
  for (let i = 0; i < cornerPlayers.length; i++) {
    const p = cornerPlayers[i]!;
    const c = CORNERS[i]!;
    const f = fractionOf(p);
    // Corner triangle side length so AREA = f * arenaArea.
    // Triangle area = 0.5 * s^2.  arena area = (2h)^2 = 4h^2.
    // 0.5 * s^2 = f * 4h^2  =>  s = sqrt(8 * f) * h
    const s = Math.min(SIDE, Math.sqrt(8 * f) * HALF);
    const polygon: Point[] = [
      { x: c.cx,                 y: c.cy },
      { x: c.cx + c.signX * s,   y: c.cy },
      { x: c.cx,                 y: c.cy + c.signY * s },
    ];
    // Place avatar at the triangle's INCENTER (centre of inscribed circle).
    // For a right isoceles triangle with legs s: incenter offset = s * (1 - 1/sqrt(2)).
    const inOff = s * (1 - 1 / Math.SQRT2);
    const centroid: Point = {
      x: c.cx + c.signX * inOff,
      y: c.cy + c.signY * inOff,
    };
    // Corner wedge owns arc length f*PERIMETER starting from corner.
    const startArc = c.arcStart;
    const endArc = c.arcStart + f * PERIMETER;
    wedges.push({
      userId: p.userId,
      startArc,
      endArc,
      fraction: f,
      polygon,
      centroid,
      corner: i,
    });
  }

  return wedges;
}

/** Full arena square polygon. */
function squarePolygon(): Point[] {
  return [
    { x: -HALF, y: -HALF },
    { x:  HALF, y: -HALF },
    { x:  HALF, y:  HALF },
    { x: -HALF, y:  HALF },
  ];
}

/** Which wedge does a point fall in? Corners first, then dominant. */
export function pointToWedge(p: Point, wedges: Wedge[]): Wedge | null {
  if (wedges.length === 0) return null;
  if (wedges.length === 1) return wedges[0]!;
  for (const w of wedges) {
    if (w.corner >= 0 && pointInPolygon(p, w.polygon)) return w;
  }
  return wedges.find((w) => w.corner === -1) ?? wedges[0]!;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

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
  if (Math.abs(area) < 1e-12) return { x: 0, y: 0 };
  return { x: cx / (6 * area), y: cy / (6 * area) };
}
