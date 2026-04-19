import { describe, it, expect } from "vitest";
import { playDice, diceMultiplier, diceWinChance, HOUSE_RTP } from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

describe("dice fairness", () => {
  it("multiplier = 0.99 / winChance", () => {
    for (const t of [1, 25, 50, 50.5, 75, 99]) {
      const over = { target: t, over: true };
      const under = { target: t, over: false };
      expect(diceMultiplier(over) * diceWinChance(over)).toBeCloseTo(HOUSE_RTP, 6);
      expect(diceMultiplier(under) * diceWinChance(under)).toBeCloseTo(HOUSE_RTP, 6);
    }
  });

  it("same seed + nonce → same roll (determinism)", async () => {
    const a = await playDice(SERVER, CLIENT, 42, { target: 50, over: true });
    const b = await playDice(SERVER, CLIENT, 42, { target: 50, over: true });
    expect(a.roll).toEqual(b.roll);
    expect(a.win).toEqual(b.win);
  });

  it("different nonces diverge", async () => {
    const seen = new Set<number>();
    for (let n = 0; n < 20; n++) {
      const r = await playDice(SERVER, CLIENT, n, { target: 50, over: true });
      seen.add(r.roll);
    }
    // Should produce many distinct values across 20 nonces
    expect(seen.size).toBeGreaterThan(10);
  });

  it("RTP converges to 99% over many rolls", async () => {
    const N = 2000;
    let returned = 0;
    const stake = 1;
    const target = 50;
    const mult = diceMultiplier({ target, over: true });
    for (let n = 0; n < N; n++) {
      const r = await playDice(SERVER, CLIENT, n, { target, over: true });
      if (r.win) returned += stake * mult;
    }
    const rtp = returned / (N * stake);
    // Loose bound — 2000 rolls → ~3% std dev, expect within 6%
    expect(rtp).toBeGreaterThan(0.90);
    expect(rtp).toBeLessThan(1.08);
  });
});
