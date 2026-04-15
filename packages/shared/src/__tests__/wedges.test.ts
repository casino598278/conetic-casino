import { describe, it, expect } from "vitest";
import { buildWedges, pointToWedge, PERIMETER_LEN } from "../wedges.js";
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

describe("wedges", () => {
  it("two-player even split → arc lengths sum to perimeter, each 50%", () => {
    const players = [mkPlayer("1", 100n), mkPlayer("2", 100n)];
    const wedges = buildWedges(players, 200n);
    expect(wedges).toHaveLength(2);
    expect(wedges[0]!.endArc - wedges[0]!.startArc).toBeCloseTo(PERIMETER_LEN / 2, 6);
    expect(wedges[1]!.endArc).toBeCloseTo(PERIMETER_LEN, 6);
  });

  it("weighted split matches stake fractions", () => {
    const players = [mkPlayer("1", 28n), mkPlayer("2", 20n)]; // 58.33% / 41.66%
    const wedges = buildWedges(players, 48n);
    expect(wedges[0]!.fraction).toBeCloseTo(28 / 48, 4);
    expect(wedges[1]!.fraction).toBeCloseTo(20 / 48, 4);
  });

  it("pointToWedge places center-of-wedge centroid back in same wedge", () => {
    const players = [mkPlayer("1", 50n), mkPlayer("2", 30n), mkPlayer("3", 20n)];
    const wedges = buildWedges(players, 100n);
    for (const w of wedges) {
      const found = pointToWedge(w.centroid, wedges);
      expect(found?.userId).toBe(w.userId);
    }
  });
});
