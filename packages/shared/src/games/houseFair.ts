// Shared fairness primitives for single-player house games.
// Stake-style: HMAC(serverSeed, `${clientSeed}:${nonce}:${round}`) → bytes → uniform float.
// The same function runs server-side and in the browser verifier.

import { hmacSha256, bufToHex } from "../fair.js";

export const HOUSE_EDGE = 0.01;         // 1% house edge → 99% RTP
export const HOUSE_RTP = 1 - HOUSE_EDGE;

/** Derive raw HMAC bytes for a play. `round` lets one play consume multiple draws. */
export async function houseHmac(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  round: number,
): Promise<Uint8Array> {
  return hmacSha256(serverSeedHex, `${clientSeedHex}:${nonce}:${round}`);
}

/** Convert 4 bytes at offset into a uniform float in [0, 1). */
export function bytesToUnitFloat(mac: Uint8Array, offset = 0): number {
  const b0 = mac[offset]!;
  const b1 = mac[offset + 1]!;
  const b2 = mac[offset + 2]!;
  const b3 = mac[offset + 3]!;
  const u32 = (b0 * 2 ** 24) + (b1 * 2 ** 16) + (b2 * 2 ** 8) + b3;
  return u32 / 2 ** 32;
}

/**
 * Uniform float in [0, 1) from a single HMAC draw.
 * Each (serverSeed, clientSeed, nonce, round) tuple yields a fixed value.
 */
export async function deriveFloat(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  round = 0,
): Promise<number> {
  const mac = await houseHmac(serverSeedHex, clientSeedHex, nonce, round);
  return bytesToUnitFloat(mac);
}

/**
 * Produce N independent uniform floats from a single nonce by consuming
 * successive HMAC outputs (round = 0, 1, 2, ...). Handy for games that need
 * multiple draws (keno, plinko).
 */
export async function deriveFloats(
  serverSeedHex: string,
  clientSeedHex: string,
  nonce: number,
  n: number,
): Promise<number[]> {
  const out: number[] = [];
  // Each HMAC gives 32 bytes = 8 floats. Batch for fewer hashes when n > 1.
  const macsNeeded = Math.ceil(n / 8);
  for (let r = 0; r < macsNeeded; r++) {
    const mac = await houseHmac(serverSeedHex, clientSeedHex, nonce, r);
    for (let i = 0; i < 8 && out.length < n; i++) {
      out.push(bytesToUnitFloat(mac, i * 4));
    }
  }
  return out;
}

export { bufToHex };
