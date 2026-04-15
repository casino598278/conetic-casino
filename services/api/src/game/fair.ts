import { randomBytes, createHash } from "node:crypto";

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function generateClientSeed(): string {
  return randomBytes(16).toString("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
