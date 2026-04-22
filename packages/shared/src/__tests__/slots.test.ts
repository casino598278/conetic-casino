import { describe, it, expect } from "vitest";
import {
  playCosmicLines,
  cosmicMultiplier,
  validateCosmicParams,
  COSMIC_COLS,
  COSMIC_ROWS,
  playFruitStorm,
  fruitStormMultiplier,
  validateFruitStormParams,
  FS_COLS,
  FS_ROWS,
  playGemClusters,
  gemClustersMultiplier,
  validateGemClustersParams,
  GC_COLS,
  GC_ROWS,
  playLuckySevens,
  luckySevensMultiplier,
  validateLuckySevensParams,
  luckySevensJackpot,
  LS_COLS,
  LS_ROWS,
} from "../games/index.js";

const SERVER = "a".repeat(64);
const CLIENT = "b".repeat(32);

/** Tight-ish RTP bounds. N = 1500 keeps the test fast (<1s per slot) at the
 *  cost of wide tolerance — we just want to catch catastrophic math breaks
 *  (e.g. a broken paytable that returns 5× RTP). The true tuned RTPs are
 *  all in 0.90–1.05 range at larger N. */
const RTP_MIN = 0.5;
const RTP_MAX = 1.8;

describe("slots: shape + fairness", () => {
  it("cosmicLines produces a 5×3 grid and validates params", async () => {
    const r = await playCosmicLines(SERVER, CLIENT, 0, {});
    expect(r.baseSpin.grid.length).toBe(COSMIC_COLS);
    for (const col of r.baseSpin.grid) expect(col.length).toBe(COSMIC_ROWS);
    expect(validateCosmicParams({})).toBe(true);
    expect(validateCosmicParams({ lines: 10 })).toBe(true);
    expect(validateCosmicParams({ lines: 7 })).toBe(false);
    expect(validateCosmicParams(null)).toBe(false);
  });

  it("fruitStorm produces a 6×5 grid and validates params", async () => {
    const r = await playFruitStorm(SERVER, CLIENT, 0, {});
    expect(r.baseSpin.tumbleSteps.length).toBeGreaterThanOrEqual(1);
    const g = r.baseSpin.tumbleSteps[0]!.grid;
    expect(g.length).toBe(FS_COLS);
    for (const col of g) expect(col.length).toBe(FS_ROWS);
    expect(validateFruitStormParams({})).toBe(true);
    expect(validateFruitStormParams({ buy: true })).toBe(true);
    expect(validateFruitStormParams({ buy: "yes" })).toBe(false);
  });

  it("gemClusters produces a 7×7 grid and validates params", async () => {
    const r = await playGemClusters(SERVER, CLIENT, 0, {});
    expect(r.steps.length).toBeGreaterThanOrEqual(1);
    const g = r.steps[0]!.grid;
    expect(g.length).toBe(GC_COLS);
    for (const col of g) expect(col.length).toBe(GC_ROWS);
    expect(validateGemClustersParams({})).toBe(true);
    expect(validateGemClustersParams(null)).toBe(false);
  });

  it("luckySevens produces a 3×3 grid and validates params", async () => {
    const r = await playLuckySevens(SERVER, CLIENT, 0, {});
    const g = r.steps[0]!.grid;
    expect(g.length).toBe(LS_COLS);
    for (const col of g) expect(col.length).toBe(LS_ROWS);
    expect(validateLuckySevensParams({})).toBe(true);
    expect(validateLuckySevensParams(null)).toBe(false);
    expect(luckySevensJackpot()).toBeGreaterThan(0);
  });

  it("all four slots are deterministic (same seeds + nonce → identical outcome)", async () => {
    const a1 = await playCosmicLines(SERVER, CLIENT, 42, {});
    const a2 = await playCosmicLines(SERVER, CLIENT, 42, {});
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));

    const b1 = await playFruitStorm(SERVER, CLIENT, 42, {});
    const b2 = await playFruitStorm(SERVER, CLIENT, 42, {});
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));

    const c1 = await playGemClusters(SERVER, CLIENT, 42, {});
    const c2 = await playGemClusters(SERVER, CLIENT, 42, {});
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));

    const d1 = await playLuckySevens(SERVER, CLIENT, 42, {});
    const d2 = await playLuckySevens(SERVER, CLIENT, 42, {});
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });
});

// RTP samples are intentionally low (N=400–800) so the file runs in ~10s on CI.
// All four slots are HMAC-seeded, so results are deterministic — N just has to
// be large enough that the bands are stable, not large enough to converge to
// the true RTP. If the bounds here fail, a paytable or reel weight changed.
describe("slots: RTP stays in a sane range", () => {
  it("cosmicLines", async () => {
    const N = 800;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      paid += cosmicMultiplier(await playCosmicLines(SERVER, CLIENT, n, {}));
    }
    const rtp = paid / N;
    expect(rtp).toBeGreaterThan(RTP_MIN);
    expect(rtp).toBeLessThan(RTP_MAX);
  }, 20_000);

  it("fruitStorm", async () => {
    const N = 400;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      paid += fruitStormMultiplier(await playFruitStorm(SERVER, CLIENT, n, {}));
    }
    const rtp = paid / N;
    // FruitStorm has multiplier coins up to 25× and tumble chains — wide tail,
    // so the short-sample bounds are looser than for the other slots.
    expect(rtp).toBeGreaterThan(0.1);
    expect(rtp).toBeLessThan(5.0);
  }, 20_000);

  it("gemClusters", async () => {
    const N = 400;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      paid += gemClustersMultiplier(await playGemClusters(SERVER, CLIENT, n, {}));
    }
    const rtp = paid / N;
    expect(rtp).toBeGreaterThan(0.1);
    expect(rtp).toBeLessThan(RTP_MAX);
  }, 20_000);

  it("luckySevens", async () => {
    const N = 800;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      paid += luckySevensMultiplier(await playLuckySevens(SERVER, CLIENT, n, {}));
    }
    const rtp = paid / N;
    // 500× jackpot at 3-of-sevens ~ 0.6% chance per spin → wide variance.
    expect(rtp).toBeGreaterThan(RTP_MIN);
    expect(rtp).toBeLessThan(RTP_MAX);
  }, 20_000);
});
