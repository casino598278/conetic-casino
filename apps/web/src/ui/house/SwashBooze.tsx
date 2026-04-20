import { useEffect, useMemo, useRef, useState } from "react";
import {
  SWASH_GRID_H,
  SWASH_GRID_W,
  SWASH_FREE_SPINS,
  SWASH_BONUS_BUY_COST,
  type SwashSymbol,
  type SwashSpinStep,
  type SwashOutcome,
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

// ──────────────────────────── symbol art ────────────────────────────

/** Inline SVG for each symbol. Size-agnostic, fills the cell. */
function SymbolIcon({ s }: { s: SwashSymbol }) {
  switch (s) {
    case "red":    return <CandyChip fill="#ff5b7a" shape="heart" />;
    case "purple": return <CandyChip fill="#b066ff" shape="squircle" />;
    case "green":  return <CandyChip fill="#5fd88c" shape="triangle" />;
    case "blue":   return <CandyChip fill="#4cb8ff" shape="diamond" />;
    case "plum":   return <FruitIcon fill="#9d5bff" highlight="#c99aff" />;
    case "apple":  return <FruitIcon fill="#5fd88c" highlight="#b5f0c9" />;
    case "watermelon": return <FruitIcon fill="#ff5b7a" highlight="#5fd88c" />;
    case "grape":  return <FruitIcon fill="#7a3fd9" highlight="#b58bff" dots />;
    case "banana": return <FruitIcon fill="#f1c94a" highlight="#ffe58c" />;
    case "lollipop": return <ScatterIcon />;
    case "bomb":   return <BombIcon />;
  }
}

function CandyChip({ fill, shape }: { fill: string; shape: "heart" | "squircle" | "triangle" | "diamond" }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id={`cg-${fill.replace("#","")}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="60%" stopColor={fill} />
          <stop offset="100%" stopColor={fill} stopOpacity="0.9" />
        </radialGradient>
      </defs>
      {shape === "heart" && (
        <path d="M20 33 C 8 24, 6 14, 13 10 C 17 8, 20 12, 20 14 C 20 12, 23 8, 27 10 C 34 14, 32 24, 20 33 Z"
              fill={`url(#cg-${fill.replace("#","")})`} stroke={fill} strokeOpacity="0.3" strokeWidth="0.6" />
      )}
      {shape === "squircle" && (
        <rect x="6" y="6" width="28" height="28" rx="8" fill={`url(#cg-${fill.replace("#","")})`} />
      )}
      {shape === "triangle" && (
        <polygon points="20,6 34,32 6,32" fill={`url(#cg-${fill.replace("#","")})`} />
      )}
      {shape === "diamond" && (
        <polygon points="20,4 36,20 20,36 4,20" fill={`url(#cg-${fill.replace("#","")})`} />
      )}
    </svg>
  );
}

function FruitIcon({ fill, highlight, dots }: { fill: string; highlight: string; dots?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="22" r="14" fill={fill} />
      <ellipse cx="14" cy="16" rx="5" ry="3" fill={highlight} opacity="0.6" />
      {dots && (
        <>
          <circle cx="14" cy="24" r="2.2" fill="#000" opacity="0.15" />
          <circle cx="22" cy="20" r="2.2" fill="#000" opacity="0.15" />
          <circle cx="25" cy="27" r="2.2" fill="#000" opacity="0.15" />
        </>
      )}
      {/* leaf */}
      <path d="M20 10 Q24 6 28 8 Q24 12 20 12 Z" fill="#5fd88c" />
    </svg>
  );
}

function ScatterIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="18" r="12" fill="#f1c94a" stroke="#ff5b7a" strokeWidth="2" />
      <path d="M20 30 L20 36" stroke="#8d9ca8" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="18" r="4" fill="#ff5b7a" />
    </svg>
  );
}

function BombIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="22" r="12" fill="#1a2128" stroke="#4cb8ff" strokeWidth="2" />
      <path d="M20 10 L22 6 L26 8" stroke="#f1c94a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26" cy="8" r="2" fill="#f1c94a" />
    </svg>
  );
}

// ──────────────────────────── grid helpers ────────────────────────────

/** Random initial grid for idle state (no server call yet — just decorative). */
function randomIdleGrid(): SwashSymbol[][] {
  const bag: SwashSymbol[] = ["red", "purple", "green", "blue", "plum", "apple", "watermelon", "grape", "banana"];
  return Array.from({ length: SWASH_GRID_H }, () =>
    Array.from({ length: SWASH_GRID_W }, () => bag[Math.floor(Math.random() * bag.length)]!),
  );
}

// ──────────────────────────── play result type ────────────────────────────

interface PlayResult {
  ok: true;
  outcome: SwashOutcome;
  multiplier: number;
  betNano: string;      // actual debited amount (1× bet or 100× on buy)
  baseBetNano: string;  // the user's selected bet
  mode: "spin" | "buy";
  payoutNano: string;
  newBalanceNano: string;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
  // Fairness is intentionally omitted on slots per product direction.
}

// ──────────────────────────── animation timings ────────────────────────────

const STEP_MS = 650;          // per-tumble-step dwell (settle after drop + win flash)
const FS_INTRO_MS = 900;      // banner for "10 Free Spins"
const FS_BETWEEN_MS = 180;    // small pause between each free spin
const WIN_CARD_MS = 1000;     // how long the win card stays up after a spin

function computeSettleMs(outcome: SwashOutcome): number {
  const baseSteps = outcome.baseSteps.length;
  const fsSteps = outcome.freeSpins.spins.reduce((n, s) => n + s.steps.length, 0);
  return (
    baseSteps * STEP_MS +
    (outcome.freeSpins.triggered ? FS_INTRO_MS + fsSteps * STEP_MS + outcome.freeSpins.spins.length * FS_BETWEEN_MS : 0) +
    WIN_CARD_MS
  );
}

// ──────────────────────────── component ────────────────────────────

export function SwashBooze({ onBack, onError }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);

  /** Currently-drawn grid. Swapped each animation step. */
  const [grid, setGrid] = useState<SwashSymbol[][]>(() => randomIdleGrid());
  /** Cells currently flashing as a win. */
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  /** Active bomb overlays on the current grid. */
  const [bombs, setBombs] = useState<Array<{ row: number; col: number; value: number }>>([]);
  /** Current free-spins banner state. null when not in FS. */
  const [fsState, setFsState] = useState<null | { spinsLeft: number; persistent: number[]; intro: boolean }>(null);
  /** Final payout card (shown after settle). */
  const [winCard, setWinCard] = useState<null | { multiplier: number; payoutNano: string; effectiveBetNano: string }>(null);

  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  // ──────────────────────────── play ────────────────────────────

  const placeBet = async (nano: bigint, playMode: "spin" | "buy" = "spin"): Promise<AutoBetResult> => {
    setBusy(true);
    haptic("light");
    try {
      const r: PlayResult = await api("/single/swashbooze/play", {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), mode: playMode }),
      });
      setBalance(BigInt(r.newBalanceNano));
      animate(r);
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

  const spin = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) { onError?.("Enter a bet amount"); return; }
    const nano = tonToNano(ton);
    if (nano > balance) { onError?.("Insufficient balance"); notify("error"); return; }
    if (busy || rolling) return;
    try {
      await placeBet(nano, "spin");
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    }
  };

  const buyBonus = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) { onError?.("Enter a bet amount"); return; }
    const nano = tonToNano(ton);
    const costNano = nano * BigInt(SWASH_BONUS_BUY_COST);
    if (costNano > balance) { onError?.("Insufficient balance for bonus buy"); notify("error"); return; }
    if (busy || rolling) return;
    try {
      await placeBet(nano, "buy");
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    }
  };

  function humanize(err: unknown): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "rate_limited":         return "Slow down — wait a moment";
        case "invalid_params":       return "Invalid spin parameters";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Spin failed (${err.code})`;
      }
    }
    return "Spin failed. Check your connection.";
  }

  // ──────────────────────────── animation engine ────────────────────────────

  const animate = (r: PlayResult) => {
    clearTimers();
    setRolling(true);
    setWinCard(null);
    setWinCells(new Set());
    setBombs([]);
    setFsState(null);

    let t = 0;

    // Base-game steps
    for (let i = 0; i < r.outcome.baseSteps.length; i++) {
      const step = r.outcome.baseSteps[i]!;
      timers.current.push(window.setTimeout(() => renderStep(step), t));
      t += STEP_MS;
    }

    // Free spins
    if (r.outcome.freeSpins.triggered) {
      timers.current.push(window.setTimeout(() => {
        setFsState({ spinsLeft: SWASH_FREE_SPINS, persistent: [], intro: true });
      }, t));
      t += FS_INTRO_MS;

      const persistent: number[] = [];
      for (let si = 0; si < r.outcome.freeSpins.spins.length; si++) {
        const spin = r.outcome.freeSpins.spins[si]!;
        for (let i = 0; i < spin.steps.length; i++) {
          const step = spin.steps[i]!;
          timers.current.push(window.setTimeout(() => {
            // FS intro flag drops when the first real step lands.
            setFsState((prev) => prev ? { ...prev, intro: false, spinsLeft: SWASH_FREE_SPINS - si } : prev);
            renderStep(step);
          }, t));
          t += STEP_MS;
        }
        // After each FS's final step, push any new bombs into the persistent strip.
        const newBombs = spin.steps.flatMap((s) => s.bombs.map((b) => b.value));
        if (newBombs.length) {
          timers.current.push(window.setTimeout(() => {
            for (const v of newBombs) persistent.push(v);
            const snap = persistent.slice();
            setFsState((prev) => prev ? { ...prev, persistent: snap } : prev);
          }, t));
        }
        t += FS_BETWEEN_MS;
      }
    }

    // Settle — show win card if any win, clear rolling state
    timers.current.push(window.setTimeout(() => {
      if (r.multiplier > 0) {
        setWinCard({
          multiplier: r.multiplier,
          payoutNano: r.payoutNano,
          effectiveBetNano: r.betNano,
        });
      }
      setWinCells(new Set());
      setBombs([]);
      setFsState(null);
      setRolling(false);
    }, t));

    // Clear the win card after a beat
    timers.current.push(window.setTimeout(() => {
      setWinCard(null);
    }, t + WIN_CARD_MS));
  };

  const renderStep = (step: SwashSpinStep) => {
    setGrid(step.grid);
    setBombs(step.bombs);
    const cells = new Set<string>();
    for (const c of step.winningCells) cells.add(`${c.row},${c.col}`);
    setWinCells(cells);
  };

  // ──────────────────────────── bet helpers ────────────────────────────

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

  const betReady = !busy && !rolling && (parseFloat(amount) || 0) > 0;
  const buyCostTon = (parseFloat(amount) || 0) * SWASH_BONUS_BUY_COST;
  const buyAffordable = tonToNano(buyCostTon) <= balance;

  // AutoPanel needs a non-generic settle — rough average (base game, no FS).
  const settleDelayMs = useMemo(() => 1800, []);

  return (
    <div className="sg-screen">
      <div className="sg-head">
        <button className="stake-game-back" onClick={onBack} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="sg-title">Swash Booze</div>
        {/* Reserve the right slot so the title stays centered. */}
        <div style={{ width: 60 }} />
      </div>

      <div className="sg-stage swash-stage">
        {/* persistent multipliers during FS */}
        {fsState && (
          <div className="swash-fs-bar">
            <span className="swash-fs-bar-label">
              Free Spins · {fsState.spinsLeft}/{SWASH_FREE_SPINS}
            </span>
            {fsState.persistent.length > 0 && (
              <span className="swash-fs-bar-multis">
                {fsState.persistent.map((v, i) => (
                  <span key={i} className="swash-fs-bar-multi">{v}×</span>
                ))}
              </span>
            )}
          </div>
        )}

        <div className="swash-grid">
          {grid.map((row, r) => row.map((sym, c) => {
            const key = `${r},${c}`;
            const isWin = winCells.has(key);
            const bomb = bombs.find((b) => b.row === r && b.col === c);
            return (
              <div key={key} className={`swash-cell ${isWin ? "is-win" : ""}`}>
                <SymbolIcon s={sym} />
                {bomb && (
                  <div className="swash-bomb-overlay">{bomb.value}×</div>
                )}
              </div>
            );
          }))}
        </div>

        {fsState?.intro && (
          <div className="swash-fs-intro">
            <div className="swash-fs-intro-big">10</div>
            <div className="swash-fs-intro-sub">Free Spins</div>
          </div>
        )}

        {winCard && !rolling && (
          <div className="swash-win-card">
            <div className="swash-win-card-mult">{winCard.multiplier.toFixed(2)}×</div>
            <div className="swash-win-card-divider" />
            <div className="swash-win-card-amount">
              +{fmtTon(BigInt(winCard.payoutNano) - BigInt(winCard.effectiveBetNano))}
            </div>
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

        {mode === "manual" ? (
          <>
            <div className="sg-field">
              <div className="sg-field-head">
                <span>Bet amount</span>
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

            <div className="swash-buttons">
              <button className="sg-cta" onClick={spin} disabled={!betReady} type="button">
                {busy || rolling ? "Spinning…" : "Spin"}
              </button>
              <button
                className="sg-cta swash-buy"
                onClick={buyBonus}
                disabled={!betReady || !buyAffordable}
                type="button"
              >
                Buy Bonus · {buyCostTon.toFixed(2).replace(/\.?0+$/, "")}
              </button>
            </div>
          </>
        ) : (
          <AutoPanel
            balance={balance}
            settleDelayMs={settleDelayMs}
            initialAmount={amount}
            onAmountChange={setAmount}
            placeBet={(nano) => placeBet(nano, "spin")}
            onError={(m) => onError?.(m)}
            locked={rolling}
          />
        )}
      </div>
    </div>
  );
}
