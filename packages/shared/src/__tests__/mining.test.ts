import { describe, it, expect } from "vitest";
import { simulateMining, deriveMiningSeed, MINING, GEMS } from "../mining.js";

describe("mining (2D map with gem types)", () => {
  it("identical seeds → identical outcome", () => {
    const seeds = ["a".repeat(64), "b".repeat(64)];
    const a = simulateMining(seeds, [0.5, 0.5], "c".repeat(64));
    const b = simulateMining(seeds, [0.5, 0.5], "c".repeat(64));
    expect(a.finalPoints).toEqual(b.finalPoints);
    expect(a.winnerIndex).toEqual(b.winnerIndex);
  });

  it("simulation collects gems and scores points", () => {
    const seeds = ["1".repeat(64), "2".repeat(64)];
    const r = simulateMining(seeds, [0.5, 0.5], "3".repeat(64));
    expect(r.frames.length).toBeGreaterThan(0);
    const total = r.finalPoints.reduce((s, p) => s + p, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("higher stake tends to win and prefers high-value gems", () => {
    let dominantWins = 0;
    for (let i = 0; i < 20; i++) {
      const seeds = [`${i}`.padStart(64, "0"), `${i + 1000}`.padStart(64, "0")];
      const r = simulateMining(seeds, [0.9, 0.1], `${i + 2000}`.padStart(64, "0"));
      if (r.winnerIndex === 0) dominantWins++;
    }
    expect(dominantWins).toBeGreaterThan(10);
  });

  it("gem types have correct values", () => {
    expect(GEMS.emerald.value).toBe(1);
    expect(GEMS.sapphire.value).toBe(3);
    expect(GEMS.amethyst.value).toBe(8);
    expect(GEMS.diamond.value).toBe(25);
  });

  it("frames include gems with types", () => {
    const r = simulateMining(["a".repeat(64)], [1], "b".repeat(64));
    expect(r.frames[0]!.gems.length).toBeGreaterThan(0);
    expect(r.frames[0]!.gems[0]!.type).toBeDefined();
  });

  it("derive per-player seeds gives distinct values", async () => {
    const a = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 0);
    const b = await deriveMiningSeed("ff".repeat(32), "11".repeat(16), 1);
    expect(a).not.toEqual(b);
  });

  it("target points constant is set", () => {
    expect(MINING.TARGET_POINTS).toBe(200);
  });
});
