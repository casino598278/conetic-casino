import { describe, it, expect } from "vitest";
import {
  playSwashBooze,
  swashBoozeMaxMultiplier,
  validateSwashBoozeParams,
  SWASH_GRID_W,
  SWASH_GRID_H,
  SWASH_FREE_SPINS,
  SWASH_MAX_MULTIPLIER,
} from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

describe("swash booze fairness", () => {
  it("validateSwashBoozeParams accepts spin + buy, rejects the rest", () => {
    expect(validateSwashBoozeParams({ mode: "spin" })).toBe(true);
    expect(validateSwashBoozeParams({ mode: "buy" })).toBe(true);
    expect(validateSwashBoozeParams({ mode: "nope" })).toBe(false);
    expect(validateSwashBoozeParams({})).toBe(false);
    expect(validateSwashBoozeParams(null)).toBe(false);
    expect(validateSwashBoozeParams("spin")).toBe(false);
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

  it("winning cells reference valid grid positions", async () => {
    for (let n = 0; n < 50; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      for (const step of r.baseSteps) {
        for (const cell of step.winningCells) {
          expect(cell.row).toBeGreaterThanOrEqual(0);
          expect(cell.row).toBeLessThan(SWASH_GRID_H);
          expect(cell.col).toBeGreaterThanOrEqual(0);
          expect(cell.col).toBeLessThan(SWASH_GRID_W);
        }
      }
    }
  });

  it("bonus buy: mode=buy always triggers free spins, skips base game", async () => {
    for (let n = 0; n < 20; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "buy" });
      expect(r.baseSteps.length).toBe(0);
      expect(r.freeSpins.triggered).toBe(true);
      expect(r.freeSpins.spins.length).toBe(SWASH_FREE_SPINS);
    }
  });

  it("cluster wins only pay at 8+ symbols", async () => {
    // Spot-check: wherever winSymbol is set, winCount must be >= 8.
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

  it("lollipop + bomb never appear as the winning symbol", async () => {
    for (let n = 0; n < 40; n++) {
      const r = await playSwashBooze(SERVER, CLIENT, n, { mode: "spin" });
      for (const step of r.baseSteps) {
        expect(step.winSymbol).not.toBe("lollipop");
        expect(step.winSymbol).not.toBe("bomb");
      }
    }
  });

  it("no single outcome exceeds the max-multiplier guard", async () => {
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

  // RTP convergence. Slot variance is brutal — a 21,100× max single win means
  // one lucky spin can spike RTP for thousands of iterations. With N=5000 we
  // use a very loose bound just to catch pathological drift (e.g. RTP=0 if a
  // typo kills all payouts, or RTP>>1 if max-cap is missing).
  it("RTP over 5000 base-game spins stays in the 0.4–2.0 band (anti-drift check)", async () => {
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
