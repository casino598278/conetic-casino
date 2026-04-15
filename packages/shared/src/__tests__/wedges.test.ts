import { describe, it, expect } from "vitest";
import { buildWedges, pointToWedge } from "../wedges.js";
import type { PlayerEntry } from "../game.js";

const mkPlayer = (userId: string, stake: bigint): PlayerEntry => ({
  userId,
  tgId: parseInt(userId, 10),
  username: `u${userId}`,
  firstName: `U${userId}`,
  photoUrl: null,
  stakeNano: stake.toString(),
  clientSeedHex: "00".repeat(16),
});

describe("corner-triangle wedges", () => {
  it("single player → one wedge marked as dominant (corner: -1)", () => {
    const wedges = buildWedges([mkPlayer("1", 100n)], 100n);
    expect(wedges).toHaveLength(1);
    expect(wedges[0]!.corner).toBe(-1);
    expect(wedges[0]!.fraction).toBeCloseTo(1, 6);
  });

  it("two-player split → dominant + one corner triangle", () => {
    const players = [mkPlayer("1", 70n), mkPlayer("2", 30n)];
    const wedges = buildWedges(players, 100n);
    expect(wedges).toHaveLength(2);
    const dominant = wedges.find((w) => w.corner === -1)!;
    const corner = wedges.find((w) => w.corner === 0)!;
    expect(dominant.userId).toBe("1");
    expect(corner.userId).toBe("2");
    expect(corner.fraction).toBeCloseTo(0.3, 4);
  });

  it("centroid of dominant wedge is arena centre", () => {
    const wedges = buildWedges([mkPlayer("1", 80n), mkPlayer("2", 20n)], 100n);
    const dominant = wedges.find((w) => w.corner === -1)!;
    expect(dominant.centroid.x).toBeCloseTo(0, 6);
    expect(dominant.centroid.y).toBeCloseTo(0, 6);
  });

  it("pointToWedge returns the corner when a point is inside that triangle", () => {
    const players = [mkPlayer("1", 80n), mkPlayer("2", 20n)];
    const wedges = buildWedges(players, 100n);
    const corner = wedges.find((w) => w.corner === 0)!;
    const found = pointToWedge(corner.centroid, wedges);
    expect(found?.userId).toBe("2");
  });
});
