// Mining race: each player's "mine" produces gems on a deterministic schedule
// derived from server seed + per-player client seed. Both server and client run
// the same simulation from the trajectorySeedHex so the visualization is byte-identical.

import { Xoshiro256ss } from "./prng.js";
import { hexToBuf, hmacSha256, bufToHex } from "./fair.js";

export const MINING = {
  DURATION_MS: 15000,           // 15s mining phase
  TICK_MS: 100,                  // 100ms per gem tick
  // Each tick, each player has a small chance to find gems (1-3 gems per find).
  BASE_FIND_PROBABILITY: 0.55,   // probability per tick
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
 * Run the mining simulation for all players. Each player's PRNG decides
 * if they find gems on each tick, and how many.
 */
export function simulateMining(playerSeeds: string[]): MiningResult {
  const n = playerSeeds.length;
  const rngs = playerSeeds.map((s) => new Xoshiro256ss(hexToBuf(s)));
  const gems = new Array(n).fill(0);
  const steps: MiningStep[] = [];
  const totalTicks = Math.floor(MINING.DURATION_MS / MINING.TICK_MS);

  for (let t = 1; t <= totalTicks; t++) {
    for (let i = 0; i < n; i++) {
      if (rngs[i]!.nextFloat() < MINING.BASE_FIND_PROBABILITY) {
        const found = MINING.MIN_GEM_PER_FIND + rngs[i]!.nextInt(MINING.MAX_GEM_PER_FIND - MINING.MIN_GEM_PER_FIND + 1);
        gems[i] += found;
      }
    }
    steps.push({ gems: [...gems], t: t * MINING.TICK_MS });
  }

  // Find winner
  let winnerIndex = 0;
  let maxGems = gems[0]!;
  for (let i = 1; i < n; i++) {
    if (gems[i]! > maxGems) {
      maxGems = gems[i]!;
      winnerIndex = i;
    }
  }
  // Check for tie
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
