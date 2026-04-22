import { useRef, useState } from "react";
import type { SlotVariant } from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { usePriceStore, usdToNano, nanoToUsd, fmtUsd } from "../../state/priceStore";
import { AutoPanel, type AutoBetResult } from "./AutoPanel";
import { SlotStage, type SlotEvent } from "./slots/SlotStage";

interface Props {
  variant: SlotVariant;
  onBack: () => void;
  onError?: (msg: string) => void;
  onOpenFairness: () => void;
}

/** Display config per variant — shape of the grid and human-readable title. */
const META: Record<SlotVariant, { title: string; cols: number; rows: number; sub: string }> = {
  cosmicLines: { title: "Cosmic Lines", cols: 5, rows: 3, sub: "10 paylines · free spins" },
  fruitStorm:  { title: "Fruit Storm",  cols: 6, rows: 5, sub: "Pay-anywhere · tumble · free spins" },
  gemClusters: { title: "Gem Clusters", cols: 7, rows: 7, sub: "Cluster pays · tumble" },
  luckySevens: { title: "Lucky Sevens", cols: 3, rows: 3, sub: "Classic 3-reel · hold & win" },
};

interface PlayResult {
  ok: true;
  variant: string;
  outcome: any;
  multiplier: number;
  betNano: string;
  payoutNano: string;
  newBalanceNano: string;
  nonce: number;
  playId: number;
}

export function Slots({ variant, onBack, onError, onOpenFairness }: Props) {
  const meta = META[variant];
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [outcome, setOutcome] = useState<any | null>(null);
  const [playToken, setPlayToken] = useState(0);
  const [lastResult, setLastResult] = useState<PlayResult | null>(null);
  const [badgeKey, setBadgeKey] = useState(0);
  // Resolves the pending placeBet() when SlotStage finishes its animation,
  // so AutoPanel's settleDelayMs doesn't have to guess the animation length.
  // We also stash the bet details in a ref because `onStageEvent` runs via
  // React-level closure; reading `lastResult` from state would give us the
  // previous spin's data on first play (state batching timing issue).
  const pendingSettleRef = useRef<((r: AutoBetResult) => void) | null>(null);
  const lastBetRef = useRef<{ win: boolean; betNano: bigint; payoutNano: bigint } | null>(null);

  const placeBet = async (nano: bigint): Promise<AutoBetResult> => {
    setBusy(true);
    haptic("light");
    try {
      const r: PlayResult = await api(`/single/slots/${variant}/play`, {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), params: {} }),
      });
      setBalance(BigInt(r.newBalanceNano));
      setLastResult(r);
      setOutcome(r.outcome);
      setPlayToken((t) => t + 1);
      setRolling(true);
      setBadgeKey((k) => k + 1);
      notify(r.multiplier > 0 ? "success" : "warning");
      const settled: AutoBetResult = {
        win: r.multiplier > 0,
        betNano: BigInt(r.betNano),
        payoutNano: BigInt(r.payoutNano),
      };
      lastBetRef.current = settled;
      // Wait for SlotStage's onComplete before resolving AutoPanel, so it
      // naturally paces itself to whatever the tumble chain takes.
      return await new Promise<AutoBetResult>((resolve) => {
        pendingSettleRef.current = resolve;
        // Fallback: if the stage never reports (e.g. the component unmounts),
        // resolve after a max timeout so autobet doesn't hang.
        setTimeout(() => {
          if (pendingSettleRef.current) {
            pendingSettleRef.current(settled);
            pendingSettleRef.current = null;
            setRolling(false);
          }
        }, 10_000);
      });
    } finally {
      setBusy(false);
    }
  };

  const usdPerTon = usePriceStore((s) => s.usdPerTon);

  const play = async () => {
    if (usdPerTon == null) { onError?.("Loading price…"); return; }
    const usd = parseFloat(amount);
    if (!Number.isFinite(usd) || usd <= 0) { onError?.("Enter a bet amount"); return; }
    const nano = usdToNano(usd, usdPerTon);
    if (nano <= 0n) { onError?.("Bet too small"); return; }
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
        case "invalid_params":       return "Invalid bet";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Bet failed (${err.code})`;
      }
    }
    return "Bet failed. Check your connection.";
  }

  const onStageEvent = (e: SlotEvent) => {
    switch (e.kind) {
      case "reel-land":
      case "tumble":
        haptic("light");
        break;
      case "win-pop":
        haptic(e.count >= 8 ? "heavy" : "medium");
        break;
      case "big-win":
        notify("success");
        break;
      case "done":
        setRolling(false);
        if (pendingSettleRef.current && lastBetRef.current) {
          pendingSettleRef.current(lastBetRef.current);
          pendingSettleRef.current = null;
        }
        break;
    }
  };

  const setAmountUsd = (usd: number) => {
    if (!Number.isFinite(usd) || usd <= 0) { setAmount("0"); return; }
    setAmount(usd.toFixed(2));
  };
  const half = () => setAmountUsd((parseFloat(amount) || 0) / 2);
  const doubleBet = () => {
    const doubled = (parseFloat(amount) || 0) * 2;
    const balUsd = usdPerTon != null ? Math.floor(nanoToUsd(balance, usdPerTon) * 100) / 100 : doubled;
    setAmountUsd(doubled > balUsd ? balUsd : doubled);
  };
  const maxBet = () => {
    if (usdPerTon == null) return;
    setAmountUsd(Math.floor(nanoToUsd(balance, usdPerTon) * 100) / 100);
  };

  const betReady = !busy && !rolling && (parseFloat(amount) || 0) > 0;
  const mult = lastResult?.multiplier ?? null;
  const won = mult != null && mult > 0;
  const profitUsd =
    won && lastResult && usdPerTon != null
      ? nanoToUsd(BigInt(lastResult.payoutNano) - usdToNano(parseFloat(amount) || 0, usdPerTon), usdPerTon)
      : 0;

  return (
    <div className="sg-screen">
      <div className="sg-head">
        <button className="stake-game-back" onClick={onBack} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="sg-title">{meta.title}</div>
        <button className="sg-head-btn" onClick={onOpenFairness} type="button" aria-label="Fairness">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" />
          </svg>
          Fairness
        </button>
      </div>

      <div className={`sg-stage slots-stage slots-theme-${variant}`}>
        <div className="slots-hud">
          <div className="slots-hud-pill">
            <span className="slots-hud-lbl">Bet</span>
            <span className="slots-hud-val">
              {usdPerTon != null ? fmtUsd(parseFloat(amount) || 0) : "—"}
            </span>
          </div>
          <div className="slots-hud-pill">
            <span className="slots-hud-lbl">Win</span>
            <span className={`slots-hud-val ${won ? "is-win" : ""}`}>
              {won && mult != null && usdPerTon != null
                ? fmtUsd(profitUsd)
                : mult != null && !won
                  ? "—"
                  : "—"}
            </span>
          </div>
          <div className="slots-hud-pill">
            <span className="slots-hud-lbl">Balance</span>
            <span className="slots-hud-val">
              {usdPerTon != null ? fmtUsd(nanoToUsd(balance, usdPerTon)) : "—"}
            </span>
          </div>
        </div>

        <div className="slots-meta">
          <span className="slots-sub">{meta.sub}</span>
        </div>

        <div className="slots-canvas-wrap">
          <SlotStage
            variant={variant}
            cols={meta.cols}
            rows={meta.rows}
            outcome={outcome}
            playToken={playToken}
            onComplete={() => { /* handled via onEvent 'done' */ }}
            onEvent={onStageEvent}
          />
          {won && mult != null && !rolling && (
            <div key={badgeKey} className="slots-win-badge" role="status">
              <div className="slots-win-badge-mult">{mult.toFixed(2)}×</div>
              <div className="slots-win-badge-profit">
                {usdPerTon != null ? `+${fmtUsd(profitUsd)}` : "Win!"}
              </div>
            </div>
          )}
        </div>
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

        {mode === "manual" ? (
          <>
            <div className="sg-field">
              <div className="sg-field-head"><span>Bet amount</span></div>
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
                <button className="sg-input-btn" onClick={doubleBet} type="button">2×</button>
                <button className="sg-input-btn" onClick={maxBet} type="button">Max</button>
              </div>
            </div>

            <button className="sg-cta" onClick={play} disabled={!betReady} type="button">
              {busy || rolling ? "Spinning…" : "Spin"}
            </button>
          </>
        ) : (
          <AutoPanel
            balance={balance}
            // Stage drives its own pacing via onEvent("done"); settleDelay
            // here is just a small gap after that before the next bet fires.
            settleDelayMs={300}
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
