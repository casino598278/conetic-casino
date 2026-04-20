import { useEffect, useRef, useState } from "react";
import {
  KENO_GRID,
  KENO_MAX_PICKS,
  KENO_DRAWS,
  kenoPaytable,
  type KenoRisk,
} from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { AutoPanel, type AutoBetResult } from "./AutoPanel";

const NANO = 1_000_000_000n;

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
function nanoToTonDisplay(nano: bigint): string {
  if (nano <= 0n) return "0";
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface PlayResult {
  ok: true;
  outcome: { draws: number[]; hits: number; win: boolean };
  multiplier: number;
  betNano: string;
  payoutNano: string;
  newBalanceNano: string;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
  onOpenFairness: () => void;
}

const RISKS: { key: KenoRisk; label: string }[] = [
  { key: "classic", label: "Classic" },
  { key: "low",     label: "Low"     },
  { key: "medium",  label: "Medium"  },
  { key: "high",    label: "High"    },
];

const REVEAL_STAGGER_MS = 100;

export function Keno({ onBack, onError, onOpenFairness }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [risk, setRisk] = useState<KenoRisk>("classic");
  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  /** Which cells have been revealed so far during the current animation. */
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  /** The draws from the latest round (empty before first bet). */
  const [lastDraws, setLastDraws] = useState<number[]>([]);
  const [lastHits, setLastHits] = useState<number | null>(null);
  const [lastMult, setLastMult] = useState<number | null>(null);
  const [lastPayoutNano, setLastPayoutNano] = useState<string | null>(null);

  const animTimers = useRef<number[]>([]);

  useEffect(() => () => { clearAnimTimers(); }, []);

  const clearAnimTimers = () => {
    for (const t of animTimers.current) clearTimeout(t);
    animTimers.current = [];
  };

  const togglePick = (cell: number) => {
    if (busy || rolling) return;
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(cell)) {
        next.delete(cell);
      } else if (next.size < KENO_MAX_PICKS) {
        next.add(cell);
      }
      return next;
    });
    // Clear prior round's visuals on any pick change.
    if (lastDraws.length > 0) {
      setLastDraws([]);
      setLastHits(null);
      setLastMult(null);
      setRevealed(new Set());
    }
  };

  const clearPicks = () => {
    if (busy || rolling) return;
    setPicks(new Set());
    setLastDraws([]);
    setLastHits(null);
    setLastMult(null);
    setRevealed(new Set());
  };

  const pickRandom = () => {
    if (busy || rolling) return;
    // Stake "Auto Pick" feature — fills up to 10 random unique cells.
    const target = picks.size === 0 ? 5 : picks.size;
    const next = new Set<number>();
    while (next.size < target) {
      next.add(Math.floor(Math.random() * KENO_GRID));
    }
    setPicks(next);
    setLastDraws([]);
    setLastHits(null);
    setLastMult(null);
    setRevealed(new Set());
  };

  const placeBet = async (nano: bigint): Promise<AutoBetResult> => {
    setBusy(true);
    haptic("light");
    try {
      const r: PlayResult = await api("/single/keno/play", {
        method: "POST",
        body: JSON.stringify({
          amountNano: nano.toString(),
          risk,
          picks: Array.from(picks),
        }),
      });
      setBalance(BigInt(r.newBalanceNano));
      animateReveal(r.outcome.draws, r.outcome.hits, r.multiplier, r.payoutNano);
      notify(r.outcome.win ? "success" : "warning");
      return {
        win: r.outcome.win,
        betNano: BigInt(r.betNano),
        payoutNano: BigInt(r.payoutNano),
      };
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    if (picks.size === 0) { onError?.("Pick at least one cell"); return; }
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
        case "invalid_params":       return "Invalid pick selection";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Bet failed (${err.code})`;
      }
    }
    return "Bet failed. Check your connection.";
  }

  const animateReveal = (draws: number[], hits: number, mult: number, payoutNano: string) => {
    clearAnimTimers();
    setRolling(true);
    setRevealed(new Set());
    setLastDraws(draws);
    setLastHits(null);
    setLastMult(null);
    for (let i = 0; i < draws.length; i++) {
      const t = window.setTimeout(() => {
        setRevealed((prev) => {
          const next = new Set(prev);
          next.add(draws[i]!);
          return next;
        });
        if (i === draws.length - 1) {
          // settle + show final result
          const done = window.setTimeout(() => {
            setLastHits(hits);
            setLastMult(mult);
            setLastPayoutNano(payoutNano);
            setRolling(false);
          }, 200);
          animTimers.current.push(done);
        }
      }, i * REVEAL_STAGGER_MS);
      animTimers.current.push(t);
    }
  };

  const paytable = kenoPaytable(risk, Math.max(1, picks.size));
  const picksArr = Array.from(picks);

  const setAmountNano = (nano: bigint) => {
    if (nano <= 0n) { setAmount("0"); return; }
    setAmount(nanoToTonDisplay(nano));
  };
  const half = () => setAmountNano(tonToNano(parseFloat(amount) || 0) / 2n);
  const double = () => {
    const doubled = tonToNano(parseFloat(amount) || 0) * 2n;
    setAmountNano(doubled > balance ? balance : doubled);
  };
  const maxBet = () => setAmountNano(balance);

  const betReady = !busy && !rolling && picks.size > 0 && (parseFloat(amount) || 0) > 0;

  // Computed per-cell state for the grid
  const cellState = (cell: number): {
    picked: boolean;
    drawn: boolean;
    hit: boolean;
    isRevealed: boolean;
  } => {
    const picked = picks.has(cell);
    const drawn = lastDraws.includes(cell);
    const isRevealed = revealed.has(cell);
    const hit = picked && drawn && isRevealed;
    return { picked, drawn, hit, isRevealed };
  };

  const profitTon = lastMult != null && lastMult > 0
    ? (parseFloat(amount) || 0) * (lastMult - 1)
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
        <div className="sg-title">Keno</div>
        <button className="sg-head-btn" onClick={onOpenFairness} type="button" aria-label="Fairness">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" />
          </svg>
          Fairness
        </button>
      </div>

      <div className="sg-stage keno-stage">
        <div className="keno-grid">
          {Array.from({ length: KENO_GRID }).map((_, cell) => {
            const { picked, drawn, hit, isRevealed } = cellState(cell);
            const cls = [
              "keno-cell",
              picked ? "is-picked" : "",
              isRevealed && drawn ? "is-drawn" : "",
              hit ? "is-hit" : "",
              !picked && isRevealed && drawn ? "is-miss" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={cell}
                type="button"
                className={cls}
                onClick={() => togglePick(cell)}
                disabled={busy || rolling}
              >
                {cell + 1}
              </button>
            );
          })}
        </div>

        <div className="keno-summary">
          <div className="keno-summary-item">
            <span className="keno-summary-lbl">Picks</span>
            <span className="keno-summary-val">{picks.size}/{KENO_MAX_PICKS}</span>
          </div>
          <div className="keno-summary-item">
            <span className="keno-summary-lbl">Hits</span>
            <span className="keno-summary-val">
              {lastHits != null ? `${lastHits}/${KENO_DRAWS}` : "—"}
            </span>
          </div>
          <div className="keno-summary-item">
            <span className="keno-summary-lbl">Payout</span>
            <span className={`keno-summary-val ${lastMult != null && lastMult > 0 ? "is-win" : ""}`}>
              {lastMult == null ? "—" : lastMult > 0 ? `${lastMult.toFixed(2)}×` : "0×"}
            </span>
          </div>
        </div>

        {lastMult != null && lastMult > 0 && lastPayoutNano && !rolling && (
          <div className="keno-won">
            +{fmtTon(BigInt(lastPayoutNano) - tonToNano(parseFloat(amount) || 0))}
            <span className="keno-won-mult">&nbsp;· {lastMult.toFixed(2)}×</span>
          </div>
        )}
      </div>

      {picks.size > 0 && (
        <div className="keno-paytable">
          {paytable.map((m, hits) => {
            // Hide zero-mult rows entirely — they're clutter. When the round
            // lands on a zero-mult hit count, the Hits + Payout summary still
            // reports it.
            if (m <= 0) return null;
            const active = lastHits === hits;
            return (
              <div key={hits} className={`keno-paytable-cell ${active ? "is-active" : ""}`}>
                <div className="keno-paytable-mult">{m.toFixed(2)}×</div>
                <div className="keno-paytable-hits">{hits} hit{hits === 1 ? "" : "s"}</div>
              </div>
            );
          })}
        </div>
      )}

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

        <div className="sg-field">
          <div className="sg-field-head"><span>Risk</span></div>
          <div className="keno-risk-tabs">
            {RISKS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`keno-risk-tab ${risk === r.key ? "is-active" : ""}`}
                onClick={() => {
                  setRisk(r.key);
                  // Changing risk invalidates the shown paytable highlights.
                  setLastDraws([]); setLastHits(null); setLastMult(null); setRevealed(new Set());
                }}
                disabled={busy || rolling}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="keno-pick-actions">
          <button
            type="button"
            className="sg-input-btn keno-pick-btn"
            onClick={pickRandom}
            disabled={busy || rolling}
          >
            Auto Pick
          </button>
          <button
            type="button"
            className="sg-input-btn keno-pick-btn"
            onClick={clearPicks}
            disabled={busy || rolling || picks.size === 0}
          >
            Clear
          </button>
          <span className="keno-pick-count">
            {picksArr.length} selected
          </span>
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
              {busy || rolling ? "Rolling…" : picks.size === 0 ? "Pick cells to bet" : "Bet"}
            </button>
          </>
        ) : (
          <AutoPanel
            balance={balance}
            settleDelayMs={REVEAL_STAGGER_MS * KENO_DRAWS + 400}
            initialAmount={amount}
            onAmountChange={setAmount}
            placeBet={placeBet}
            onError={(m) => onError?.(m)}
            locked={rolling || picks.size === 0}
          />
        )}
      </div>
    </div>
  );
}
