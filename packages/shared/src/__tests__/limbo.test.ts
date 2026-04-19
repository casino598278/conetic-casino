import { describe, it, expect } from "vitest";
import {
  playLimbo,
  limboMultiplier,
  limboWinChance,
  HOUSE_RTP,
  LIMBO_MIN_TARGET,
  LIMBO_RESULT_CAP,
} from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

describe("limbo fairness", () => {
  it("multiplier = target; winChance = 0.99 / target", () => {
    for (const t of [1.01, 1.5, 2, 10, 100, 1000]) {
      const p = { target: t };
      expect(limboMultiplier(p)).toBeCloseTo(t, 6);
      expect(limboMultiplier(p) * limboWinChance(p)).toBeCloseTo(HOUSE_RTP, 6);
    }
  });

  it("determinism: same seed+nonce → same result", async () => {
    const a = await playLimbo(SERVER, CLIENT, 7, { target: 2 });
    const b = await playLimbo(SERVER, CLIENT, 7, { target: 2 });
    expect(a.result).toEqual(b.result);
    expect(a.win).toEqual(b.win);
  });

  it("different nonces diverge", async () => {
    const seen = new Set<number>();
    for (let n = 0; n < 40; n++) {
      const r = await playLimbo(SERVER, CLIENT, n, { target: 2 });
      seen.add(r.result);
    }
    expect(seen.size).toBeGreaterThan(25);
  });

  it("result is always >= 1 and <= cap", async () => {
    for (let n = 0; n < 200; n++) {
      const r = await playLimbo(SERVER, CLIENT, n, { target: 2 });
      expect(r.result).toBeGreaterThanOrEqual(1);
      expect(r.result).toBeLessThanOrEqual(LIMBO_RESULT_CAP);
    }
  });

  it("win decision matches result vs target", async () => {
    for (let n = 0; n < 60; n++) {
      const r = await playLimbo(SERVER, CLIENT, n, { target: 2 });
      expect(r.win).toBe(r.result >= 2);
    }
  });

  it("RTP converges to ~99% over many plays at target 2×", async () => {
    const N = 3000;
    const stake = 1;
    const target = 2;
    const mult = limboMultiplier({ target });
    let returned = 0;
    for (let n = 0; n < N; n++) {
      const r = await playLimbo(SERVER, CLIENT, n, { target });
      if (r.win) returned += stake * mult;
    }
    const rtp = returned / (N * stake);
    // ~1.4% std dev at N=3000 → 6% tolerance is loose
    expect(rtp).toBeGreaterThan(0.92);
    expect(rtp).toBeLessThan(1.06);
  });

  it("at target = min (1.01×), most plays win", async () => {
    const N = 500;
    let wins = 0;
    for (let n = 0; n < N; n++) {
      const r = await playLimbo(SERVER, CLIENT, n, { target: LIMBO_MIN_TARGET });
      if (r.win) wins++;
    }
    // Expected ~98%. Be loose.
    expect(wins / N).toBeGreaterThan(0.90);
  });
});
