import { useState } from "react";
import { api, ApiError } from "../net/api";
import { haptic, notify } from "../telegram/initWebApp";
import { useWalletStore } from "../state/walletStore";

const PRESETS = [1, 5, 10, 100];
const NANO = 1_000_000_000n;

function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [customAmt, setCustomAmt] = useState("");
  const balance = useWalletStore((s) => s.balanceNano);

  const stake = async (amountNano: bigint) => {
    if (disabled || busy) return;
    if (amountNano <= 0n) { onError?.("Enter a bet amount"); return; }
    if (amountNano > balance) { onError?.("Insufficient balance"); notify("error"); return; }
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
    } catch (err: unknown) {
      notify("error");
      if (err instanceof ApiError) {
        switch (err.code) {
          case "insufficient_balance": onError?.("Insufficient balance"); break;
          case "phase_closed":         onError?.("Betting is closed"); break;
          case "above_max":            onError?.("Bet is above the maximum"); break;
          case "below_min":            onError?.("Bet is below the minimum"); break;
          case "rate_limited":         onError?.("Slow down — wait a moment"); break;
          case "http_502":
          case "http_503":             onError?.("Server is restarting — try again"); break;
          default:                     onError?.(`Bet failed (${err.code})`);
        }
      } else {
        onError?.("Bet failed. Check your connection.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCustom = async () => {
    const ton = parseFloat(customAmt);
    if (!Number.isFinite(ton) || ton <= 0) {
      onError?.("invalid amount");
      return;
    }
    await stake(tonToNano(ton));
    setEditorOpen(false);
    setCustomAmt("");
  };

  return (
    <>
      <div className="bet-bar">
        <button
          className="bet-preset bet-edit"
          type="button"
          disabled={disabled || busy}
          onClick={() => setEditorOpen(true)}
          title="Custom amount"
          aria-label="Custom amount"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
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
              {p}
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

      {editorOpen && (
        <div className="modal-bg" onClick={() => setEditorOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Custom bet</h3>
            <div style={{ color: "var(--t3)", fontSize: 12, marginBottom: 8 }}>
              Balance: {fmtTon(balance)} TON
            </div>
            <input
              autoFocus
              className="bet-input"
              style={{ width: "100%", marginBottom: 10 }}
              type="number"
              inputMode="decimal"
              placeholder="Amount in TON"
              value={customAmt}
              onChange={(e) => setCustomAmt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCustom();
              }}
              min={0}
              step="0.1"
            />
            <button className="primary" type="button" onClick={submitCustom} disabled={busy}>
              {busy ? "Placing…" : "Stake"}
            </button>
            <button
              className="bet-preset"
              type="button"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
