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

// ────────────────────────── play result type ──────────────────────────

interface PlayResult {
  ok: true;
  outcome: SwashOutcome;
  multiplier: number;
  betNano: string;      // actual debited amount (1×/1.25× spin, 100× buy)
  baseBetNano: string;  // user's selected bet
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

const COLUMN_STAGGER_MS = 70;    // between each column's start of drop
const DROP_DUR_MS = 380;         // full drop per column
const WIN_BURST_MS = 520;        // cluster cells pulse + burst
const TUMBLE_GAP_MS = 160;       // beat after burst before next drop
const BOMB_REVEAL_MS = 320;      // bomb landing pop
const FS_INTRO_MS = 1400;        // "10 Free Spins!" banner dwell
const FS_BETWEEN_MS = 380;       // gap between free spins
const FS_OUTRO_MS = 1500;        // end-of-FS summary dwell
const BIG_WIN_MS = 2200;         // Big/Super/Mega win celebration dwell
const COUNTUP_DUR_MS = 1200;     // win amount count-up

// ────────────────────────── per-spin animation plan ──────────────────────────

interface StepAnim {
  kind: "step";
  step: SwashSpinStep;
  durMs: number;
}
interface FsIntroAnim { kind: "fs-intro"; durMs: number; }
interface FsOutroAnim { kind: "fs-outro"; totalMult: number; durMs: number; }
interface BigWinAnim { kind: "big-win"; tier: "big" | "super" | "mega"; multiplier: number; durMs: number; }
type AnimFrame = StepAnim | FsIntroAnim | FsOutroAnim | BigWinAnim;

// ────────────────────────── component ──────────────────────────

export function SwashBooze({ onBack, onError }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);
  const usdPerTon = usePriceStore((s) => s.usdPerTon);

  // Bet config (USD)
  const [bet, setBet] = useState("1");
  const [ante, setAnte] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  // Animation + outcome state
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [grid, setGrid] = useState<SwashSymbol[][]>(() => randomIdleGrid());
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [bombs, setBombs] = useState<Array<{ row: number; col: number; value: number }>>([]);
  const [scatterCount, setScatterCount] = useState(0);
  const [phase, setPhase] = useState<"idle" | "base" | "fs" | "big-win">("idle");
  const [fsMeta, setFsMeta] = useState<null | { spinsTotal: number; spinIdx: number; fsMult: number }>(null);
  const [bigWin, setBigWin] = useState<null | { tier: "big" | "super" | "mega"; multiplier: number }>(null);
  const [showFsIntro, setShowFsIntro] = useState(false);
  const [showFsOutro, setShowFsOutro] = useState<null | { totalMult: number }>(null);

  // Win counter (counted up from 0 during settle)
  const [winCounterUsd, setWinCounterUsd] = useState<number | null>(null);
  const countRafRef = useRef<number | null>(null);

  // Buy confirmation modal
  const [showBuyModal, setShowBuyModal] = useState(false);

  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    if (countRafRef.current) cancelAnimationFrame(countRafRef.current);
    countRafRef.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  // ────────────────────────── placing bets ──────────────────────────

  const callServer = async (mode: "spin" | "buy"): Promise<PlayResult> => {
    if (usdPerTon == null) throw new Error("price_not_loaded");
    const usd = parseFloat(bet);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("bad_amount");
    const baseNano = usdToNano(usd, usdPerTon);
    // Pre-flight balance check in USD so we fail fast with a friendly message.
    const effectiveMult = mode === "buy" ? SWASH_BONUS_BUY_COST : ante ? SWASH_ANTE_MULTIPLIER : 1;
    const effectiveNano = BigInt(Math.round(Number(baseNano) * effectiveMult));
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

    // Build the animation plan up-front, then schedule setTimeouts for each frame.
    const plan: AnimFrame[] = [];

    // Base-game tumble steps
    for (const step of r.outcome.baseSteps) {
      const bombRevealExtra = step.bombs.length > 0 ? BOMB_REVEAL_MS : 0;
      const winBurstExtra = step.winningCells.length > 0 ? WIN_BURST_MS + TUMBLE_GAP_MS : 0;
      const dropTime = COLUMN_STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS;
      plan.push({ kind: "step", step, durMs: dropTime + bombRevealExtra + winBurstExtra });
    }

    // Free-spins round
    if (r.outcome.freeSpins.triggered) {
      plan.push({ kind: "fs-intro", durMs: FS_INTRO_MS });
      for (const fsSpin of r.outcome.freeSpins.spins) {
        for (const step of fsSpin.steps) {
          const bombRevealExtra = step.bombs.length > 0 ? BOMB_REVEAL_MS : 0;
          const winBurstExtra = step.winningCells.length > 0 ? WIN_BURST_MS + TUMBLE_GAP_MS : 0;
          const dropTime = COLUMN_STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS;
          plan.push({ kind: "step", step, durMs: dropTime + bombRevealExtra + winBurstExtra });
        }
        plan.push({ kind: "step", step: null as unknown as SwashSpinStep, durMs: FS_BETWEEN_MS }); // pacing beat
      }
      plan.push({ kind: "fs-outro", totalMult: r.outcome.freeSpins.fsMultiplier, durMs: FS_OUTRO_MS });
    }

    // Big-win tier celebrations (driven by final multiplier relative to 1× stake)
    const bigTier = bigWinTier(r.multiplier);
    if (bigTier) {
      plan.push({ kind: "big-win", tier: bigTier, multiplier: r.multiplier, durMs: BIG_WIN_MS });
    }

    // Schedule each frame
    let cursor = 0;
    let fsSpinCounter = 0;
    const fsSpinTotal = r.outcome.freeSpins.spins.length;
    let runningFsMult = 0;

    for (const frame of plan) {
      const at = cursor;
      cursor += frame.durMs;

      if (frame.kind === "step") {
        timers.current.push(window.setTimeout(() => {
          if (frame.step == null) return; // pacing beat
          setGrid(frame.step.grid);
          setBombs(frame.step.bombs);
          setScatterCount(frame.step.scatterCount);
          const ws = new Set<string>();
          for (const c of frame.step.winningCells) ws.add(`${c.row},${c.col}`);
          setWinCells(ws);
          if (frame.step.stepMultiplier > 0) haptic("light");
        }, at));
        continue;
      }
      if (frame.kind === "fs-intro") {
        timers.current.push(window.setTimeout(() => {
          setPhase("fs");
          setShowFsIntro(true);
          setFsMeta({ spinsTotal: fsSpinTotal, spinIdx: 0, fsMult: 0 });
          haptic("medium");
        }, at));
        timers.current.push(window.setTimeout(() => setShowFsIntro(false), at + frame.durMs - 200));
        continue;
      }
      if (frame.kind === "fs-outro") {
        timers.current.push(window.setTimeout(() => {
          setShowFsOutro({ totalMult: frame.totalMult });
          haptic("heavy");
        }, at));
        timers.current.push(window.setTimeout(() => setShowFsOutro(null), at + frame.durMs - 200));
        continue;
      }
      if (frame.kind === "big-win") {
        timers.current.push(window.setTimeout(() => {
          setPhase("big-win");
          setBigWin({ tier: frame.tier, multiplier: frame.multiplier });
          haptic("heavy");
        }, at));
        timers.current.push(window.setTimeout(() => {
          setBigWin(null);
          setPhase("idle");
        }, at + frame.durMs));
        continue;
      }
    }

    // Advance FS spin counter + accumulate fsMult as each spin ends
    let accumulatedTime = 0;
    for (const step of r.outcome.baseSteps) {
      const bombRevealExtra = step.bombs.length > 0 ? BOMB_REVEAL_MS : 0;
      const winBurstExtra = step.winningCells.length > 0 ? WIN_BURST_MS + TUMBLE_GAP_MS : 0;
      const dropTime = COLUMN_STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS;
      accumulatedTime += dropTime + bombRevealExtra + winBurstExtra;
    }
    if (r.outcome.freeSpins.triggered) {
      accumulatedTime += FS_INTRO_MS;
      for (const fsSpin of r.outcome.freeSpins.spins) {
        for (const step of fsSpin.steps) {
          const bombRevealExtra = step.bombs.length > 0 ? BOMB_REVEAL_MS : 0;
          const winBurstExtra = step.winningCells.length > 0 ? WIN_BURST_MS + TUMBLE_GAP_MS : 0;
          const dropTime = COLUMN_STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS;
          accumulatedTime += dropTime + bombRevealExtra + winBurstExtra;
        }
        // After this spin's last step, bump counter
        fsSpinCounter++;
        runningFsMult += fsSpin.spinWin;
        const tick = fsSpinCounter;
        const mult = runningFsMult;
        timers.current.push(window.setTimeout(() => {
          setFsMeta((prev) => prev ? { ...prev, spinIdx: tick, fsMult: mult } : prev);
        }, accumulatedTime));
        accumulatedTime += FS_BETWEEN_MS;
      }
    }

    // Final settle — count up win, reset flags
    const finalAt = cursor;
    timers.current.push(window.setTimeout(() => {
      setRolling(false);
      setWinCells(new Set());
      setScatterCount(0);
      setPhase("idle");
      setFsMeta(null);
      // Count up win amount from 0 → total USD over COUNTUP_DUR_MS
      if (r.multiplier > 0 && usdPerTon != null) {
        const usd = nanoToUsd(BigInt(r.payoutNano), usdPerTon);
        animateCountUp(usd);
      } else {
        setWinCounterUsd(null);
      }
    }, finalAt));
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
  const antePremiumUsd = betUsd * 0.25;

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
      {/* Header bar — back + title + settings */}
      <div className="sg-head swash-head">
        <button className="stake-game-back" onClick={onBack} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="swash-logo">Swash Booze</div>
        <button
          type="button"
          className="sg-head-btn swash-sound-btn"
          onClick={() => setSoundOn((s) => !s)}
          aria-label={soundOn ? "Mute" : "Unmute"}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </div>

      {/* Candy-world stage */}
      <div className={`swash-stage ${phase === "fs" ? "is-fs" : ""}`}>
        {/* Decorative clouds */}
        <div className="swash-cloud swash-cloud-1" aria-hidden />
        <div className="swash-cloud swash-cloud-2" aria-hidden />
        <div className="swash-cloud swash-cloud-3" aria-hidden />

        {/* Side panels — left */}
        <div className="swash-side swash-side-left">
          <button
            type="button"
            className="swash-buy-card"
            onClick={() => {
              if (ante) { onError?.("Turn off Double Chance to buy"); return; }
              if (busy || rolling) return;
              setShowBuyModal(true);
            }}
            disabled={busy || rolling}
          >
            <div className="swash-buy-card-label">BUY<br />FEATURE</div>
            <div className="swash-buy-card-price">{fmtUsd(buyCostUsd)}</div>
          </button>

          <div className="swash-ante-card">
            <div className="swash-ante-card-label">BET</div>
            <div className="swash-ante-card-price">{fmtUsd(betUsd + antePremiumUsd)}</div>
            <div className="swash-ante-card-sub">DOUBLE<br />CHANCE TO<br />WIN FEATURE</div>
            <button
              type="button"
              className={`swash-ante-toggle ${ante ? "is-on" : ""}`}
              onClick={() => setAnte((a) => !a)}
              disabled={busy || rolling}
              aria-pressed={ante}
            >
              <span className="swash-ante-toggle-thumb" />
              <span className="swash-ante-toggle-label">{ante ? "ON" : "OFF"}</span>
            </button>
          </div>
        </div>

        {/* Game grid container with dashed candy border */}
        <div className="swash-grid-frame">
          <div className="swash-grid">
            {grid.map((row, r) => row.map((sym, c) => {
              const key = `${r},${c}`;
              const isWin = winCells.has(key);
              const bomb = bombs.find((b) => b.row === r && b.col === c);
              return (
                <div
                  key={key}
                  className={`swash-cell ${isWin ? "is-win" : ""}`}
                  style={{
                    // Column-stagger drop — each cell delays by its column index.
                    animationDelay: `${c * COLUMN_STAGGER_MS}ms`,
                  }}
                >
                  {bomb ? (
                    <SwashBombIcon value={bomb.value} winning={isWin} />
                  ) : (
                    <SwashSymbolIcon symbol={sym} winning={isWin} />
                  )}
                  {isWin && <div className="swash-cell-burst" aria-hidden />}
                </div>
              );
            }))}
          </div>

          {/* Scatter counter (base-game only) */}
          {phase !== "fs" && scatterCount > 0 && scatterCount < SWASH_SCATTERS_TO_TRIGGER && !rolling && (
            <div className="swash-scatter-counter">
              {scatterCount}/{SWASH_SCATTERS_TO_TRIGGER} scatters
            </div>
          )}

          {/* FS intro banner */}
          {showFsIntro && (
            <div className="swash-fs-intro">
              <div className="swash-fs-intro-top">FREE SPINS</div>
              <div className="swash-fs-intro-big">{SWASH_FREE_SPINS}</div>
              <div className="swash-fs-intro-bottom">BONUS TRIGGERED</div>
            </div>
          )}

          {/* FS header bar when a FS round is active */}
          {phase === "fs" && fsMeta && !showFsIntro && (
            <div className="swash-fs-bar">
              <span className="swash-fs-bar-spins">
                FREE SPINS <strong>{fsMeta.spinsTotal - fsMeta.spinIdx}</strong>
              </span>
              <span className="swash-fs-bar-win">
                WIN <strong>{fmtUsd(fsMeta.fsMult * betUsd)}</strong>
              </span>
            </div>
          )}

          {/* FS outro */}
          {showFsOutro && (
            <div className="swash-fs-outro">
              <div className="swash-fs-outro-label">FEATURE WIN</div>
              <div className="swash-fs-outro-amount">
                {fmtUsd(showFsOutro.totalMult * betUsd)}
              </div>
            </div>
          )}

          {/* Big / Super / Mega Win */}
          {bigWin && (
            <div className={`swash-big-win is-${bigWin.tier}`}>
              <div className="swash-big-win-label">
                {bigWin.tier === "mega" ? "MEGA WIN" : bigWin.tier === "super" ? "SUPER WIN" : "BIG WIN"}
              </div>
              <div className="swash-big-win-amount">
                {fmtUsd(bigWin.multiplier * betUsd)}
              </div>
            </div>
          )}

          {/* Win counter (after settle) */}
          {winCounterUsd != null && phase === "idle" && !bigWin && (
            <div className="swash-win-counter">
              {fmtUsd(winCounterUsd)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom HUD — bet controls, credit, spin wheel */}
      <div className="swash-hud">
        <div className="swash-hud-left">
          <div className="swash-hud-credit">
            <span className="swash-hud-credit-label">CREDIT</span>
            <span className="swash-hud-credit-value">{fmtUsd(balUsd)}</span>
          </div>
          <div className="swash-hud-bet">
            <span className="swash-hud-bet-label">BET</span>
            <span className="swash-hud-bet-value">{fmtUsd(betUsd * (ante ? SWASH_ANTE_MULTIPLIER : 1))}</span>
          </div>
        </div>

        <button
          type="button"
          className="swash-bet-btn swash-bet-minus"
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
          <svg viewBox="0 0 100 100" width="78" height="78">
            <circle cx="50" cy="50" r="45" fill="#ffd54a" stroke="#b6730b" strokeWidth="3" />
            <circle cx="50" cy="50" r="35" fill="#ff8f1f" />
            <path
              d="M50 24 A 26 26 0 0 1 76 50 L 68 50 L 80 62 L 92 50 L 84 50 A 34 34 0 0 0 50 16 Z"
              fill="#ffffff"
            />
            <path
              d="M50 76 A 26 26 0 0 1 24 50 L 32 50 L 20 38 L 8 50 L 16 50 A 34 34 0 0 0 50 84 Z"
              fill="#ffffff"
            />
          </svg>
        </button>

        <button
          type="button"
          className="swash-bet-btn swash-bet-plus"
          onClick={incBet}
          disabled={busy || rolling}
          aria-label="Increase bet"
        >+</button>
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
