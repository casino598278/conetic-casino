import { useEffect, useRef, useState } from "react";
import {
  LIMBO_MIN_TARGET,
  LIMBO_MAX_TARGET,
  limboMultiplier,
  limboWinChance,
} from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { AutoPanel, type AutoBetResult } from "./AutoPanel";

const NANO = 1_000_000_000n;
const HISTORY_MAX = 10;

function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}
function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

interface PlayResult {
  ok: true;
  outcome: { result: number; win: boolean };
  multiplier: number;
  winChance: number;
  payoutNano: string;
  newBalanceNano: string;
}

interface HistoryItem {
  result: number;
  win: boolean;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
  onOpenFairness: () => void;
}

export function Limbo({ onBack, onError, onOpenFairness }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [target, setTarget] = useState(2);
  const [targetStr, setTargetStr] = useState("2.00");
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(1.0);
  const [settled, setSettled] = useState<{ result: number; win: boolean } | null>(null);
  const [lastPayout, setLastPayout] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const animRef = useRef<number | null>(null);

  const chance = limboWinChance({ target });
  const mult = limboMultiplier({ target });
  const profitTon = (parseFloat(amount) || 0) * (mult - 1);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // Keep target (number) in sync when user types.
  const onTargetChange = (v: string) => {
    setTargetStr(v);
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= LIMBO_MIN_TARGET && n <= LIMBO_MAX_TARGET) {
      setTarget(n);
    }
  };
  const onTargetBlur = () => {
    const n = Math.max(LIMBO_MIN_TARGET, Math.min(LIMBO_MAX_TARGET, parseFloat(targetStr) || LIMBO_MIN_TARGET));
    setTarget(n);
    setTargetStr(n.toFixed(2));
  };

  // Hits the server, triggers the count-up animation, updates balance.
  // Resolves as soon as the server responds — the caller can start waiting
  // for the animation to finish via the `rolling` flag or a fixed settle
  // delay. Used by both the Manual Bet button and the Auto loop.
  const placeBet = async (nano: bigint): Promise<AutoBetResult> => {
    setBusy(true);
    setSettled(null);
    setLastPayout(null);
    haptic("light");
    try {
      const r: PlayResult = await api("/single/limbo/play", {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), target }),
      });
      animate(r.outcome.result, r.outcome.win, r.payoutNano);
      setBalance(BigInt(r.newBalanceNano));
      // Flip out of the API-waiting state as soon as the response lands;
      // `rolling` remains true while the count-up plays.
      setBusy(false);
      // AutoPanel needs betNano; we don't get it back from Limbo's response,
      // so reconstruct from the input (server echoes it anyway).
      return {
        win: r.outcome.win,
        betNano: nano,
        payoutNano: BigInt(r.payoutNano),
      };
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  const play = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) { onError?.("Enter a bet amount"); return; }
    const nano = tonToNano(ton);
    if (nano > balance) { onError?.("Insufficient balance"); notify("error"); return; }
    if (busy || rolling) return;
    try {
      await placeBet(nano);
    } catch (err: unknown) {
      notify("error");
      onError?.(humanizeBetError(err));
    }
  };

  function humanizeBetError(err: unknown): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "rate_limited":         return "Slow down — wait a moment";
        case "below_min":            return "Bet is below the minimum";
        case "above_max":            return "Bet is above the maximum";
        case "max_win_exceeded":     return "Target too high for this bet";
        case "daily_limit":          return "Daily win limit reached";
        case "invalid_params":       return "Invalid target multiplier";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Bet failed (${err.code})`;
      }
    }
    return "Bet failed. Check your connection.";
  }

  const animate = (finalResult: number, finalWin: boolean, payout: string) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const DUR = Math.min(1000, 420 + Math.log10(Math.max(1, finalResult)) * 180);
    const start = performance.now();
    const startVal = 1;
    setRolling(true);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = startVal + (finalResult - startVal) * eased;
      setDisplay(v);
      if (p < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(finalResult);
        setSettled({ result: finalResult, win: finalWin });
        setLastPayout(payout);
        setRolling(false);
        setHistory((prev) => [{ result: finalResult, win: finalWin }, ...prev].slice(0, HISTORY_MAX));
        notify(finalWin ? "success" : "warning");
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  const setAmountNano = (nano: bigint) => {
    if (nano <= 0n) { setAmount("0"); return; }
    const w = nano / NANO;
    const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
    setAmount(f ? `${w}.${f}` : `${w}`);
  };
  const half = () => setAmountNano(tonToNano(parseFloat(amount) || 0) / 2n);
  const double = () => {
    const doubled = tonToNano(parseFloat(amount) || 0) * 2n;
    setAmountNano(doubled > balance ? balance : doubled);
  };
  const maxBet = () => setAmountNano(balance);

  const displayMultStr =
    display >= 100 ? display.toFixed(2)
    : display >= 10 ? display.toFixed(2)
    : display.toFixed(2);

  const winClass = (busy || rolling) ? "" : settled?.win === true ? "is-win" : settled?.win === false ? "is-loss" : "";
  const subClass = (busy || rolling) ? "" : winClass;

  const subText = (busy || rolling)
    ? "Rolling…"
    : settled?.win && lastPayout
      ? `+${fmtTon(BigInt(lastPayout) - tonToNano(parseFloat(amount) || 0))}`
      : settled?.win === false
        ? "Loss"
        : "Place a bet";

  const betReady = !busy && !rolling && (parseFloat(amount) || 0) > 0;

  return (
    <div className="sg-screen">
      <div className="sg-head">
        <button className="stake-game-back" onClick={onBack} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="sg-title">Limbo</div>
        <button className="sg-head-btn" onClick={onOpenFairness} type="button" aria-label="Fairness">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" />
          </svg>
          Fairness
        </button>
      </div>

      <div className="sg-stage limbo-stage">
        <div className={`limbo-mult ${winClass}`}>
          {displayMultStr}
          <span className="limbo-mult-suffix">×</span>
        </div>
        <div className={`limbo-sub ${subClass}`}>{subText}</div>
        {history.length > 0 && (
          <div className="limbo-history">
            {history.map((h, i) => (
              <span key={i} className={`limbo-chip ${h.win ? "is-win" : "is-loss"}`}>
                {h.result.toFixed(2)}×
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sg-panel">
        <div className="sg-mode">
          <button
            type="button"
            className={`sg-mode-btn ${mode === "manual" ? "is-active" : ""}`}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
          <button
            type="button"
            className={`sg-mode-btn ${mode === "auto" ? "is-active" : ""}`}
            onClick={() => setMode("auto")}
          >
            Auto
          </button>
        </div>

        <div className="sg-two-col">
          <div className="sg-field">
            <div className="sg-field-head">
              <span>Target multiplier</span>
            </div>
            <div className="sg-input-row">
              <input
                className="sg-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={LIMBO_MIN_TARGET}
                max={LIMBO_MAX_TARGET}
                value={targetStr}
                onChange={(e) => onTargetChange(e.target.value)}
                onBlur={onTargetBlur}
              />
            </div>
          </div>
          <div className="sg-field">
            <div className="sg-field-head">
              <span>Win chance</span>
            </div>
            <div className="sg-input-row">
              <input
                className="sg-input"
                value={`${(chance * 100).toFixed(2).replace(/\.?0+$/, "")}%`}
                disabled
                readOnly
              />
            </div>
          </div>
        </div>

        {mode === "manual" ? (
          <>
            <div className="sg-field">
              <div className="sg-field-head">
                <span>Bet amount</span>
                <span className="sg-field-head-val">
                  Profit&nbsp;{profitTon > 0 ? profitTon.toFixed(2).replace(/\.?0+$/, "") : "0"}
                </span>
              </div>
              <div className="sg-input-row">
                <input
                  className="sg-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button className="sg-input-btn" onClick={half} type="button">½</button>
                <button className="sg-input-btn" onClick={double} type="button">2×</button>
                <button className="sg-input-btn" onClick={maxBet} type="button">Max</button>
              </div>
            </div>

            <button className="sg-cta" onClick={play} disabled={!betReady} type="button">
              {busy || rolling ? "Rolling…" : "Bet"}
            </button>
          </>
        ) : (
          <AutoPanel
            balance={balance}
            settleDelayMs={900}
            initialAmount={amount}
            onAmountChange={setAmount}
            placeBet={placeBet}
            onError={(m) => onError?.(m)}
            locked={rolling}
          />
        )}
      </div>
    </div>
  );
}
