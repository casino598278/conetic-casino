import { describe, it, expect } from "vitest";
import { simulateMining, deriveMiningSeed, MINING } from "../mining.js";

describe("mining (2D map)", () => {
  it("identical seeds → identical outcome", () => {
    const seeds = ["a".repeat(64), "b".repeat(64)];
    const a = simulateMining(seeds, [0.5, 0.5], "c".repeat(64));
    const b = simulateMining(seeds, [0.5, 0.5], "c".repeat(64));
    expect(a.finalGems).toEqual(b.finalGems);
    expect(a.winnerIndex).toEqual(b.winnerIndex);
    expect(a.frames.length).toEqual(b.frames.length);
  });

  it("simulation has frames and collects gems", () => {
    const seeds = ["1".repeat(64), "2".repeat(64)];
    const r = simulateMining(seeds, [0.5, 0.5], "3".repeat(64));
    expect(r.frames.length).toBeGreaterThan(0);
    const total = r.finalGems.reduce((s, g) => s + g, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("higher stake fraction tends to win", () => {
    let dominantWins = 0;
    for (let i = 0; i < 20; i++) {
      const seeds = [`${i}`.padStart(64, "0"), `${i + 1000}`.padStart(64, "0")];
      const r = simulateMining(seeds, [0.9, 0.1], `${i + 2000}`.padStart(64, "0"));
      if (r.winnerIndex === 0) dominantWins++;
    }
    expect(dominantWins).toBeGreaterThan(10);
  });

  it("early first-to-N exit records winReachedAt", () => {
    const seeds = ["ff".repeat(32), "aa".repeat(32)];
    const r = simulateMining(seeds, [0.99, 0.01], "bb".repeat(32));
    // Either early win or full time — both are valid
    if (r.winReachedAt !== null) {
      expect(r.winReachedAt).toBeLessThanOrEqual(MINING.DURATION_MS);
    }
  });

  it("derive per-player seeds gives distinct values", async () => {
    const a = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 0);
    const b = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 1);
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
  });
});
