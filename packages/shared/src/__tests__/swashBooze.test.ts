import { describe, it, expect } from "vitest";
import {
  playSwashBooze,
  swashBoozeMaxMultiplier,
  swashBoozeStakeMultiplier,
  validateSwashBoozeParams,
  SWASH_GRID_W,
  SWASH_GRID_H,
  SWASH_FREE_SPINS,
  SWASH_MAX_MULTIPLIER,
  SWASH_ANTE_MULTIPLIER,
  SWASH_BONUS_BUY_COST,
} from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

describe("swash booze fairness", () => {
  it("validateSwashBoozeParams accepts spin + buy with optional ante, rejects invalid combos", () => {
    expect(validateSwashBoozeParams({ mode: "spin" })).toBe(true);
    expect(validateSwashBoozeParams({ mode: "buy" })).toBe(true);
    expect(validateSwashBoozeParams({ mode: "spin", ante: true })).toBe(true);
    expect(validateSwashBoozeParams({ mode: "spin", ante: false })).toBe(true);
    // Ante + Buy is mutually exclusive
    expect(validateSwashBoozeParams({ mode: "buy", ante: true })).toBe(false);
    // Garbage
    expect(validateSwashBoozeParams({ mode: "nope" })).toBe(false);
    expect(validateSwashBoozeParams({})).toBe(false);
    expect(validateSwashBoozeParams(null)).toBe(false);
    expect(validateSwashBoozeParams("spin")).toBe(false);
  });

  it("stake multiplier: spin=1, ante=1.25, buy=100", () => {
    expect(swashBoozeStakeMultiplier({ mode: "spin" })).toBe(1);
    expect(swashBoozeStakeMultiplier({ mode: "spin", ante: true })).toBe(SWASH_ANTE_MULTIPLIER);
    expect(swashBoozeStakeMultiplier({ mode: "buy" })).toBe(SWASH_BONUS_BUY_COST);
  });

  it("determinism: same seed + nonce → identical outcome", async () => {
    const a = await playSwashBooze(SERVER, CLIENT, 7, { mode: "spin" });
    const b = await playSwashBooze(SERVER, CLIENT, 7, { mode: "spin" });
    expect(a.multiplier).toEqual(b.multiplier);
    expect(a.baseSteps.length).toEqual(b.baseSteps.length);
    expect(a.freeSpins.triggered).toEqual(b.freeSpins.triggered);
  });

  it("every step emits a 6x5 grid", async () => {
    const r = await playSwashBooze(SERVER, CLIENT, 3, { mode: "spin" });
    for (const step of r.baseSteps) {
      expect(step.grid.length).toBe(SWASH_GRID_H);
      for (const row of step.grid) {
        expect(row.length).toBe(SWASH_GRID_W);
      }
    }
  });

  it("bombs appear only in free spins, never in base game", async () => {
    for (let n = 0; n < 200; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      for (const step of r.baseSteps) {
        expect(step.bombs.length).toBe(0);
        for (const row of step.grid) {
          for (const sym of row) {
            expect(sym).not.toBe("bomb");
          }
        }
      }
    }
  });

  it("bonus buy: mode=buy always triggers free spins, skips base game", async () => {
    for (let n = 0; n < 20; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "buy" });
      expect(r.baseSteps.length).toBe(0);
      expect(r.freeSpins.triggered).toBe(true);
      expect(r.freeSpins.spins.length).toBeGreaterThanOrEqual(SWASH_FREE_SPINS);
    }
  });

  it("scatter direct payout: 4=3x, 5=5x, 6+=100x baked into baseScatterMult", async () => {
    // Spot-check across nonces — whenever baseScatters >= 4, baseScatterMult is set.
    for (let n = 0; n < 500; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      if (r.baseScatters >= 6) expect(r.baseScatterMult).toBe(100);
      else if (r.baseScatters === 5) expect(r.baseScatterMult).toBe(5);
      else if (r.baseScatters === 4) expect(r.baseScatterMult).toBe(3);
      else expect(r.baseScatterMult).toBe(0);
    }
  });

  it("cluster wins only pay at 8+ symbols", async () => {
    for (let n = 0; n < 30; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      for (const step of r.baseSteps) {
        if (step.winSymbol != null) {
          expect(step.winCount).toBeGreaterThanOrEqual(8);
        } else {
          expect(step.winCount).toBe(0);
        }
      }
    }
  });

  it("lollipop + bomb never appear as cluster-paying symbols", async () => {
    for (let n = 0; n < 40; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      for (const step of r.baseSteps) {
        expect(step.winSymbol).not.toBe("lollipop");
        expect(step.winSymbol).not.toBe("bomb");
      }
      for (const fsSpin of r.freeSpins.spins) {
        for (const step of fsSpin.steps) {
          expect(step.winSymbol).not.toBe("lollipop");
          expect(step.winSymbol).not.toBe("bomb");
        }
      }
    }
  });

  it("free-spins multipliers do NOT persist across spins", async () => {
    // Walk many bonus-buy rounds. Verify each spin's spinMultTotal equals the
    // sum of bomb values that landed *within that spin's own steps*, never
    // carrying bombs from earlier spins.
    for (let n = 0; n < 50; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, 1000 + n, { mode: "buy" });
      for (const spin of r.freeSpins.spins) {
        const thisSpinBombSum = spin.steps.reduce(
          (s, step) => s + step.bombs.reduce((ss, b) => ss + b.value, 0),
          0,
        );
        const expected = thisSpinBombSum > 0 ? thisSpinBombSum : 1;
        expect(spin.spinMultTotal).toBe(expected);
      }
    }
  });

  it("no outcome exceeds SWASH_MAX_MULTIPLIER", async () => {
    for (let n = 0; n < 200; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      expect(r.multiplier).toBeLessThanOrEqual(SWASH_MAX_MULTIPLIER);
    }
    for (let n = 0; n < 100; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "buy" });
      expect(r.multiplier).toBeLessThanOrEqual(SWASH_MAX_MULTIPLIER);
    }
    expect(swashBoozeMaxMultiplier("spin")).toBe(SWASH_MAX_MULTIPLIER);
    expect(swashBoozeMaxMultiplier("buy")).toBe(SWASH_MAX_MULTIPLIER);
  });

  it("all bomb values in FS are 2..100 (matches Sweet Bonanza spec)", async () => {
    for (let n = 0; n < 100; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, 2000 + n, { mode: "buy" });
      for (const spin of r.freeSpins.spins) {
        for (const step of spin.steps) {
          for (const bomb of step.bombs) {
            expect(bomb.value).toBeGreaterThanOrEqual(2);
            expect(bomb.value).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it("RTP over 5000 base-game spins stays in the 0.4–2.0 anti-drift band", async () => {
    const N = 5000;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, 10_000 + n, { mode: "spin" });
      paid += r.multiplier;
    }
    const rtp = paid / N;
    expect(rtp).toBeGreaterThan(0.4);
    expect(rtp).toBeLessThan(2.0);
  }, 60_000);
});
