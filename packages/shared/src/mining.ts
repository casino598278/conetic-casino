// Mining race: each player's "mine" produces gems on a deterministic schedule
// derived from server seed + per-player client seed. Both server and client run
// the same simulation from the trajectorySeedHex so the visualization is byte-identical.

import { Xoshiro256ss } from "./prng.js";
import { hexToBuf, hmacSha256, bufToHex } from "./fair.js";

export const MINING = {
  DURATION_MS: 15000,           // 15s mining phase
  TICK_MS: 100,                  // 100ms per gem tick
  // Each tick, find probability is weighted by stake fraction.
  // findProb = MIN_FIND + (MAX_FIND - MIN_FIND) * stakeFraction
  MIN_FIND_PROBABILITY: 0.15,   // smallest staker still finds something
  MAX_FIND_PROBABILITY: 0.85,   // dominant staker finds most ticks
  MAX_GEM_PER_FIND: 4,
  MIN_GEM_PER_FIND: 1,
} as const;

export interface MiningStep {
  /** Per-player gem counts at this point in time. Same length as players[]. */
  gems: number[];
  t: number; // ms since start
}

export interface MiningResult {
  steps: MiningStep[];
  finalGems: number[];
  /** Index of the winning player (or first of tied set). */
  winnerIndex: number;
  /** True if the winner ties with someone else. */
  tied: boolean;
  durationMs: number;
}

/**
 * Per-player PRNG seed = HMAC(serverSeed, clientSeed + playerIdx).
 * This way each player's gem schedule is independent and verifiable.
 */
export async function deriveMiningSeed(
  serverSeedHex: string,
  clientSeedHex: string,
  playerIndex: number,
): Promise<string> {
  const mac = await hmacSha256(serverSeedHex, `${clientSeedHex}:${playerIndex}`);
  return bufToHex(mac);
}

/**
 * Run the mining simulation. Each player's find probability per tick is
 * weighted by their stake fraction of the pot — bigger staker = mines faster.
 *
 * @param playerSeeds  Per-player PRNG seed (32-byte hex)
 * @param stakeFractions  Each player's stake / pot (0..1, must sum to ~1)
 */
export function simulateMining(playerSeeds: string[], stakeFractions?: number[]): MiningResult {
  const n = playerSeeds.length;
  // If stakeFractions not provided, default to equal weights (legacy behaviour).
  const fractions = stakeFractions ?? new Array(n).fill(1 / n);
  const rngs = playerSeeds.map((s) => new Xoshiro256ss(hexToBuf(s)));
  const gems = new Array(n).fill(0);
  const steps: MiningStep[] = [];
  const totalTicks = Math.floor(MINING.DURATION_MS / MINING.TICK_MS);

  // Per-player find probability based on stake fraction.
  // Linear blend: tiny stake → MIN_FIND, all-pot stake → MAX_FIND.
  const findProbs = fractions.map(
    (f) => MINING.MIN_FIND_PROBABILITY + (MINING.MAX_FIND_PROBABILITY - MINING.MIN_FIND_PROBABILITY) * f,
  );

  for (let t = 1; t <= totalTicks; t++) {
    for (let i = 0; i < n; i++) {
      if (rngs[i]!.nextFloat() < findProbs[i]!) {
        const found = MINING.MIN_GEM_PER_FIND + rngs[i]!.nextInt(MINING.MAX_GEM_PER_FIND - MINING.MIN_GEM_PER_FIND + 1);
        gems[i] += found;
      }
    }
    steps.push({ gems: [...gems], t: t * MINING.TICK_MS });
  }

  let winnerIndex = 0;
  let maxGems = gems[0]!;
  for (let i = 1; i < n; i++) {
    if (gems[i]! > maxGems) {
      maxGems = gems[i]!;
      winnerIndex = i;
    }
  }
  let tieCount = 0;
  for (let i = 0; i < n; i++) if (gems[i] === maxGems) tieCount++;

  return {
    steps,
    finalGems: gems,
    winnerIndex,
    tied: tieCount > 1,
    durationMs: totalTicks * MINING.TICK_MS,
  };
}
