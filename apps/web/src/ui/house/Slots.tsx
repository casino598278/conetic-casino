import { useEffect, useRef, useState } from "react";
import type { SlotVariant } from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { usePriceStore, usdToNano, nanoToUsd, fmtUsd } from "../../state/priceStore";
import { AutoPanel, type AutoBetResult } from "./AutoPanel";

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

/** Symbol palette shared across variants — each symbol renders as a colored
 *  rounded tile with a short text label. Keeps the UI tiny — no sprites yet. */
const SYMBOL_COLORS: Record<string, string> = {
  // Cosmic Lines
  cherry:  "#ff5875",
  lemon:   "#f5b544",
  bell:    "#ffc95f",
  star:    "#3ecf8e",
  seven:   "#8b5cf6",
  W:       "#f5b544",
  S:       "#3ecf8e",
  // Fruit Storm
  grape:   "#8b5cf6",
  apple:   "#ff5875",
  plum:    "#b44dc7",
  pear:    "#7fc97f",
  banana:  "#ffd34d",
  M:       "#f5b544",
  // Gem Clusters
  red:     "#ff5875",
  orange:  "#ff9a4d",
  yellow:  "#ffd34d",
  green:   "#3ecf8e",
  teal:    "#4dd0e1",
  purple:  "#8b5cf6",
  pink:    "#ff77b0",
  // Lucky Sevens
  "7":     "#ff5875",
  bar:     "#f5b544",
};

const SYMBOL_LABELS: Record<string, string> = {
  cherry: "🍒", lemon: "🍋", bell: "🔔", star: "★", seven: "7", W: "W", S: "★",
  grape: "🍇", apple: "🍎", plum: "🫐", pear: "🍐", banana: "🍌", M: "×",
  red: "◆", orange: "◆", yellow: "◆", green: "◆", teal: "◆", purple: "◆", pink: "◆",
  "7": "7", bar: "BAR",
};

interface BasePlayResult {
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

/** Extract the "frames" to animate from a variant's outcome. Each frame is
 *  one grid snapshot with the highlighted winning positions. We animate by
 *  stepping through frames with a short delay. */
function framesFor(variant: SlotVariant, outcome: any): { grid: string[][]; highlight: Set<string> }[] {
  const frames: { grid: string[][]; highlight: Set<string> }[] = [];

  if (variant === "cosmicLines") {
    const push = (spin: any) => {
      const hl = new Set<string>();
      for (const w of spin.lineWins ?? []) {
        const line = PAYLINES_CL[w.lineIndex];
        if (!line) continue;
        for (let i = 0; i < w.count; i++) {
          const [c, r] = line[i]!;
          hl.add(`${c},${r}`);
        }
      }
      // Also highlight scatters on the initial grid.
      for (let c = 0; c < spin.grid.length; c++) {
        for (let r = 0; r < spin.grid[c].length; r++) {
          if (spin.grid[c][r] === "S") hl.add(`${c},${r}`);
        }
      }
      frames.push({ grid: spin.grid, highlight: hl });
    };
    push(outcome.baseSpin);
    for (const s of outcome.freeSpins ?? []) push(s);
    return frames;
  }

  if (variant === "fruitStorm") {
    const pushSpin = (spin: any) => {
      for (const step of spin.tumbleSteps) {
        frames.push({
          grid: step.grid,
          highlight: new Set<string>((step.clearedPositions ?? []).map(([c, r]: [number, number]) => `${c},${r}`)),
        });
      }
    };
    pushSpin(outcome.baseSpin);
    for (const s of outcome.freeSpins ?? []) pushSpin(s);
    return frames;
  }

  if (variant === "gemClusters") {
    for (const step of outcome.steps) {
      const hl = new Set<string>();
      for (const k of step.clusters ?? []) {
        for (const [c, r] of k.cells) hl.add(`${c},${r}`);
      }
      frames.push({ grid: step.grid, highlight: hl });
    }
    return frames;
  }

  if (variant === "luckySevens") {
    const lineHl = new Set<string>();
    for (const w of outcome.lineWins ?? []) {
      const line = PAYLINES_LS[w.lineIndex];
      if (!line) continue;
      for (const [c, r] of line) lineHl.add(`${c},${r}`);
    }
    for (let i = 0; i < outcome.steps.length; i++) {
      const step = outcome.steps[i];
      const isFinal = i === outcome.steps.length - 1;
      const hl = new Set<string>(step.lockedSevens.map(([c, r]: [number, number]) => `${c},${r}`));
      if (isFinal) for (const k of lineHl) hl.add(k);
      frames.push({ grid: step.grid, highlight: hl });
    }
    return frames;
  }

  return frames;
}

// Paylines must match the shared package — duplicated here because the module
// doesn't export them (they're internal). If we ever change them, update both.
const PAYLINES_CL: [number, number][][] = [
  [[0,1],[1,1],[2,1],[3,1],[4,1]],
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,2],[1,2],[2,2],[3,2],[4,2]],
  [[0,0],[1,1],[2,2],[3,1],[4,0]],
  [[0,2],[1,1],[2,0],[3,1],[4,2]],
  [[0,1],[1,0],[2,0],[3,0],[4,1]],
  [[0,1],[1,2],[2,2],[3,2],[4,1]],
  [[0,0],[1,0],[2,1],[3,2],[4,2]],
  [[0,2],[1,2],[2,1],[3,0],[4,0]],
  [[0,1],[1,2],[2,1],[3,0],[4,1]],
];
const PAYLINES_LS: [number, number][][] = [
  [[0,0],[1,0],[2,0]],
  [[0,1],[1,1],[2,1]],
  [[0,2],[1,2],[2,2]],
  [[0,0],[1,1],[2,2]],
  [[0,2],[1,1],[2,0]],
];

export function Slots({ variant, onBack, onError, onOpenFairness }: Props) {
  const meta = META[variant];
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  /** The grid currently painted on-screen (either static initial or an animating frame). */
  const [visibleGrid, setVisibleGrid] = useState<string[][]>(() =>
    Array.from({ length: meta.cols }, () => Array.from({ length: meta.rows }, () => "")),
  );
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<BasePlayResult | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => timersRef.current.forEach((t) => clearTimeout(t)), []);

  const FRAME_MS = variant === "fruitStorm" || variant === "gemClusters" ? 550 : 700;

  const placeBet = async (nano: bigint): Promise<AutoBetResult> => {
    setBusy(true);
    haptic("light");
    try {
      const r: BasePlayResult = await api(`/single/slots/${variant}/play`, {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), params: {} }),
      });
      setBalance(BigInt(r.newBalanceNano));
      setLastResult(r);
      animateFrames(r);
      notify(r.multiplier > 0 ? "success" : "warning");
      return {
        win: r.multiplier > 0,
        betNano: BigInt(r.betNano),
        payoutNano: BigInt(r.payoutNano),
      };
    } finally {
      setBusy(false);
    }
  };

  const animateFrames = (r: BasePlayResult) => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
    const frames = framesFor(variant, r.outcome);
    if (frames.length === 0) { setRolling(false); return; }
    setRolling(true);
    setFrameIdx(0);
    setVisibleGrid(frames[0]!.grid);
    setHighlight(frames[0]!.highlight);
    for (let i = 1; i < frames.length; i++) {
      const t = window.setTimeout(() => {
        setFrameIdx(i);
        setVisibleGrid(frames[i]!.grid);
        setHighlight(frames[i]!.highlight);
        if (i === frames.length - 1) {
          const done = window.setTimeout(() => setRolling(false), FRAME_MS);
          timersRef.current.push(done);
        }
      }, i * FRAME_MS);
      timersRef.current.push(t);
    }
    if (frames.length === 1) {
      const done = window.setTimeout(() => setRolling(false), FRAME_MS);
      timersRef.current.push(done);
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

  const frameCount = lastResult ? framesFor(variant, lastResult.outcome).length : 0;

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

      <div className="sg-stage slots-stage">
        <div className="slots-meta">
          <span className="slots-sub">{meta.sub}</span>
          {rolling && frameCount > 1 && (
            <span className="slots-frame">Spin {frameIdx + 1}/{frameCount}</span>
          )}
        </div>

        <div
          className="slots-grid"
          style={{
            gridTemplateColumns: `repeat(${meta.cols}, 1fr)`,
            gridTemplateRows: `repeat(${meta.rows}, 1fr)`,
          }}
        >
          {Array.from({ length: meta.rows }).map((_, r) =>
            Array.from({ length: meta.cols }).map((_, c) => {
              const sym = visibleGrid[c]?.[r] ?? "";
              const key = `${c},${r}`;
              const hit = highlight.has(key);
              const color = SYMBOL_COLORS[sym] ?? "var(--c-surface-2)";
              const label = SYMBOL_LABELS[sym] ?? sym;
              return (
                <div
                  key={key}
                  className={`slots-cell ${hit ? "is-hit" : ""} ${sym ? "is-filled" : ""}`}
                  style={{ "--cell-color": color } as React.CSSProperties}
                >
                  <span className="slots-cell-label">{label}</span>
                </div>
              );
            }),
          )}
        </div>

        <div className="slots-result">
          {mult == null ? (
            <div className="slots-result-idle">Press spin to play</div>
          ) : won ? (
            <>
              <div className="slots-result-mult">{mult.toFixed(2)}×</div>
              <div className="slots-result-profit">
                {usdPerTon != null ? `+${fmtUsd(profitUsd)}` : "Win"}
              </div>
            </>
          ) : (
            <div className="slots-result-loss">No win</div>
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
            settleDelayMs={FRAME_MS * 4 + 300}
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
