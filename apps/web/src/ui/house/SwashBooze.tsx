import { useEffect, useRef, useState } from "react";
import {
  SWASH_GRID_H,
  SWASH_GRID_W,
  SWASH_FREE_SPINS,
  SWASH_BONUS_BUY_COST,
  SWASH_ANTE_MULTIPLIER,
  SWASH_SCATTERS_TO_TRIGGER,
  type SwashSymbol,
  type SwashSpinStep,
  type SwashOutcome,
} from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { usePriceStore, usdToNano, nanoToUsd, fmtUsd } from "../../state/priceStore";
import { SwashSymbolIcon, SwashBombIcon } from "./swashSymbols";

// ────────────────────────── helpers ──────────────────────────

const randomIdleGrid = (): SwashSymbol[][] => {
  const bag: SwashSymbol[] = ["red", "purple", "green", "blue", "plum", "apple", "watermelon", "grape", "banana"];
  return Array.from({ length: SWASH_GRID_H }, () =>
    Array.from({ length: SWASH_GRID_W }, () => bag[Math.floor(Math.random() * bag.length)]!),
  );
};

interface PlayResult {
  ok: true;
  outcome: SwashOutcome;
  multiplier: number;
  betNano: string;
  baseBetNano: string;
  mode: "spin" | "buy";
  ante: boolean;
  payoutNano: string;
  newBalanceNano: string;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
}

// ────────────────────────── animation timings ──────────────────────────

const STAGGER_MS = 28;           // per-column drop stagger
const DROP_DUR_MS = 220;         // full drop per column
const WIN_FLASH_MS = 320;        // winning-cluster pulse+burst dwell
const TUMBLE_GAP_MS = 90;        // post-burst pause before next drop
const STEP_DUR = STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS + WIN_FLASH_MS + TUMBLE_GAP_MS;

const FS_INTRO_MS = 1100;
const FS_BETWEEN_MS = 220;
const FS_OUTRO_MS = 1300;
const BIG_WIN_MS = 1800;
const COUNTUP_DUR_MS = 900;

// ────────────────────────── component ──────────────────────────

export function SwashBooze({ onBack, onError }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);
  const usdPerTon = usePriceStore((s) => s.usdPerTon);

  const [bet, setBet] = useState("1");
  const [ante, setAnte] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [grid, setGrid] = useState<SwashSymbol[][]>(() => randomIdleGrid());
  const [stepCounter, setStepCounter] = useState(0); // bumps on every grid swap so keys change and React remounts cells
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [bombs, setBombs] = useState<Array<{ row: number; col: number; value: number }>>([]);
  const [scatterCount, setScatterCount] = useState(0);
  const [phase, setPhase] = useState<"idle" | "base" | "fs" | "big-win">("idle");
  const [fsMeta, setFsMeta] = useState<null | { spinsTotal: number; spinIdx: number; fsMult: number }>(null);
  const [bigWin, setBigWin] = useState<null | { tier: "big" | "super" | "mega"; multiplier: number }>(null);
  const [showFsIntro, setShowFsIntro] = useState(false);
  const [showFsOutro, setShowFsOutro] = useState<null | { totalMult: number }>(null);
  const [winCounterUsd, setWinCounterUsd] = useState<number | null>(null);
  const countRafRef = useRef<number | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);

  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    if (countRafRef.current) cancelAnimationFrame(countRafRef.current);
    countRafRef.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  // ────────────────────────── server call ──────────────────────────

  const callServer = async (mode: "spin" | "buy"): Promise<PlayResult> => {
    if (usdPerTon == null) throw new Error("price_not_loaded");
    const usd = parseFloat(bet);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("bad_amount");
    const baseNano = usdToNano(usd, usdPerTon);
    // Pre-flight balance check in USD so we fail fast with a friendly message.
    const effectiveMult = mode === "buy" ? SWASH_BONUS_BUY_COST : ante ? SWASH_ANTE_MULTIPLIER : 1;
    // Use 10_000-scaled integer math to match the server exactly.
    const scaledMult = BigInt(Math.round(effectiveMult * 10_000));
    const effectiveNano = (baseNano * scaledMult) / 10_000n;
    if (effectiveNano > balance) {
      throw new ApiError("", "insufficient_balance", 409);
    }
    const res = await api<PlayResult>("/single/swashbooze/play", {
      method: "POST",
      body: JSON.stringify({
        amountNano: baseNano.toString(),
        mode,
        ante: mode === "buy" ? false : ante,
      }),
    });
    setBalance(BigInt(res.newBalanceNano));
    return res;
  };

  const onSpin = async () => {
    if (busy || rolling || usdPerTon == null) return;
    setBusy(true);
    haptic("light");
    try {
      const r = await callServer("spin");
      playOutcome(r);
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmBuy = async () => {
    setShowBuyModal(false);
    if (busy || rolling || usdPerTon == null) return;
    setBusy(true);
    haptic("medium");
    try {
      const r = await callServer("buy");
      playOutcome(r);
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    } finally {
      setBusy(false);
    }
  };

  const humanize = (err: unknown): string => {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "rate_limited":         return "Slow down — wait a moment";
        case "ante_disabled_with_buy": return "Turn off Double Chance to buy";
        case "invalid_params":       return "Invalid spin parameters";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Spin failed (${err.code})`;
      }
    }
    if (err instanceof Error && err.message === "price_not_loaded") return "Loading price…";
    if (err instanceof Error && err.message === "bad_amount") return "Enter a bet amount";
    return "Spin failed. Check your connection.";
  };

  // ────────────────────────── animation driver ──────────────────────────

  const playOutcome = (r: PlayResult) => {
    clearTimers();
    setRolling(true);
    setWinCounterUsd(null);
    setBigWin(null);
    setShowFsIntro(false);
    setShowFsOutro(null);

    let t = 0;

    // Base game — one step per tumble
    for (const step of r.outcome.baseSteps) {
      const at = t;
      timers.current.push(window.setTimeout(() => renderStep(step), at));
      t += STEP_DUR;
    }

    // Free spins
    if (r.outcome.freeSpins.triggered) {
      const fsIntroAt = t;
      timers.current.push(window.setTimeout(() => {
        setPhase("fs");
        setShowFsIntro(true);
        setFsMeta({ spinsTotal: r.outcome.freeSpins.spins.length, spinIdx: 0, fsMult: 0 });
        haptic("medium");
      }, fsIntroAt));
      timers.current.push(window.setTimeout(() => setShowFsIntro(false), fsIntroAt + FS_INTRO_MS - 200));
      t += FS_INTRO_MS;

      let runningMult = 0;
      for (let si = 0; si < r.outcome.freeSpins.spins.length; si++) {
        const fsSpin = r.outcome.freeSpins.spins[si]!;
        for (const step of fsSpin.steps) {
          const at = t;
          timers.current.push(window.setTimeout(() => renderStep(step), at));
          t += STEP_DUR;
        }
        // Advance the spin counter at the end of this spin
        runningMult += fsSpin.spinWin;
        const idx = si + 1;
        const mult = runningMult;
        timers.current.push(window.setTimeout(() => {
          setFsMeta((prev) => prev ? { ...prev, spinIdx: idx, fsMult: mult } : prev);
        }, t));
        t += FS_BETWEEN_MS;
      }

      // FS outro
      const outroAt = t;
      timers.current.push(window.setTimeout(() => {
        setShowFsOutro({ totalMult: r.outcome.freeSpins.fsMultiplier });
        haptic("heavy");
      }, outroAt));
      timers.current.push(window.setTimeout(() => setShowFsOutro(null), outroAt + FS_OUTRO_MS - 200));
      t += FS_OUTRO_MS;
    }

    // Big / Super / Mega Win celebration
    const tier = bigWinTier(r.multiplier);
    if (tier) {
      const bwAt = t;
      timers.current.push(window.setTimeout(() => {
        setPhase("big-win");
        setBigWin({ tier, multiplier: r.multiplier });
        haptic("heavy");
      }, bwAt));
      timers.current.push(window.setTimeout(() => {
        setBigWin(null);
        setPhase("idle");
      }, bwAt + BIG_WIN_MS));
      t += BIG_WIN_MS;
    }

    // Final settle
    const finalAt = t;
    timers.current.push(window.setTimeout(() => {
      setRolling(false);
      setWinCells(new Set());
      setScatterCount(0);
      setPhase("idle");
      setFsMeta(null);
      if (r.multiplier > 0 && usdPerTon != null) {
        const usd = nanoToUsd(BigInt(r.payoutNano), usdPerTon);
        animateCountUp(usd);
      } else {
        setWinCounterUsd(null);
      }
    }, finalAt));
  };

  const renderStep = (step: SwashSpinStep) => {
    setGrid(step.grid);
    setBombs(step.bombs);
    setScatterCount(step.scatterCount);
    const ws = new Set<string>();
    for (const c of step.winningCells) ws.add(`${c.row},${c.col}`);
    setWinCells(ws);
    setStepCounter((n) => n + 1); // bump so the cell keys change → React remounts → keyframe re-runs
    if (step.winningCells.length > 0) haptic("light");
  };

  const animateCountUp = (targetUsd: number) => {
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNTUP_DUR_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setWinCounterUsd(targetUsd * eased);
      if (p < 1) countRafRef.current = requestAnimationFrame(step);
      else countRafRef.current = null;
    };
    countRafRef.current = requestAnimationFrame(step);
  };

  // ────────────────────────── bet controls ──────────────────────────

  const balUsd = usdPerTon != null ? nanoToUsd(balance, usdPerTon) : 0;
  const betUsd = parseFloat(bet) || 0;
  const buyCostUsd = betUsd * SWASH_BONUS_BUY_COST;
  const effectiveBetUsd = betUsd * (ante ? SWASH_ANTE_MULTIPLIER : 1);

  const BET_STEPS = [0.20, 0.40, 0.80, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00];
  const currentStep = BET_STEPS.findIndex((v) => v >= betUsd);
  const decBet = () => {
    const idx = currentStep <= 0 ? 0 : currentStep - 1;
    setBet(BET_STEPS[idx]!.toFixed(2));
  };
  const incBet = () => {
    const idx = currentStep < 0 ? BET_STEPS.length - 1 : Math.min(currentStep + 1, BET_STEPS.length - 1);
    setBet(BET_STEPS[idx]!.toFixed(2));
  };

  // ────────────────────────── render ──────────────────────────

  return (
    <div className="sg-screen swash-screen">
      {/* Header */}
      <div className="swash-head">
        <button className="swash-head-back" onClick={onBack} type="button" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="swash-head-title">Swash Booze</div>
        <button
          type="button"
          className="swash-head-sound"
          onClick={() => setSoundOn((s) => !s)}
          aria-label={soundOn ? "Mute" : "Unmute"}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </div>

      {/* Candy-world stage */}
      <div className={`swash-stage ${phase === "fs" ? "is-fs" : ""}`}>
        <div className="swash-cloud swash-cloud-1" aria-hidden />
        <div className="swash-cloud swash-cloud-2" aria-hidden />
        <div className="swash-cloud swash-cloud-3" aria-hidden />

        {/* Grid area — full width on mobile, centered */}
        <div className="swash-grid-frame">
          <div className="swash-grid">
            {grid.map((row, r) => row.map((sym, c) => {
              const key = `${stepCounter}-${r}-${c}`;
              const isWin = winCells.has(`${r},${c}`);
              const bomb = bombs.find((b) => b.row === r && b.col === c);
              return (
                <div
                  key={key}
                  className={`swash-cell ${isWin ? "is-win" : ""}`}
                  style={{ animationDelay: `${c * STAGGER_MS}ms` }}
                >
                  <div className="swash-cell-inner">
                    {bomb ? (
                      <SwashBombIcon value={bomb.value} winning={isWin} />
                    ) : (
                      <SwashSymbolIcon symbol={sym} winning={isWin} />
                    )}
                  </div>
                  {isWin && <div className="swash-cell-burst" aria-hidden />}
                </div>
              );
            }))}
          </div>

          {/* Scatter counter */}
          {phase !== "fs" && scatterCount > 0 && scatterCount < SWASH_SCATTERS_TO_TRIGGER && !rolling && (
            <div className="swash-scatter-counter">
              {scatterCount}/{SWASH_SCATTERS_TO_TRIGGER}
            </div>
          )}

          {/* FS header pill */}
          {phase === "fs" && fsMeta && !showFsIntro && (
            <div className="swash-fs-bar">
              <span>FREE SPINS <strong>{fsMeta.spinsTotal - fsMeta.spinIdx}</strong></span>
              <span>WIN <strong>{fmtUsd(fsMeta.fsMult * betUsd)}</strong></span>
            </div>
          )}

          {/* FS intro */}
          {showFsIntro && (
            <div className="swash-fs-intro">
              <div className="swash-fs-intro-top">FREE SPINS</div>
              <div className="swash-fs-intro-big">{SWASH_FREE_SPINS}</div>
              <div className="swash-fs-intro-bottom">BONUS TRIGGERED</div>
            </div>
          )}

          {/* FS outro */}
          {showFsOutro && (
            <div className="swash-fs-outro">
              <div className="swash-fs-outro-label">FEATURE WIN</div>
              <div className="swash-fs-outro-amount">{fmtUsd(showFsOutro.totalMult * betUsd)}</div>
            </div>
          )}

          {/* Big Win */}
          {bigWin && (
            <div className={`swash-big-win is-${bigWin.tier}`}>
              <div className="swash-big-win-label">
                {bigWin.tier === "mega" ? "MEGA WIN" : bigWin.tier === "super" ? "SUPER WIN" : "BIG WIN"}
              </div>
              <div className="swash-big-win-amount">{fmtUsd(bigWin.multiplier * betUsd)}</div>
            </div>
          )}

          {/* Settle win counter */}
          {winCounterUsd != null && phase === "idle" && !bigWin && (
            <div className="swash-win-counter">{fmtUsd(winCounterUsd)}</div>
          )}
        </div>

        {/* Feature buttons — horizontal row below the grid on mobile */}
        <div className="swash-feature-row">
          <button
            type="button"
            className="swash-feature-buy"
            onClick={() => {
              if (ante) { onError?.("Turn off Double Chance to buy"); return; }
              if (busy || rolling) return;
              setShowBuyModal(true);
            }}
            disabled={busy || rolling}
          >
            <span className="swash-feature-buy-label">BUY FEATURE</span>
            <span className="swash-feature-buy-price">{fmtUsd(buyCostUsd)}</span>
          </button>

          <button
            type="button"
            className={`swash-feature-ante ${ante ? "is-on" : ""}`}
            onClick={() => setAnte((a) => !a)}
            disabled={busy || rolling}
          >
            <div className="swash-feature-ante-copy">
              <span className="swash-feature-ante-label">DOUBLE CHANCE</span>
              <span className="swash-feature-ante-sub">2× scatter rate</span>
            </div>
            <div className={`swash-feature-ante-toggle ${ante ? "is-on" : ""}`}>
              <span className="swash-feature-ante-thumb" />
            </div>
          </button>
        </div>
      </div>

      {/* Bottom HUD */}
      <div className="swash-hud">
        <div className="swash-hud-readout">
          <div className="swash-hud-row">
            <span className="swash-hud-lbl">CREDIT</span>
            <span className="swash-hud-val">{fmtUsd(balUsd)}</span>
          </div>
          <div className="swash-hud-row">
            <span className="swash-hud-lbl">BET</span>
            <span className="swash-hud-val">{fmtUsd(effectiveBetUsd)}</span>
          </div>
        </div>

        <div className="swash-hud-ctrls">
          <button
            type="button"
            className="swash-bet-btn"
            onClick={decBet}
            disabled={busy || rolling}
            aria-label="Decrease bet"
          >−</button>

          <button
            type="button"
            className={`swash-spin-btn ${busy || rolling ? "is-spinning" : ""}`}
            onClick={onSpin}
            disabled={busy || rolling}
            aria-label="Spin"
          >
            <svg viewBox="0 0 100 100" width="72" height="72">
              <circle cx="50" cy="50" r="46" fill="#ffd54a" stroke="#b6730b" strokeWidth="3" />
              <circle cx="50" cy="50" r="36" fill="#ff8f1f" />
              <path
                d="M50 22 A 28 28 0 0 1 78 50 L 70 50 L 82 62 L 94 50 L 86 50 A 36 36 0 0 0 50 14 Z"
                fill="#ffffff"
              />
              <path
                d="M50 78 A 28 28 0 0 1 22 50 L 30 50 L 18 38 L 6 50 L 14 50 A 36 36 0 0 0 50 86 Z"
                fill="#ffffff"
              />
            </svg>
          </button>

          <button
            type="button"
            className="swash-bet-btn"
            onClick={incBet}
            disabled={busy || rolling}
            aria-label="Increase bet"
          >+</button>
        </div>
      </div>

      {/* Buy confirmation modal */}
      {showBuyModal && (
        <div className="swash-buy-modal-bg" onClick={() => setShowBuyModal(false)}>
          <div className="swash-buy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="swash-buy-modal-title">Buy Bonus Round?</div>
            <div className="swash-buy-modal-body">
              Get {SWASH_FREE_SPINS} free spins immediately. Multiplier bombs
              only land during free spins.
            </div>
            <div className="swash-buy-modal-cost">
              <span className="swash-buy-modal-cost-label">Cost</span>
              <span className="swash-buy-modal-cost-value">{fmtUsd(buyCostUsd)}</span>
            </div>
            <div className="swash-buy-modal-actions">
              <button
                type="button"
                className="swash-buy-modal-cancel"
                onClick={() => setShowBuyModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="swash-buy-modal-confirm"
                onClick={onConfirmBuy}
                disabled={buyCostUsd > balUsd}
              >
                {buyCostUsd > balUsd ? "Low balance" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function bigWinTier(multiplier: number): "big" | "super" | "mega" | null {
  if (multiplier >= 50) return "mega";
  if (multiplier >= 25) return "super";
  if (multiplier >= 10) return "big";
  return null;
}
