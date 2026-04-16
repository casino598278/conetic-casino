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
    const r = simulateMining(seeds, [0.5, 0.5]);
    expect(r.finalGems.length).toBe(2);
    expect(r.finalGems.every((g) => g > 0)).toBe(true);
    expect(r.durationMs).toBe(MINING.DURATION_MS);
  });

  it("higher stake fraction wins more often", () => {
    // Run 50 sims with the dominant player at 90% stake
    let dominantWins = 0;
    for (let i = 0; i < 50; i++) {
      const seeds = [`${i}`.padStart(64, "0"), `${i + 1000}`.padStart(64, "0")];
      const r = simulateMining(seeds, [0.9, 0.1]);
      if (r.winnerIndex === 0) dominantWins++;
    }
    // At 0.9 stake fraction, dominant should win the vast majority
    expect(dominantWins).toBeGreaterThan(35);
  });

  it("derive per-player seeds gives distinct values", async () => {
    const a = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 0);
    const b = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 1);
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
  });
});
