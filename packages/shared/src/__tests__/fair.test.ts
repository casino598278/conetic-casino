import { describe, it, expect } from "vitest";
import { commitServerSeed, deriveOutcome, verifyServerSeed } from "../fair.js";

describe("fair", () => {
  it("commit then verify", async () => {
    const seed = "a".repeat(64);
    const hash = await commitServerSeed(seed);
    expect(hash).toHaveLength(64);
    expect(await verifyServerSeed(seed, hash)).toBe(true);
    expect(await verifyServerSeed("b".repeat(64), hash)).toBe(false);
  });

  it("deriveOutcome is deterministic and order-independent in clientSeeds", async () => {
    const serverSeed = "11" + "00".repeat(31);
    const a = await deriveOutcome({
      serverSeedHex: serverSeed,
      clientSeedsHex: ["aa".repeat(16), "bb".repeat(16), "cc".repeat(16)],
      roundId: 42,
    });
    const b = await deriveOutcome({
      serverSeedHex: serverSeed,
      clientSeedsHex: ["cc".repeat(16), "aa".repeat(16), "bb".repeat(16)],
      roundId: 42,
    });
    expect(a.macHex).toEqual(b.macHex);
    expect(a.r).toEqual(b.r);
    expect(a.macHex).toHaveLength(64);
    expect(a.r).toBeGreaterThanOrEqual(0);
    expect(a.r).toBeLessThan(1);
  });

  it("different roundId → different outcome", async () => {
    const args = {
      serverSeedHex: "22" + "00".repeat(31),
      clientSeedsHex: ["dd".repeat(16)],
    };
    const a = await deriveOutcome({ ...args, roundId: 1 });
    const b = await deriveOutcome({ ...args, roundId: 2 });
    expect(a.macHex).not.toEqual(b.macHex);
  });
});
