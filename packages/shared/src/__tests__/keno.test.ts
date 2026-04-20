import { describe, it, expect } from "vitest";
import {
  playKeno,
  kenoMultiplier,
  kenoMaxMultiplier,
  kenoPaytable,
  validateKenoParams,
  KENO_GRID,
  KENO_DRAWS,
  type KenoRisk,
} from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

describe("keno fairness", () => {
  it("draws are 10 distinct cells in [0, 39]", async () => {
    for (let n = 0; n < 20; n++) {
      const r = await playKeno(SERVER, CLIENT, n, { risk: "classic", picks: [0, 1, 2] });
      expect(r.draws.length).toBe(KENO_DRAWS);
      const set = new Set(r.draws);
      expect(set.size).toBe(KENO_DRAWS);
      for (const d of r.draws) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(KENO_GRID);
      }
    }
  });

  it("determinism: same seed + nonce → same draws", async () => {
    const a = await playKeno(SERVER, CLIENT, 7, { risk: "low", picks: [0, 5, 10] });
    const b = await playKeno(SERVER, CLIENT, 7, { risk: "low", picks: [0, 5, 10] });
    expect(a.draws).toEqual(b.draws);
    expect(a.hits).toEqual(b.hits);
  });

  it("hit count matches actual overlap", async () => {
    for (let n = 0; n < 20; n++) {
      const picks = [0, 10, 20, 30];
      const r = await playKeno(SERVER, CLIENT, n, { risk: "classic", picks });
      const expected = picks.filter((p) => r.draws.includes(p)).length;
      expect(r.hits).toBe(expected);
    }
  });

  it("validateKenoParams rejects dupes + out-of-range", () => {
    expect(validateKenoParams({ risk: "low", picks: [1, 1, 2] })).toBe(false);
    expect(validateKenoParams({ risk: "low", picks: [-1] })).toBe(false);
    expect(validateKenoParams({ risk: "low", picks: [40] })).toBe(false);
    expect(validateKenoParams({ risk: "low", picks: [] })).toBe(false);
    expect(validateKenoParams({ risk: "bogus", picks: [1] })).toBe(false);
    expect(validateKenoParams({ risk: "low", picks: [0] })).toBe(true);
    expect(validateKenoParams({ risk: "low", picks: Array.from({ length: 11 }, (_, i) => i) })).toBe(false);
  });

  it("paytable rows are length picks + 1", () => {
    for (const risk of ["low", "classic", "medium", "high"] as KenoRisk[]) {
      for (let picks = 1; picks <= 10; picks++) {
        const row = kenoPaytable(risk, picks);
        expect(row.length).toBe(picks + 1);
      }
    }
  });

  it("kenoMaxMultiplier matches max of the paytable row", () => {
    for (const risk of ["low", "classic", "medium", "high"] as KenoRisk[]) {
      for (let picks = 1; picks <= 10; picks++) {
        const row = kenoPaytable(risk, picks);
        const calc = Math.max(...row);
        expect(kenoMaxMultiplier(risk, picks)).toBe(calc);
      }
    }
  });

  it("kenoMultiplier returns 0 for invalid hit count", () => {
    expect(kenoMultiplier("low", 5, 20)).toBe(0);
  });

  // RTP convergence. We use "classic" 3-pick since its table is published
  // and hit distribution is fast to sample. At N=3000 we expect ~1.5% std
  // dev, loose bound of ±10% to keep the test non-flaky on CI.
  it("RTP converges toward ~99% over many rolls (classic, 3 picks)", async () => {
    const N = 3000;
    const risk: KenoRisk = "classic";
    const picks = [0, 1, 2];
    let paid = 0;
    for (let n = 0; n < N; n++) {
      const r = await playKeno(SERVER, CLIENT, n, { risk, picks });
      paid += kenoMultiplier(risk, picks.length, r.hits);
    }
    const rtp = paid / N;
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(1.15);
  });
});
