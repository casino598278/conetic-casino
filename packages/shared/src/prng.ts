// Deterministic xoshiro256** PRNG. Identical output on server (Node) and client (browser).
// Seeded from a 32-byte buffer (e.g. HMAC-SHA256 output).

export class Xoshiro256ss {
  private s0: bigint;
  private s1: bigint;
  private s2: bigint;
  private s3: bigint;

  constructor(seed: Uint8Array) {
    if (seed.length < 32) {
      throw new Error("Xoshiro256ss requires at least 32 bytes of seed");
    }
    this.s0 = readU64BE(seed, 0);
    this.s1 = readU64BE(seed, 8);
    this.s2 = readU64BE(seed, 16);
    this.s3 = readU64BE(seed, 24);
    if (this.s0 === 0n && this.s1 === 0n && this.s2 === 0n && this.s3 === 0n) {
      this.s0 = 1n;
    }
  }

  nextU64(): bigint {
    const result = rotl(this.s1 * 5n & MASK64, 7n) * 9n & MASK64;
    const t = (this.s1 << 17n) & MASK64;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 45n);
    return result;
  }

  // Float in [0, 1)
  nextFloat(): number {
    // top 53 bits for double precision
    const v = this.nextU64() >> 11n;
    return Number(v) / 2 ** 53;
  }

  // Uniform float in [min, max)
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  // Integer in [0, n)
  nextInt(n: number): number {
    return Math.floor(this.nextFloat() * n);
  }
}

const MASK64 = (1n << 64n) - 1n;

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK64;
}

function readU64BE(buf: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(buf[offset + i]!);
  }
  return v;
}
