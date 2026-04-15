// Provably-fair commit/reveal. Pure functions — runs identically on server (Node)
// and in the browser (FairnessModal verifier). Uses Web Crypto SubtleCrypto for HMAC,
// available in both environments (Node >=20 has globalThis.crypto.subtle).

export interface RoundSeeds {
  serverSeedHex: string;          // 64 hex chars (32 bytes)
  clientSeedsHex: string[];        // each 32 hex chars (16 bytes); will be sorted
  roundId: number;                 // monotonic round number, used as nonce
}

export interface FairOutcome {
  /** raw 32-byte HMAC output (hex) — used as PRNG seed for trajectory */
  macHex: string;
  /** float in [0,1) derived from the first 8 bytes (informational / verification) */
  r: number;
}

const enc = new TextEncoder();

export function sha256Hex(input: string): Promise<string> {
  const bytes = enc.encode(input);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return crypto.subtle
    .digest("SHA-256", buf as ArrayBuffer)
    .then((b) => bufToHex(new Uint8Array(b)));
}

export async function hmacSha256(keyHex: string, message: string): Promise<Uint8Array> {
  const keyBytes = hexToBuf(keyHex);
  // Copy into a fresh ArrayBuffer to satisfy strict BufferSource typing in TS 5.6+.
  const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength);
  const msgBuf = enc.encode(message);
  const msgArrBuf = msgBuf.buffer.slice(msgBuf.byteOffset, msgBuf.byteOffset + msgBuf.byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, msgArrBuf as ArrayBuffer);
  return new Uint8Array(sig);
}

export function combineSeeds(clientSeedsHex: string[], roundId: number): string {
  const sorted = [...clientSeedsHex].sort();
  return `${sorted.join(":")}:${roundId}`;
}

export async function deriveOutcome(seeds: RoundSeeds): Promise<FairOutcome> {
  const message = combineSeeds(seeds.clientSeedsHex, seeds.roundId);
  const mac = await hmacSha256(seeds.serverSeedHex, message);
  const macHex = bufToHex(mac);
  // r from first 8 bytes (top 53 bits for double precision)
  let u64 = 0n;
  for (let i = 0; i < 8; i++) u64 = (u64 << 8n) | BigInt(mac[i]!);
  const r = Number(u64 >> 11n) / 2 ** 53;
  return { macHex, r };
}

export async function commitServerSeed(serverSeedHex: string): Promise<string> {
  return sha256Hex(serverSeedHex);
}

export async function verifyServerSeed(serverSeedHex: string, expectedHash: string): Promise<boolean> {
  const actual = await sha256Hex(serverSeedHex);
  return constantTimeEqual(actual, expectedHash);
}

// --- helpers ---

export function bufToHex(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += buf[i]!.toString(16).padStart(2, "0");
  return s;
}

export function hexToBuf(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
