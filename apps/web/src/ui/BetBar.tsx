import { useState } from "react";
import { api } from "../net/api";
import { haptic, notify } from "../telegram/initWebApp";
import { useWalletStore } from "../state/walletStore";

const PRESETS = [0.1, 1, 5, 10, 100];
const NANO = 1_000_000_000n;

function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

function randomClientSeed(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Props {
  disabled?: boolean;
  onError?: (msg: string) => void;
}

export function BetBar({ disabled, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const balance = useWalletStore((s) => s.balanceNano);

  const stake = async (amountNano: bigint) => {
    if (disabled || busy) return;
    if (amountNano <= 0n) {
      onError?.("invalid amount");
      return;
    }
    if (amountNano > balance) {
      onError?.("insufficient balance");
      notify("error");
      return;
    }
    setBusy(true);
    haptic("medium");
    try {
      await api("/bet", {
        method: "POST",
        body: JSON.stringify({
          amountNano: amountNano.toString(),
          clientSeedHex: randomClientSeed(),
        }),
      });
      notify("success");
    } catch (err: any) {
      const msg: string = err?.message ?? "failed";
      notify("error");
      if (msg.includes("phase_closed")) onError?.("betting closed");
      else if (msg.includes("insufficient")) onError?.("insufficient balance");
      else if (msg.includes("above_max")) onError?.("over max bet");
      else if (msg.includes("below_min")) onError?.("under min bet");
      else onError?.(msg.slice(0, 60));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bet-bar">
      {PRESETS.map((p) => {
        const nano = tonToNano(p);
        const tooPoor = nano > balance;
        return (
          <button
            key={p}
            className="bet-preset"
            type="button"
            disabled={disabled || busy || tooPoor}
            onClick={() => stake(nano)}
          >
            {p < 1 ? p : Number.isInteger(p) ? p : p.toFixed(1)}
          </button>
        );
      })}
      <button
        className="bet-allin"
        type="button"
        disabled={disabled || busy || balance <= 0n}
        onClick={() => stake(balance)}
        title={`All-in: ${fmtTon(balance)} TON`}
      >
        All-in
      </button>
    </div>
  );
}
