import { create } from "zustand";

const NANO = 1_000_000_000n;

interface PriceState {
  /** USD value of 1 TON. `null` until the first /api/price response. */
  usdPerTon: number | null;
  /** True if the server is serving a stale fallback. */
  stale: boolean;
  set: (usdPerTon: number, stale: boolean) => void;
}

export const usePriceStore = create<PriceState>((set) => ({
  usdPerTon: null,
  stale: false,
  set: (usdPerTon, stale) => set({ usdPerTon, stale }),
}));

/** Convert a bigint amount of nano-TON → USD (number). */
export function nanoToUsd(nano: bigint, usdPerTon: number): number {
  // Keep precision by going through string concat then a single float multiply.
  const tonWhole = Number(nano / NANO);
  const tonFrac = Number(nano % NANO) / 1_000_000_000;
  return (tonWhole + tonFrac) * usdPerTon;
}

/** Convert a USD number → nano-TON bigint. Rounds down. */
export function usdToNano(usd: number, usdPerTon: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || usdPerTon <= 0) return 0n;
  const ton = usd / usdPerTon;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

/** Format a USD number with 2 decimals and thousands separators. */
export function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  const sign = usd < 0 ? "−" : "";
  const abs = Math.abs(usd);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Convenience: format a nano bigint directly as USD. */
export function fmtNanoUsd(nano: bigint, usdPerTon: number | null): string {
  if (usdPerTon == null) return "—";
  return fmtUsd(nanoToUsd(nano, usdPerTon));
}
