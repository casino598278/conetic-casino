import { describe, it, expect } from "vitest";
import { simulateMining, deriveMiningSeed, MINING } from "../mining.js";

describe("mining", () => {
  it("identical seeds → identical outcome", () => {
    const seeds = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    const a = simulateMining(seeds);
    const b = simulateMining(seeds);
    expect(a.finalGems).toEqual(b.finalGems);
    expect(a.winnerIndex).toEqual(b.winnerIndex);
  });

  it("simulation produces gems for all players over expected duration", () => {
    const seeds = ["1".repeat(64), "2".repeat(64)];
    const r = simulateMining(seeds);
    expect(r.finalGems.length).toBe(2);
    expect(r.finalGems.every((g) => g > 0)).toBe(true);
    expect(r.durationMs).toBe(MINING.DURATION_MS);
  });

  it("derive per-player seeds gives distinct values", async () => {
    const a = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 0);
    const b = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 1);
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
  });
});
