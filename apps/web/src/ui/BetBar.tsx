import { useState } from "react";
import { api } from "../net/api";
import { haptic, notify } from "../telegram/initWebApp";
import { useWalletStore } from "../state/walletStore";

const PRESETS = [0.1, 1, 5];
const NANO = 1_000_000_000n;

function tonToNano(ton: number): bigint {
  const [whole, frac = ""] = ton.toString().split(".");
  const fracPadded = (frac + "000000000").slice(0, 9);
  return BigInt(whole!) * NANO + BigInt(fracPadded || "0");
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
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const balance = useWalletStore((s) => s.balanceNano);

  const submit = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) {
      onError?.("invalid amount");
      return;
    }
    const nano = tonToNano(ton);
    if (nano > balance) {
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
          amountNano: nano.toString(),
          clientSeedHex: randomClientSeed(),
        }),
      });
      notify("success");
    } catch (err: any) {
      const msg = err?.message ?? "failed";
      notify("error");
      onError?.(msg.includes("phase_closed") ? "betting closed" : msg.includes("duplicate") ? "already in" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bet-bar">
      <input
        className="bet-input"
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount TON"
        min={0}
        step="0.1"
      />
      {PRESETS.map((p) => (
        <button key={p} className="bet-preset" type="button" onClick={() => setAmount(p.toString())}>
          {p}
        </button>
      ))}
      <button className="bet-join" disabled={disabled || busy} onClick={submit}>
        {busy ? "…" : "Join"}
      </button>
    </div>
  );
}
